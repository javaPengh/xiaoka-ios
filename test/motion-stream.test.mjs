import test from 'node:test';
import assert from 'node:assert/strict';
import {connectPedometer} from '../src/offline/motion-stream.mjs';
function fixture(){
 const calls=[],readings=[],statuses=[],errors=[];let listener,visible=true,status='authorized';
 const native={async addListener(name,fn){assert.equal(name,'steps');listener=fn;return {async remove(){calls.push('remove')}}},async status(){calls.push('status');return {status}},async today(){calls.push('today');return {date:'2026-11-15',steps:10}},async start(){calls.push('start')},async stop(){calls.push('stop')}};
 const reader=connectPedometer(native,{onReading:r=>readings.push(r),onStatus:s=>statuses.push(s),onError:e=>errors.push(e),isVisible:()=>visible});
 return {native,reader,calls,readings,statuses,errors,emit:r=>listener(r),hide:()=>{visible=false},show:()=>{visible=true},deny:()=>{status='denied'}};
}
test('实时事件直接更新累计步数，不必等待轮询',async()=>{
 const f=fixture();await f.reader.refresh();f.emit({steps:11,date:'2026-11-15'});f.emit({steps:12,date:'2026-11-15'});assert.deepEqual(f.readings.map(r=>r.steps),[10,11,12]);assert.equal(f.calls.filter(c=>c==='today').length,1);f.reader.stop();
});
test('关闭后忽略迟到的查询与事件，不会重新启动原生监听',async()=>{
 const f=fixture();let release,started;const pending=new Promise(r=>release=r),queryStarted=new Promise(r=>started=r);f.native.today=async()=>{started();return pending};
 const task=f.reader.refresh();await queryStarted;f.reader.stop();release({date:'2026-11-15',steps:20});await task;f.emit({date:'2026-11-15',steps:21});assert.equal(f.readings.length,0);assert.ok(!f.calls.includes('start'));assert.ok(f.calls.includes('remove'));
});
test('进入后台停止读取，返回前台重新补读当天累计并订阅',async()=>{
 const f=fixture();await f.reader.refresh();f.hide();await f.reader.pause();f.emit({date:'2026-11-15',steps:99});assert.equal(f.readings.length,1);f.show();await f.reader.refresh();assert.equal(f.calls.filter(c=>c==='start').length,2);f.reader.stop();
});
test('权限被关闭时不查询步数或启动监听',async()=>{
 const f=fixture();f.deny();await f.reader.refresh();assert.deepEqual(f.statuses,['denied']);assert.ok(!f.calls.includes('today'));assert.ok(!f.calls.includes('start'));f.reader.stop();
});
test('并发前台事件合并为最新一次启动',async()=>{
 const f=fixture();await Promise.all([f.reader.refresh(),f.reader.refresh(),f.reader.refresh()]);assert.equal(f.calls.filter(c=>c==='start').length,1);f.reader.stop();
});
test('原生监听出错展示错误，不生成假零步数',async()=>{
 const f=fixture();await f.reader.refresh();f.emit({error:'motion unavailable'});assert.equal(f.errors[0].message,'motion unavailable');assert.equal(f.readings.length,1);f.reader.stop();
});
