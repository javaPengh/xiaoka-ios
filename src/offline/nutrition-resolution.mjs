import {nutritionError} from '../../shared/nutrition.mjs';
export function archiveRejectedTarget(state,opId,replacementId,kind='explicit_manual_replacement'){
 const op=state.outbox.find(op=>op.opId===opId);
 if(!op||!op.waitingForRecalculation||op.data?.source!=='rule_kb')throw nutritionError('这不是可归档的已拒绝规则操作，请先核对同步状态。','INPUT_CONFLICT',409);
 if(state.outbox.some(other=>other.opId!==opId&&(other.blockedBy===opId||other.type===op.type&&other.id===op.id)))throw nutritionError('此目标后还有待同步修改，请先处理后续版本，原操作未归档。','INPUT_CONFLICT',409);
 const key=op.type+':'+op.id,at=new Date().toISOString();
 state.meta.nutritionRejectedOperations||=[];
 state.meta.nutritionRejectedOperations.push({operation:structuredClone(op),resolution:{kind,targetId:replacementId,at}});
 state.history.push({key,data:structuredClone(op.data),deleted:false,at,rejected:true});
 const previous=state.meta.ruleConfirmations?.[op.data.id]?.previous;
 if(state.records[key]?.data?.id===op.data.id){if(previous)state.records[key]=structuredClone(previous);else delete state.records[key];}
 if(state.meta.ruleConfirmations?.[op.data.id])state.meta.ruleConfirmations[op.data.id].resolution={kind,targetId:replacementId,at};
 state.outbox=state.outbox.filter(other=>other.opId!==opId);
}
export function continueSavedOperation(state,rejectedId,followingId){
 const archived=state.meta.nutritionRejectedOperations?.find(a=>a.operation.opId===rejectedId);
 if(archived){if(archived.resolution.kind==='explicit_continue_saved_operation'&&archived.resolution.followingOpId===followingId)return archived.resolution;throw nutritionError('旧操作已按另一种方式处理，请刷新查看。','INPUT_CONFLICT',409);}
 const parent=state.outbox.find(op=>op.opId===rejectedId),child=state.outbox.find(op=>op.opId===followingId);
 if(!parent?.waitingForRecalculation||parent.data?.source!=='rule_kb'||!child||child.attempted||child.blockedBy!==rejectedId||child.type!==parent.type||child.id!==parent.id)throw nutritionError('待处理版本已经变化，未归档或改写任何操作。','INPUT_CONFLICT',409);
 const following=state.outbox.filter(op=>op.opId!==rejectedId&&(op.blockedBy===rejectedId||op.type===parent.type&&op.id===parent.id));
 if(following.length!==1)throw nutritionError('存在多份后续版本，请先核对，原队列全部保留。','INPUT_CONFLICT',409);
 const at=new Date().toISOString(),resolution={kind:'explicit_continue_saved_operation',followingOpId:child.opId,targetId:child.data?.id||null,at};
 state.meta.nutritionRejectedOperations||=[];state.meta.nutritionRejectedOperations.push({operation:structuredClone(parent),resolution});
 state.history.push({key:parent.type+':'+parent.id,data:structuredClone(parent.data),deleted:false,at,rejected:true});
 if(state.meta.ruleConfirmations?.[parent.data.id])state.meta.ruleConfirmations[parent.data.id].resolution=resolution;
 state.outbox=state.outbox.filter(op=>op.opId!==rejectedId);child.blockedBy=null;
 return resolution;
}
