import {getPath,canonicalJSON,assessmentSchema,blankDerived,knownField} from './nutrition.mjs';
import {nutrientKeys} from './schemas.mjs';

export const CALCULATOR_VERSION='nutrition-calculator-v1';
export const CORE_METRICS=['energyKcal','proteinG','fatG','carbsG','fiberG'];
const round=(value,places)=>Number(value.toFixed(places));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const point=(value,unit)=>({kind:'point',value,lower:null,upper:null,unit});
const field=(input,path)=>path.startsWith('derived.')?getPath(input.derived,path.slice(8)):getPath(input.assessment||input,path);
const result=(state,missing=[])=>({state,missingFields:[...new Set(missing)].sort()});

// Three-valued logic matters for exclusions: an unanswered question cannot be
// turned into "false" by negation and accidentally authorize a rule.
export function evaluatePredicate(predicate,input){
 if(predicate.op==='not'){const r=evaluatePredicate(predicate.item,input);return {...r,state:r.state==='unknown'?'unknown':r.state==='match'?'no_match':'match'};}
 if(['all','any'].includes(predicate.op)){
  const children=predicate.items.map(p=>evaluatePredicate(p,input)),states=children.map(r=>r.state);
  if(predicate.op==='all'&&states.includes('no_match'))return result('no_match');
  if(predicate.op==='any'&&states.includes('match'))return result('match');
  if(states.includes('unknown'))return result('unknown',children.flatMap(r=>r.missingFields));
  return result(predicate.op==='all'?'match':'no_match');
 }
 const f=field(input,predicate.field);
 if(predicate.op==='is_status')return result((f?.status||'not_provided')===predicate.value?'match':'no_match');
 if(!f||f.status!=='known'||f.value===null)return result('unknown',[predicate.field]);
 const value=f.value,other=predicate.value;
 const match=predicate.op==='eq'?canonicalJSON(value)===canonicalJSON(other):predicate.op==='in'?Array.isArray(other)&&other.includes(value):predicate.op==='gte'?value>=other:predicate.op==='gt'?value>other:predicate.op==='lte'?value<=other:predicate.op==='lt'?value<other:false;
 return result(match?'match':'no_match');
}

export function selectRules(bundle,input){
 const evidence=new Map(bundle.evidence.map(e=>[e.id,e])),policies=new Map(bundle.policies.map(p=>[p.id,p]));
 const trace=bundle.rules.map(rule=>{
  if(rule.status!=='enabled')return {ruleId:rule.id,status:'disabled',reasons:rule.disableReasons,missingFields:[]};
  if(rule.reviewStatus!=='verified_against_original'||rule.evidenceIds.some(id=>evidence.get(id)?.reviewStatus!=='verified_against_original'))return {ruleId:rule.id,status:'unreviewed',reasons:['规则或证据尚未核查'],missingFields:[]};
  if(rule.policyIds.some(id=>policies.get(id)?.status!=='approved'))return {ruleId:rule.id,status:'unapproved_policy',reasons:['起点或适用策略未批准'],missingFields:[]};
  if(bundle.conflicts.some(c=>c.blocksRuleIds.includes(rule.id)&&c.resolutionStatus==='unresolved'))return {ruleId:rule.id,status:'conflicting_evidence',reasons:['存在未解的适用冲突'],missingFields:[]};
  const exclusion=evaluatePredicate(rule.exclusions,input);if(exclusion.state==='match')return {ruleId:rule.id,status:'excluded',reasons:['符合排除条件'],missingFields:[]};
  const eligibility=evaluatePredicate(rule.eligibility,input);if(eligibility.state==='no_match')return {ruleId:rule.id,status:'ineligible',reasons:['不符合适用条件'],missingFields:[]};
  const missing=rule.requiredInputs.filter(path=>{const f=field(input,path);return !f||!['known','not_applicable'].includes(f.status);});
  if(eligibility.state==='unknown'||exclusion.state==='unknown'||missing.length)return {ruleId:rule.id,status:'needs_input',reasons:['规则所需的事实尚未明确'],missingFields:[...new Set([...missing,...eligibility.missingFields,...exclusion.missingFields])].sort()};
  return {ruleId:rule.id,status:'selected',reasons:[],missingFields:[]};
 });
 return {rules:bundle.rules.filter(r=>trace.find(t=>t.ruleId===r.id)?.status==='selected'),trace};
}

export function estimateMaintenance(input,bundle){
 const a=input.assessment||input;
 const parsed=assessmentSchema.safeParse(a);if(!parsed.success)return {resultState:'needs_input',missingFields:parsed.error.issues.map(i=>i.path.join('.')),reasons:['资料类型、单位或日期未通过校验']};
 const required=['basics.ageYears','basics.heightCm','basics.weightKg','basics.weightDate','basics.sexForCalculation','activity.totalCategory','eligibility.pregnancyLactation','eligibility.medicallyPrescribedDiet'];
 const missing=required.filter(p=>{const f=getPath(a,p);return !f||f.status!=='known'&&!(p==='eligibility.pregnancyLactation'&&f.status==='not_applicable')||f.value==='undisclosed';});
 if(a.basics.ageYears.status==='known'&&a.basics.ageYears.value<18||a.eligibility.medicallyPrescribedDiet.value==='yes'||['pregnant','lactating','both'].includes(a.eligibility.pregnancyLactation.value))return {resultState:'out_of_scope',missingFields:[],reasons:['不属于本产品普通健康成人路径']};
 if(missing.length)return {resultState:'needs_input',missingFields:missing,reasons:['请补充或确认维持热量估算所需资料']};
 if(a.basics.ageYears.value<19)return {resultState:'coverage_gap',missingFields:[],reasons:['选用的成人方程从19岁开始，不把18岁套进19岁方程']};
 if(a.activity.totalCategory.source!=='user_report')return {resultState:'needs_input',missingFields:['activity.totalCategory'],reasons:['总活动档位须由用户确认，不能由程序从久坐标签推断']};
 if(a.basics.weightDate.value>a.contextDate)return {resultState:'needs_input',missingFields:['basics.weightDate'],reasons:['不能使用未来测量']};
 const selected=selectRules(bundle,{assessment:a,derived:input.derived}),rule=selected.rules.find(r=>r.id==='RULE-ENERGY-MAINTENANCE');
 if(!rule)return {resultState:'coverage_gap',missingFields:[],reasons:['个人维持能量规则未核定或适用条件不满足'],ruleTrace:selected.trace};
 const matches=bundle.formulas.filter(f=>f.methodId===rule.formulaOrParameters.parameters.methodId&&f.sex===a.basics.sexForCalculation.value&&f.activityCategory===a.activity.totalCategory.value&&a.basics.ageYears.value>=f.minimumAgeYears&&(f.maximumAgeYearsInclusive===null||a.basics.ageYears.value<=f.maximumAgeYearsInclusive));
 if(matches.length!==1)return {resultState:matches.length?'conflicting_evidence':'coverage_gap',missingFields:[],reasons:['没有唯一且匹配的性别/总活动方程']};
 const formula=matches[0],p=formula.coefficients;
 if(formula.reviewStatus!=='verified_against_original'||formula.unit!=='kcal/day'||formula.weightBasis!=='actual')return {resultState:'coverage_gap',missingFields:[],reasons:['方程审核、单位或体重参照无效']};
 const terms=[p.intercept,p.ageYears*a.basics.ageYears.value,p.heightCm*a.basics.heightCm.value,p.weightKg*a.basics.weightKg.value],value=terms.reduce((sum,n)=>sum+n,0);
 if(!terms.every(finite)||value<=0)return {resultState:'infeasible',missingFields:[],reasons:['能量公式结果不是有效的正数']};
 return {resultState:'estimated',maintenanceEnergyKcal:round(value,2),unit:'kcal/day',methodId:formula.methodId,formulaId:formula.id,formulaVersion:formula.version,weightBasis:'actual',referenceWeightKg:a.basics.weightKg.value,measurementDate:a.basics.weightDate.value,totalActivityCategory:a.activity.totalCategory.value,exerciseKcalAdded:0,terms,evidenceIds:formula.evidenceIds,policyIds:rule.policyIds,ruleTrace:selected.trace,limitations:['属于美加参考的初始估算，不是实测消耗','需要以后用真实体重趋势校准；不由此自动决定增减热量']};
}

// Exact 4/4/9 accounting for target allocation, not a validator for food labels.
export function macroEnergy(nutrients){return 4*nutrients.proteinG+4*nutrients.carbsG+9*nutrients.fatG;}
function resolution(value){const text=String(value);if(text.includes('e'))return Math.min(1,10**Math.floor(Math.log10(Math.abs(value)||1)));return text.includes('.')?10**(-text.split('.')[1].length):1;}
export function validateMacroEnergy(nutrients){
 const keys=['energyKcal','proteinG','carbsG','fatG'];if(keys.some(k=>!finite(nutrients[k])||nutrients[k]<0))return {valid:false,reason:'完整目标必须有有限的非负热量和三大营养素'};
 const representedEnergyKcal=macroEnergy(nutrients),differenceKcal=Math.abs(representedEnergyKcal-nutrients.energyKcal);
 const roundingToleranceKcal=.5*resolution(nutrients.energyKcal)+.5*(4*resolution(nutrients.proteinG)+4*resolution(nutrients.carbsG)+9*resolution(nutrients.fatG));
 return {valid:differenceKcal<=roundingToleranceKcal+1e-8,representedEnergyKcal,differenceKcal,roundingToleranceKcal};
}
export function allocateMacros({energyKcal,referenceWeightKg,weightBasis,proteinFactor,proteinFactorRange,fatEnergyFraction,fatFractionRange,fiberMinimumG,carbohydrateMinimumG=null}){
 const values=[energyKcal,referenceWeightKg,proteinFactor,fatEnergyFraction,fiberMinimumG];
 if(!values.every(finite)||energyKcal<=0||referenceWeightKg<=0||proteinFactor<=0||fatEnergyFraction<=0||fatEnergyFraction>=1||fiberMinimumG<=0||!['actual','fat_free'].includes(weightBasis))return {resultState:'infeasible',reasons:['显式参数、单位或参考体重不完整，未代入任何默认值']};
 if(![proteinFactorRange,fatFractionRange].every(r=>Array.isArray(r)&&r.length===2&&r.every(finite)&&r[0]<=r[1])||proteinFactor<proteinFactorRange[0]||proteinFactor>proteinFactorRange[1]||fatEnergyFraction<fatFractionRange[0]||fatEnergyFraction>fatFractionRange[1])return {resultState:'infeasible',reasons:['产品选点不在适用证据范围内']};
 const energy=round(energyKcal,0),protein=round(referenceWeightKg*proteinFactor,1),fat=round(energy*fatEnergyFraction/9,1),remaining=energy-4*protein-9*fat;
 if(remaining<0)return {resultState:'infeasible',reasons:['蛋白与脂肪占用能量已超过总预算；不把负碳水截成0']};
 const carbs=round(remaining/4,1);if(carbohydrateMinimumG!==null&&(!finite(carbohydrateMinimumG)||carbs<carbohydrateMinimumG))return {resultState:'infeasible',reasons:['碳水分配不能满足已核定的训练需求']};
 const nutrients={...Object.fromEntries(nutrientKeys.map(k=>[k,null])),energyKcal:energy,proteinG:protein,fatG:fat,carbsG:carbs,fiberG:fiberMinimumG};
 const check=validateMacroEnergy(nutrients);if(!check.valid)return {resultState:'infeasible',reasons:['目标在4/4/9口径下超过舍入误差'],check};
 return {resultState:'allocated',nutrients,metricTargets:{energyKcal:point(energy,'kcal/day'),proteinG:point(protein,'g/day'),fatG:point(fat,'g/day'),carbsG:point(carbs,'g/day'),fiberG:{kind:'minimum',value:fiberMinimumG,lower:null,upper:null,unit:'g/day'}},weightBasis,referenceWeightKg,check,steps:[{operation:'protein',referenceWeightKg,proteinFactor,resultG:protein},{operation:'fat',energyKcal:energy,energyFraction:fatEnergyFraction,kcalPerG:9,resultG:fat},{operation:'carbohydrate_remainder',remainingEnergyKcal:remaining,kcalPerG:4,resultG:carbs},{operation:'fiber_minimum',resultG:fiberMinimumG}],rounding:{energyDecimals:0,macroDecimals:1}};
}

export function initialScope(assessment,bundle){
 const policy=bundle.policies.find(p=>p.id==='POL-INITIAL-SCOPE'&&p.status==='approved');if(!policy)return {resultState:'coverage_gap',reasons:['首批适用策略未批准'],missingFields:[]};
 const p=policy.parameters,a=assessment;
 const required=['basics.ageYears','basics.heightCm','basics.weightKg','training.kind','training.calculationContext','training.experienceMonths','training.resistanceExperienceMonths','training.sessionsPerWeek','training.typicalMinutesPerSession','training.intensity'];
 if(a.training.kind.status==='known'&&a.training.kind.value!==p.trainingKind)return {resultState:'coverage_gap',reasons:['首批完整目标仅覆盖已确认的日常抗阻健身；当前训练类型未开放'],missingFields:[]};
 if(a.training.calculationContext?.status==='known'&&a.training.calculationContext.value!==p.calculationContext)return {resultState:'coverage_gap',reasons:['高训练量、备赛或需要特殊营养方案的情境尚未开放'],missingFields:[]};
 if(a.training.competitiveContext?.status==='known'&&['competitive','elite'].includes(a.training.competitiveContext.value))return {resultState:'coverage_gap',reasons:['已填写比赛训练或高水平竞技，不属于首批日常抗阻健身范围'],missingFields:[]};
 const missing=required.filter(path=>getPath(a,path)?.status!=='known');if(missing.length)return {resultState:'needs_input',reasons:['请确认训练与首批自动目标适用情境'],missingFields:missing};
 if(a.training.calculationContext.source!=='user_report')return {resultState:'needs_input',reasons:['适用情境须由用户明确回答，不能由程序推断'],missingFields:['training.calculationContext']};
 if(a.training.sessionsPerWeek.value<=0||a.training.typicalMinutesPerSession.value<=0)return {resultState:'needs_input',reasons:['训练频率或时长与正在进行抗阻健身不一致，请核对'],missingFields:['training.sessionsPerWeek','training.typicalMinutesPerSession']};
 if(a.training.resistanceExperienceMonths.value>a.training.experienceMonths.value)return {resultState:'needs_input',reasons:['抗阻训练经验超过训练总经验，请核对资料'],missingFields:['training.resistanceExperienceMonths','training.experienceMonths']};
 const bmi=a.basics.weightKg.value/((a.basics.heightCm.value/100)**2);
 if(!finite(bmi)||a.basics.ageYears.value<p.minimumAgeYears||bmi<p.bmiLowerInclusive||bmi>=p.bmiUpperExclusive)return {resultState:'coverage_gap',reasons:['不属于首批19岁及以上、18.5≤BMI<24的产品覆盖范围；BMI不用于诊断体脂'],missingFields:[],bmi};
 return {resultState:'eligible',missingFields:[],reasons:[],bmi,policyId:policy.id,policyVersion:policy.version};
}

export function calculateInitialTarget(snapshot,bundle){
 if(bundle.manifest.active!==true||bundle.manifest.initialTargetSubsetSupported!==true)return {resultState:'coverage_gap',canConfirm:false,missingFields:[],reasons:['尚未启用经核定的首批目标规则']};
 const a=snapshot.inputs.assessment;
 const maintenance=estimateMaintenance(a,bundle);if(maintenance.resultState!=='estimated')return {...maintenance,canConfirm:false};
 const scope=initialScope(a,bundle);if(scope.resultState!=='eligible')return {...scope,canConfirm:false,maintenanceEstimate:maintenance};
 if(snapshot.purpose==='review')return {resultState:'insufficient_review_data',canConfirm:false,missingFields:[],reasons:['复核窗口、最低数据量和调整步幅尚未核定，不自动改热量']};
 if(a.goal.kind.status!=='known')return {resultState:'needs_input',canConfirm:false,missingFields:['goal.kind'],reasons:['请选择目标']};
 if(a.goal.kind.value==='recompose'&&a.goal.recompositionPriority.status!=='known')return {resultState:'needs_input',canConfirm:false,missingFields:['goal.recompositionPriority'],reasons:['请明确身体重组优先级，不替用户选择增肌或减脂']};
 const energyPolicy=bundle.policies.find(p=>p.id==='POL-ENERGY-START'&&p.status==='approved'),pointPolicy=bundle.policies.find(p=>p.id==='POL-POINT-SELECTION'&&p.status==='approved'),numericPolicy=bundle.policies.find(p=>p.id==='POL-AUTO-NUMERIC-VALIDATION'&&p.status==='approved');
 if(!energyPolicy||!pointPolicy||!numericPolicy)return {resultState:'coverage_gap',canConfirm:false,missingFields:[],reasons:['目标起点尚未批准']};
 const goal=a.goal.kind.value,ep=energyPolicy.parameters,adjustment=goal==='gain'?ep.gainAdjustment:goal==='lose'?ep.loseAdjustment:goal==='maintain'?ep.maintainAdjustment:ep.recomposeAdjustment?.[a.goal.recompositionPriority.value],factor=pointPolicy.parameters.proteinFactors?.[goal];
 if(!finite(adjustment)||!finite(factor))return {resultState:'coverage_gap',canConfirm:false,missingFields:[],reasons:['所选模式没有明确、获批的热量或蛋白起点']};
 const derived=blankDerived(),at=snapshot.createdAt,refs=[{type:'nutritionAssessment',...snapshot.assessmentRef}];
 const derivation={methodId:'approved_routine_actual_weight_scope',methodVersion:'1',ruleIds:['RULE-INITIAL-ROUTINE-RESISTANCE'],policyIds:[scope.policyId,energyPolicy.id],computedAt:at};
 for(const [key,value,unit]of [['referenceWeightApplicable',true,null],['referenceWeightKg',a.basics.weightKg.value,'kg'],['energyContext',adjustment<0?'hypocaloric':adjustment>0?'hypercaloric':'maintenance',null]])derived[key]={...knownField(value,unit,snapshot.contextDate,'derived',refs),collectedAt:at,derivation};
 const selection=selectRules(bundle,{assessment:a,derived}),rule=selection.rules.find(r=>r.id==='RULE-INITIAL-ROUTINE-RESISTANCE');if(!rule)return {resultState:'coverage_gap',canConfirm:false,missingFields:[],reasons:['首批完整目标规则未通过审核或适用检查'],ruleTrace:selection.trace};
 if(selection.rules.some(r=>r.id!==rule.id&&r.formulaOrParameters.outputRole==='candidate_component'&&['protein','fat','complete_initial_target'].includes(r.formulaOrParameters.nutrient)))return {resultState:'conflicting_evidence',canConfirm:false,missingFields:[],reasons:['存在多个目标剂量规则，不能按列表先后任选一个'],ruleTrace:selection.trace};
 const budget=maintenance.maintenanceEnergyKcal*(1+adjustment),limits=numericPolicy.parameters;
 if(budget<limits.automaticEnergyMinimumKcal||budget>limits.targetStorageMaximumEnergyKcal)return {resultState:'infeasible',canConfirm:false,missingFields:[],reasons:['计算预算超出既有自动目标门禁或目标存储范围；不自动截值']};
 const allocation=allocateMacros({energyKcal:budget,referenceWeightKg:derived.referenceWeightKg.value,weightBasis:'actual',proteinFactor:factor,proteinFactorRange:rule.formulaOrParameters.parameters.proteinFactorRange,fatEnergyFraction:pointPolicy.parameters.fatEnergyFraction,fatFractionRange:rule.formulaOrParameters.parameters.fatFractionRange,fiberMinimumG:pointPolicy.parameters.fiberMinimumG});
 if(allocation.resultState!=='allocated')return {...allocation,canConfirm:false,missingFields:[]};
 const evidenceIds=[...new Set(rule.evidenceIds)],policyIds=[...new Set([...rule.policyIds,...maintenance.policyIds])],ruleIds=[{id:rule.id,version:rule.version},{id:'RULE-ENERGY-MAINTENANCE',version:bundle.rules.find(r=>r.id==='RULE-ENERGY-MAINTENANCE').version}];
 return {resultState:'ready',canConfirm:true,missingFields:[],reasons:[],nutrients:allocation.nutrients,metricTargets:allocation.metricTargets,derived,calculation:{methodId:maintenance.methodId,methodVersion:maintenance.formulaVersion,parameters:{formulaId:maintenance.formulaId,goal,recompositionPriority:goal==='recompose'?a.goal.recompositionPriority.value:null,totalActivityCategory:maintenance.totalActivityCategory,adjustmentFraction:adjustment,proteinFactor:factor,proteinFactorRange:rule.formulaOrParameters.parameters.proteinFactorRange,fatEnergyFraction:pointPolicy.parameters.fatEnergyFraction,fatFractionRange:rule.formulaOrParameters.parameters.fatFractionRange,referenceWeightPolicyId:scope.policyId,bmiForProductScope:scope.bmi,measurementDate:maintenance.measurementDate,exerciseKcalAdded:0,rounding:allocation.rounding},steps:[{operation:'maintenance',terms:maintenance.terms,resultKcal:maintenance.maintenanceEnergyKcal},{operation:'goal_adjustment',fraction:adjustment,resultKcal:budget},...allocation.steps],maintenanceEnergyKcal:maintenance.maintenanceEnergyKcal,adjustmentKcal:round(budget-maintenance.maintenanceEnergyKcal,2),weightBasis:'actual',referenceWeightKg:derived.referenceWeightKg.value},provenance:{knowledgeVersion:bundle.manifest.version+'+'+bundle.manifest.contentHash,calculatorVersion:CALCULATOR_VERSION,ruleIds,policyIds:policyIds.map(id=>({id,version:bundle.policies.find(p=>p.id===id).version})),evidenceIds,sourceVersions:[...new Set(evidenceIds.map(id=>bundle.evidence.find(e=>e.id===id).sourceId))].map(id=>({id,version:bundle.sources.find(s=>s.id===id).version}))},ruleTrace:selection.trace,check:allocation.check,fixedExplanation:'维持热量采用NASEM 2023成人公式与用户确认的总活动档位；增减热量、蛋白与脂肪是用户已批准的产品起点。只覆盖首批普通抗阻健身情境，估算需用后续实际趋势校准，确认后才生效。',limitations:maintenance.limitations};
}
