import {targetFromCandidate,sameTarget} from '../../shared/nutrition-targets.mjs';
import {nutritionCapabilities,nutritionError,canonicalJSON,contentHash} from '../../shared/nutrition.mjs';
import {verifyInputSnapshot} from '../../shared/nutrition-data.mjs';
import {validateRecord} from '../../shared/records.mjs';
import {normalizeQuestion} from '../../shared/nutrition-retrieval.mjs';
import {archiveRejectedTarget} from './nutrition-resolution.mjs';

export async function requestNutritionTarget(repo,path,method,body,query='',options={}){
 if(path==='nutrition/candidates'&&method==='POST'){
  if(!repo.state.meta.capabilities?.nutritionRuleCandidates)throw nutritionError('服务器尚不支持规则候选，请先升级。','CONTRACT_UNSUPPORTED',426);
  await repo.push();await repo.pull();
  const refs=[['nutritionAssessment',body.assessmentRef],...(body.reviewRef?[['nutritionReview',body.reviewRef]]:[])];
  const resolved={...body};
  for(const [type,ref]of refs){const row=repo.state.records[type+':'+ref.id];if(!row||row.local||ref.recordVersion!==null&&row.version!==ref.recordVersion||await contentHash(row.data)!==ref.contentHash||repo.state.conflicts[type+':'+ref.id])throw nutritionError('请先同步并核对采用的营养资料。','INPUT_CONFLICT',409);resolved[type==='nutritionAssessment'?'assessmentRef':'reviewRef']={id:ref.id,recordVersion:row.version,contentHash:ref.contentHash};}
  const candidate=await repo.remote(path,{...options,method:'POST',body:JSON.stringify({...resolved,clientCapabilities:nutritionCapabilities})});
  await verifyInputSnapshot(candidate.inputSnapshot);
  await repo.commit(s=>{s.proposals['nutrition:'+candidate.candidateId]=structuredClone(candidate);});
  await repo.pull();return candidate;
 }
 const [, ,id,action]=path.split('/');
 if(!id)throw new Error('候选标识不能为空');
 if(action==='explanation'){
  const question=normalizeQuestion(new URLSearchParams(query).get('question')||body.question||''),key='nutrition-explanation:'+id+':'+question;
  try{const result=await repo.remote(query?path+'?'+query:path,{...options,method,body:method==='POST'?JSON.stringify(body):undefined});await repo.commit(s=>{s.proposals[key]=structuredClone(result);if(s.meta.unverifiedNutritionExplanations)delete s.meta.unverifiedNutritionExplanations[key];});return result;}
  catch(error){if(method!=='GET'||error.status||error.code)throw error;const cached=repo.state.proposals[key];if(!cached)throw error;if(repo.state.meta.unverifiedNutritionExplanations?.[key])return {candidateId:id,cached:true,explanationState:'not_requested',verificationState:'imported_unverified',paragraphs:[],citations:[],text:'导入的解释尚未联网核验，请先查看目标保留的固定依据，联网后再获取解释。'};return {...structuredClone(cached),cached:true,validationState:'requires_online_validation'};}
 }
 if(action==='confirm'&&method==='POST'){
  const candidate=repo.state.proposals['nutrition:'+id];if(!candidate)throw new Error('本机没有此候选，请联网重新获取');
  const target=await targetFromCandidate(candidate,body),type=body.scope==='future'?'plan':'dayTarget',key=type+':'+body.date;
  validateRecord(type,body.date,target);if(body.date<candidate.contextDate)throw new Error('候选不能回填到资料日期之前');
  for(const ref of candidate.inputSnapshot.originVersions){const row=repo.state.records[ref.type+':'+ref.id];if(!row||row.deleted||row.local||row.version!==ref.recordVersion||await contentHash(row.data)!==ref.contentHash||repo.state.conflicts[ref.type+':'+ref.id])throw nutritionError('本机采用的资料已经改变，请重新生成。','CANDIDATE_STALE',409);}
  await repo.mutate((s,edit)=>{
   s.meta.ruleConfirmations||={};const previous=s.meta.ruleConfirmations[target.id];
   if(previous){if(!sameTarget(previous.target,target))throw nutritionError('确认标识已用于不同内容。','CONFIRMATION_CONFLICT',409);return;}
   if(body.resolveRejectedOpId)archiveRejectedTarget(s,body.resolveRejectedOpId,target.id,'explicit_recalculation');
   const held=s.outbox.find(o=>o.waitingForRecalculation&&o.data?.source==='rule_kb'&&o.id===body.date&&(o.type===type||type==='plan'&&o.type==='dayTarget'));if(held)throw nutritionError('请先明确处理这一天被拒绝的旧候选，原操作仍保留。','INPUT_CONFLICT',409);
   s.meta.ruleConfirmations[target.id]={target:structuredClone(target),previous:s.records[key]||null};
   const snapshot=candidate.inputSnapshot,snapshotKey='nutritionInput:'+snapshot.id;
   if(s.records[snapshotKey]&&canonicalJSON(s.records[snapshotKey].data)!==canonicalJSON(snapshot))throw new Error('候选输入快照与本机内容不一致');
   if(!s.records[snapshotKey])s.records[snapshotKey]={type:'nutritionInput',id:snapshot.id,data:structuredClone(snapshot),version:1,deleted:false,local:false};
   edit(type,body.date,target);
   if(type==='plan'){
    const dayKey='dayTarget:'+body.date,day=s.records[dayKey];
    if(day&&!day.deleted){if(s.outbox.some(o=>o.type==='dayTarget'&&o.id===body.date)||s.conflicts[dayKey])throw nutritionError('当天覆盖尚待同步或有冲突，请先处理。','INPUT_CONFLICT',409);s.meta.ruleConfirmations[target.id].previousDay=structuredClone(day);s.records[dayKey]={...day,deleted:true,local:true,ruleConfirmationId:target.id};}
   }
  });return target;
 }
 if(method==='GET'&&!action){
  try{const candidate=await repo.remote(path,options);await verifyInputSnapshot(candidate.inputSnapshot);await repo.commit(s=>{s.proposals['nutrition:'+id]=structuredClone(candidate);});return candidate;}
  catch(error){if(error.status||error.code)throw error;const cached=repo.state.proposals['nutrition:'+id];if(!cached)throw error;return {...structuredClone(cached),cached:true,validationState:'requires_online_validation'};}
 }
 throw new Error('不支持的候选操作');
}
