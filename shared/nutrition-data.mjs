import {assessmentSchema,reviewSchema,inputSchema,blankDerived,knownField,unknownField,contentHash,referenceFor,intakeSummary,snapshotPayload,canonicalJSON,nutritionError,INPUT_CONTRACT,daysIn,getPath,assessmentFields} from './nutrition.mjs';
import {nutrientKeys} from './schemas.mjs';
import {activeTarget} from './nutrition-targets.mjs';

const live=rows=>rows.filter(r=>!r.deleted&&r.data);
export async function nutritionContext(rows,date,history=[]){
 const records=live(rows),list=async type=>Promise.all(records.filter(r=>r.type===type&&(!r.data.contextDate||r.data.contextDate<=date)).sort((a,b)=>(b.data.updatedAt||b.data.createdAt||'').localeCompare(a.data.updatedAt||a.data.createdAt||'')).map(async r=>({record:r.data,ref:await referenceFor(r)})));
 const assessments=await list('nutritionAssessment'),a=assessments[0]?.record,profile=records.find(r=>r.type==='profile')?.data,latestWeight=records.filter(r=>r.type==='measurement'&&r.id<=date&&r.data.weightKg!==null).sort((a,b)=>b.id.localeCompare(a.id))[0];
 const comparisons=profile?{'basics.ageYears':profile.age,'basics.heightCm':profile.heightCm,'basics.sexForCalculation':profile.sex,'basics.weightKg':latestWeight?.data.weightKg??profile.weightKg}:{};
 const legacyChanges=a?Object.entries(comparisons).filter(([path,value])=>getPath(a,path)?.status==='known'&&getPath(a,path)?.value!==value).map(([path])=>assessmentFields.find(f=>f.path===path)?.label||path):[];
 const reviews=await list('nutritionReview'),versions=new Map();
 for(const row of [...records.filter(r=>r.type==='nutritionAssessment'),...history.filter(r=>(r.type||r.key?.split(':')[0])==='nutritionAssessment'&&r.data)])versions.set(row.data.id+':'+await contentHash(row.data),row.data);
 const reviewAssessments=Object.fromEntries(reviews.map(row=>{const ref=row.record.assessmentRef.value;return [row.record.id,ref?versions.get(ref.id+':'+ref.contentHash)||null:null];}));
 return {assessments,reviews,reviewAssessments,snapshots:await list('nutritionInput'),diaryCoverage:records.find(r=>r.type==='diaryCoverage'&&r.id===date)?.data||null,measurement:records.find(r=>r.type==='measurement'&&r.id===date)?.data||null,target:targetRow(rows,date)?.data||null,legacyChanges,automaticTargetsEnabled:false,activeKnowledgeVersion:null};
}
export function targetRow(rows,date){const valid=live(rows).filter(r=>!['plan','dayTarget'].includes(r.type)||activeTarget(r.data)),exact=valid.find(r=>r.type==='dayTarget'&&r.id===date);if(exact)return exact;return valid.filter(r=>r.type==='plan'&&r.id<=date).sort((a,b)=>b.id.localeCompare(a.id)||b.data.createdAt.localeCompare(a.data.createdAt))[0]||null;}
export async function assessmentWithHistory(input,rows){
 const value=structuredClone(input),w=value.recent.window;
 if(w.status==='known'){
  const measurements=live(rows).filter(r=>r.type==='measurement'&&r.id>=w.value.from&&r.id<=w.value.to);
  value.recent.measurementRefs=knownField(await Promise.all(measurements.map(referenceFor)),null,w.value,'derived');
  value.recent.intakeHistory=knownField(await intakeSummary(rows,w.value,nutrientKeys),null,w.value,'derived');
 }else{value.recent.measurementRefs=unknownField();value.recent.intakeHistory=unknownField();}
 return assessmentSchema.parse(value);
}
export async function reviewWithRecords(input,assessmentRow,rows){
 const value=structuredClone(input);if(value.window.status!=='known')throw new Error('请填写复核记录区间');
 const window=value.window.value,target=targetRow(rows,window.to);if(!target)throw new Error('区间结束日没有可复核的目标，请先选择已有目标的执行区间');
 if(!assessmentRow||assessmentRow.deleted)throw new Error('请先保存本次复核采用的营养资料');
 if(window.from<target.data.startDate)throw new Error('区间跨越目标生效日，请从所选目标生效日开始复核');
 const aRef=await referenceFor(assessmentRow),pRef=await referenceFor(target);delete aRef.type;
 value.assessmentRef=knownField(aRef,null,value.contextDate,'derived');
 value.planRef=knownField({...pRef,startDate:target.data.startDate,targetId:target.data.id},null,value.contextDate,'derived');
 value.executionDays=knownField(daysIn(window),'day',window,'derived');
 const measurements=live(rows).filter(r=>r.type==='measurement'&&r.id>=window.from&&r.id<=window.to).sort((a,b)=>a.id.localeCompare(b.id));
 const weights=[],waists=[];for(const row of measurements){const ref=await referenceFor(row);if(row.data.weightKg!=null)weights.push({measurementRef:ref,date:row.id,weightKg:row.data.weightKg,conditions:row.data.measurementConditions||unknownField()});if(row.data.waistCm!=null)waists.push({measurementRef:ref,date:row.id,waistCm:row.data.waistCm});}
 value.weightObservations=knownField(weights,null,window,'derived');value.waistObservations=knownField(waists,null,window,'derived');value.availableWeightDays=knownField(weights.length,'day',window,'derived');
 const summary=await intakeSummary(rows,window,nutrientKeys);value.intakeSummary=knownField(summary,null,window,'derived');value.diaryCoverageRefs=knownField(summary.coverageRefs,null,window,'derived');
 const targets=live(rows).filter(r=>['plan','dayTarget'].includes(r.type)&&r.data.startDate>=window.from&&r.data.startDate<=window.to);
 value.targetChanges=knownField(await Promise.all(targets.map(async r=>({targetId:r.data.id,effectiveDate:r.data.startDate,source:r.data.source,contentHash:await contentHash(r.data)}))),null,window,'derived');
 return reviewSchema.parse(value);
}
export async function createInputSnapshot({id,assessmentRow,reviewRow=null,rows,contextDate,timezone}){
 const assessment=assessmentSchema.parse(assessmentRow?.data),review=reviewRow?reviewSchema.parse(reviewRow.data):null;
 const ref=await referenceFor(assessmentRow);delete ref.type;const rRef=reviewRow?await referenceFor(reviewRow):null;if(rRef)delete rRef.type;
 if(review&&(review.assessmentRef.status!=='known'||review.assessmentRef.value.id!==assessment.id||review.assessmentRef.value.contentHash!==ref.contentHash))throw nutritionError('复核采用的资料已改变，请重新保存复核。','INPUT_CHANGED',409);
 const window=review?.window.value||assessment.recent.window.value;
 if(assessment.contextDate>contextDate||review&&review.contextDate>contextDate)throw new Error('不能把未来日期的资料用于历史输入快照');
 const requiredRefs=new Set(),requiredVersions=[];
 function visit(v){if(!v||typeof v!=='object')return;if(v.type&&v.id&&v.contentHash){requiredRefs.add(v.type+':'+v.id);requiredVersions.push(v);}for(const item of Object.values(v))visit(item);}
 visit(assessment);visit(review);
 for(const ref of requiredVersions){const row=live(rows).find(r=>r.type===ref.type&&r.id===ref.id);if(!row||await contentHash(row.data)!==ref.contentHash)throw nutritionError('采用的原记录已改变或被删除，请重新保存资料或复核后再生成输入快照。','INPUT_CHANGED',409);}
 const adopted=live(rows).filter(r=>!['nutritionAssessment','nutritionReview','nutritionInput'].includes(r.type)&&(requiredRefs.has(r.type+':'+r.id)||(window&&['measurement','entry','diaryCoverage'].includes(r.type)&&(r.data.date||r.id)>=window.from&&(r.data.date||r.id)<=window.to))).sort((a,b)=>(a.type+':'+a.id).localeCompare(b.type+':'+b.id));
 const records=await Promise.all(adopted.map(async row=>({ref:await referenceFor(row),data:structuredClone(row.data)})));
 const value={id,contractVersion:INPUT_CONTRACT,createdAt:new Date().toISOString(),contextDate,timezone,purpose:review?'review':'initial',assessmentRef:ref,reviewRef:rRef,inputs:{assessment,review,derived:blankDerived(),records},activityAccounting:'total_including_training',excludedEnergyInputs:adopted.filter(r=>r.type==='measurement').map(r=>({measurementId:r.id,exerciseKcal:r.data.exerciseKcal??null,reason:'included_in_total_activity_no_addback'})),originVersions:[{type:'nutritionAssessment',...ref},...(rRef?[{type:'nutritionReview',...rRef}]:[]),...records.map(r=>r.ref)],inputHash:'0'.repeat(64)};
 value.inputHash=await contentHash(snapshotPayload(value));return inputSchema.parse(value);
}
export async function verifyInputSnapshot(value){
 const v=inputSchema.parse(value);if(v.inputHash!==await contentHash(snapshotPayload(v)))throw new Error('输入快照哈希不一致');
 if(v.assessmentRef.contentHash!==await contentHash(v.inputs.assessment)||v.reviewRef&&v.reviewRef.contentHash!==await contentHash(v.inputs.review))throw new Error('快照资料引用哈希不一致');
 for(const row of v.inputs.records)if(row.ref.contentHash!==await contentHash(row.data))throw new Error('快照原始记录哈希不一致');
 const expected=[{type:'nutritionAssessment',...v.assessmentRef},...(v.reviewRef?[{type:'nutritionReview',...v.reviewRef}]:[]),...v.inputs.records.map(r=>r.ref)];
 if(canonicalJSON(expected)!==canonicalJSON(v.originVersions))throw new Error('快照来源清单不一致');return v;
}
export function inputReadiness(a){const required=['basics.ageYears','basics.heightCm','basics.weightKg','basics.weightDate','basics.sexForCalculation','goal.kind','activity.dailyPattern','activity.totalCategory','training.kind','training.calculationContext','eligibility.pregnancyLactation','eligibility.medicallyPrescribedDiet'];if(a?.goal.kind.value==='recompose')required.push('goal.recompositionPriority');if(a?.training.kind.status==='known'&&a.training.kind.value!=='none')required.push('training.experienceMonths','training.sessionsPerWeek','training.typicalMinutesPerSession','training.intensity');if(['resistance','mixed'].includes(a?.training.kind.value))required.push('training.resistanceExperienceMonths');if(a?.training.kind.value==='mixed')required.push('training.components');return required.filter(p=>getPath(a,p)?.status!=='known'||getPath(a,p)?.value==='undisclosed').map(path=>({path,label:assessmentFields.find(f=>f.path===path)?.label||path}));}
