import {useEffect,useRef,useState} from 'react';
import {Capacitor,registerPlugin} from '@capacitor/core';
import type {Repository} from './offline/service';
import {localDay,saveAutomaticSteps} from './offline/steps.mjs';
const pedometer=registerPlugin<{status():Promise<{status:string}>;today():Promise<{date:string;steps:number}>}>('Pedometer');
const descriptions:Record<string,string>={notDetermined:'开启后需允许访问“运动与健身”。',denied:'运动权限未开启，请到 iPhone 设置 → 隐私与安全性 → 运动与健身中允许小卡日记访问。',restricted:'系统限制了运动数据访问。',unsupported:'当前设备不支持自动计步。'};
export function StepTracker({repo,date,onSaved}:{repo:Repository;date:string;onSaved:()=>void}){
 const key='xiaoka.pedometer.'+repo.partition;
 const [enabled,setEnabled]=useState(()=>localStorage.getItem(key)==='true');
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const callback=useRef(onSaved);callback.current=onSaved;
 const run=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{
  if(!Capacitor.isNativePlatform())return;
  let active=true,inFlight=false;
  const update=async()=>{
   if(inFlight||document.hidden||!enabled)return;
   inFlight=true;setBusy(true);
   try{const status=await pedometer.status();if(!active)return;
    if(status.status!=='authorized'&&status.status!=='notDetermined'){setMessage(descriptions[status.status]||'暂时无法读取运动权限');return;}
    const reading=await pedometer.today();if(!active||repo.closed||document.hidden)return;
    if(reading.date!==localDay()){setMessage('日期已切换，请刷新今日步数。');return;}
    if(await saveAutomaticSteps(repo,reading)){if(active)callback.current();}
    if(active)setMessage('今日步数已读取 · '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
   }catch(error){if(active)setMessage((error as Error).message||'步数读取失败，请稍后刷新');}
   finally{inFlight=false;if(active)setBusy(false);}
  };
  run.current=update;
  if(enabled)void update();else pedometer.status().then(s=>{if(active)setMessage(descriptions[s.status]||'授权后自动读取 iPhone 当天步数。');}).catch(()=>{if(active)setMessage('请更新安装包后重试自动计步。');});
  const wake=()=>{if(!document.hidden)void update();};
  document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);
  const timer=setInterval(()=>void update(),60000);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};
 },[repo,date,enabled]);
 if(!Capacitor.isNativePlatform())return null;
 return <section className="notice-card" aria-label="自动计步"><div><strong>iPhone 自动计步</strong><p role="status">{message||'读取运动状态中…'}</p>{date!==localDay()&&<p>当前查看历史日期；自动计步仍只更新今天。</p>}<button className="text-button" disabled={busy} onClick={()=>{if(!enabled){localStorage.setItem(key,'true');setEnabled(true);}else void run.current();}}>{busy?'正在读取步数…':enabled?'刷新今日步数':'开启自动计步'}</button><p className="hint">仅统计随身携带 iPhone 的步数，打开 App 时自动更新。步数不能手动修改。</p></div></section>;
}
