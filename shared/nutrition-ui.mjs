
/** @type {Array<'energyKcal'|'proteinG'|'fatG'|'carbsG'|'fiberG'>} */
export const coreTargetKeys=['energyKcal','proteinG','fatG','carbsG','fiberG'];
/** @type {Record<string,string>} */
export const metricLabels={energyKcal:'热量',proteinG:'蛋白质',fatG:'脂肪',carbsG:'碳水',fiberG:'膳食纤维'};
/** @type {Record<string,string>} */
export const metricKindLabels={point:'每日定值',minimum:'最低值',maximum:'上限',range:'范围'};
export function metricForTarget(target,key){
 if(target?.metricTargets&&Object.hasOwn(target.metricTargets,key))return target.metricTargets[key];
 const value=target?.nutrients?.[key];return typeof value==='number'?{kind:'point',value,lower:null,upper:null,unit:key==='energyKcal'?'kcal/day':'g/day',legacy:true}:null;
}
export function metricText(metric){if(!metric)return '未设置';const unit=metric.unit.replace('/day','/日');return metric.kind==='range'?`${metric.lower}–${metric.upper} ${unit}`:`${metric.kind==='minimum'?'至少 ':metric.kind==='maximum'?'不超过 ':''}${metric.value} ${unit}`;}
export function energyFeedback(target,intake){
 const m=metricForTarget(target,'energyKcal');if(!m)return {label:'已记录摄入',value:intake,progress:0};
 if(typeof intake!=='number')return {label:'摄入热量未知',value:null,progress:0};
 const lower=m.kind==='range'?m.lower:m.value,upper=m.kind==='range'?m.upper:m.value;
 if(m.kind==='minimum'&&intake>=lower)return {label:'已达最低目标',value:intake,progress:1};
 if(m.kind==='minimum')return {label:'距最低建议',value:Math.max(0,lower-intake),progress:lower>0?Math.min(1,intake/lower):0,over:false};
 return {label:intake>upper?'已超量':'还可以吃',value:Math.abs(upper-intake),progress:upper>0?Math.min(1,intake/upper):0,over:intake>upper};
}
export function nutrientBudget(target,key,intake){const metric=metricForTarget(target,key),limit=metric?.kind==='range'?metric.upper:metric?.value;return {limit:typeof limit==='number'?limit:null,over:typeof intake==='number'&&typeof limit==='number'&&metric?.kind!=='minimum'&&intake>limit,minimum:metric?.kind==='minimum'};}
export function macroShares(totals){const keys=['carbsG','proteinG','fatG'],sum=keys.reduce((s,k)=>s+(typeof totals[k]==='number'?totals[k]:0),0);return keys.map(key=>({key,share:sum>0?(totals[key]||0)/sum:0}));}
