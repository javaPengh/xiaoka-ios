import {useEffect} from 'react';
import type {Repository} from './offline/service';
import {saveAutomaticSteps} from './offline/steps.mjs';
import {useMotion} from './Motion';
export function StepTracker({repo,onSaved,onError}:{repo:Repository;onSaved:()=>void;onError:(message:string)=>void}){
 const {reading,enabled}=useMotion();
 useEffect(()=>{let active=true;if(enabled&&reading&&!repo.closed)void saveAutomaticSteps(repo,reading).then(changed=>{if(active&&changed)onSaved();}).catch(error=>{if(active)onError(error.message);});return()=>{active=false;};},[repo,reading,enabled]);
 return null;
}
