import {TARGET_CONTRACT,canonicalJSON,contentHash,nutritionError} from './nutrition.mjs';
import {validateMacroEnergy} from './target-engine.mjs';

export function targetHashPayload(value){const {contentHash,confirmation,...payload}=value;return payload;}
export function targetFromCandidateWithHash(candidate,intent,hash){
 if(candidate.resultState!=='ready'||!candidate.canConfirm)throw nutritionError('此候选尚不能确认。','INVALID_TARGET',400);
 const target={id:intent.requestId,startDate:intent.date,scope:intent.scope,source:'rule_kb',createdAt:intent.userConfirmedAt,contractVersion:TARGET_CONTRACT,nutrients:structuredClone(candidate.nutrients),waterMl:null,explanation:candidate.fixedExplanation,metricTargets:structuredClone(candidate.metricTargets),inputSnapshotId:candidate.inputSnapshot.id,inputSnapshotHash:candidate.inputHash,inputSummary:{contextDate:candidate.contextDate,timezone:candidate.inputSnapshot.timezone,assessmentRef:candidate.inputSnapshot.assessmentRef},calculation:structuredClone(candidate.calculation),provenance:structuredClone(candidate.provenance),evidenceSummary:structuredClone(candidate.evidenceSummary),explanationState:'not_requested'};
 target.calculation.parameters={...target.calculation.parameters,candidateId:candidate.candidateId,calculationSignature:candidate.calculationSignature};
 target.contentHash=hash(targetHashPayload(target));
 target.confirmation={userConfirmedAt:intent.userConfirmedAt,confirmationRequestId:intent.requestId,inputHash:candidate.inputHash,confirmedTargetHash:target.contentHash,serverValidation:'pending',serverValidatedAt:null};
 return target;
}
export async function targetFromCandidate(candidate,intent){const value=targetFromCandidateWithHash(candidate,intent,()=> '0'.repeat(64));value.contentHash=await contentHash(targetHashPayload(value));value.confirmation.confirmedTargetHash=value.contentHash;return value;}
export function validateRuleTarget(value,hash){
 if(value.source!=='rule_kb'||!value.confirmation||!value.calculation||!value.provenance||!value.evidenceSummary||value.inputSnapshotHash!==value.confirmation.inputHash||value.id!==value.confirmation.confirmationRequestId||value.createdAt!==value.confirmation.userConfirmedAt||value.contentHash!==hash(targetHashPayload(value))||value.contentHash!==value.confirmation.confirmedTargetHash||!validateMacroEnergy(value.nutrients).valid)throw nutritionError('规则目标内容或确认凭据不完整，不能作为有效目标保存。','INVALID_TARGET',400);
}
export const sameTarget=(a,b)=>canonicalJSON(targetHashPayload(a))===canonicalJSON(targetHashPayload(b))&&a.contentHash===b.contentHash&&a.confirmation?.confirmationRequestId===b.confirmation?.confirmationRequestId&&a.confirmation?.userConfirmedAt===b.confirmation?.userConfirmedAt&&a.confirmation?.inputHash===b.confirmation?.inputHash;
export const activeTarget=value=>value?.source!=='rule_kb'||['pending','verified'].includes(value.confirmation?.serverValidation);
// Food recording needs the saved numbers and their meanings, not the complete
// calculation, reference archive or input summary in every model prompt.
export function recordingTargetContext(target){return target?{source:target.source,startDate:target.startDate,nutrients:target.nutrients,waterMl:target.waterMl,metricTargets:target.metricTargets||null}:null;}
