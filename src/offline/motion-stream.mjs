// Serialize native lifecycle operations so late queries cannot restart a stopped reader.
export function connectPedometer(native,{onReading,onStatus,onError,isVisible=()=>true}){
 let closed=false,epoch=0,listener,queue=Promise.resolve();
 const report=error=>{if(!closed)onError(error);};
 const ready=native.addListener('steps',data=>{if(closed||!isVisible())return;if(data.error)report(new Error(data.error));else onReading(data);}).then(handle=>{if(closed)return handle.remove();listener=handle;});
 // Attach a rejection handler immediately; refresh will also handle setup failure.
 ready.catch(()=>{});
 const refresh=()=>{const version=++epoch;const current=()=>!closed&&version===epoch&&isVisible();
  queue=queue.catch(()=>{}).then(async()=>{
   await ready;if(!current())return;await native.stop();if(!current())return;
   const status=await native.status();if(!current())return;onStatus(status.status);
   if(!['authorized','notDetermined'].includes(status.status))return;
   const reading=await native.today();if(!current())return;onReading(reading);
   const permission=await native.status();if(!current())return;onStatus(permission.status);
   if(permission.status!=='authorized')return;
   await native.start();if(!current())await native.stop();
  }).catch(error=>{if(current())report(error);});return queue;
 };
 const pause=()=>{++epoch;return native.stop().catch(report);};
 const stop=()=>{closed=true;++epoch;void native.stop().catch(()=>{});if(listener)void listener.remove();};
 return {refresh,pause,stop};
}
