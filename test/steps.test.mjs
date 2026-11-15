import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalRepository} from '../src/offline/repository.mjs';
import {saveAutomaticSteps,localDay} from '../src/offline/steps.mjs';
async function fixture(t){
 const states=new Map();const storage={fail:false,saves:0,async load(k){return structuredClone(states.get(k)||null)},async save(k,v){if(this.fail)throw Error('disk full');this.saves++;states.set(k,structuredClone(v))}};
 const repo=new LocalRepository({partition:'steps-test',storage,remote:async()=>{throw Error('No network should be required')}});repo.schedule=()=>{};t.after(()=>repo.close());await repo.ready;return {repo,storage};
}
test('重复刷新替换当天累计步数，不累加，离线保存在同步队列',async t=>{
 const {repo}=await fixture(t),date=localDay();await saveAutomaticSteps(repo,{date,steps:100});await saveAutomaticSteps(repo,{date,steps:150});assert.equal(repo.measurement(date).steps,150);assert.ok(repo.state.outbox.some(r=>r.type==='measurement'&&r.id===date&&r.data.steps===150));
});
test('相同步数不反复写盘，系统返回零步是有效数据',async t=>{
 const {repo,storage}=await fixture(t),date=localDay();assert.equal(await saveAutomaticSteps(repo,{date,steps:0}),true);const count=storage.saves;assert.equal(await saveAutomaticSteps(repo,{date,steps:0}),false);assert.equal(storage.saves,count);assert.equal(repo.measurement(date).steps,0);
});
test('自动更新保留体重等字段，手动保存其他字段不覆盖刚读取的步数',async t=>{
 const {repo}=await fixture(t),date=localDay();await repo.request('measurements',{method:'PUT',body:JSON.stringify({date,weightKg:70,steps:999})});assert.equal(repo.measurement(date).steps,null);
 await Promise.all([saveAutomaticSteps(repo,{date,steps:250}),repo.request('measurements',{method:'PUT',body:JSON.stringify({date,weightKg:71,steps:0})})]);assert.equal(repo.measurement(date).steps,250);assert.equal(repo.measurement(date).weightKg,71);
});
test('不把跨日返回和历史日期读数写到今天',async t=>{
 const {repo}=await fixture(t);assert.equal(await saveAutomaticSteps(repo,{date:'2000-01-01',steps:123}),false);assert.equal(repo.measurement(localDay()).steps,null);assert.equal(repo.state.outbox.length,0);
});
test('拒绝无效步数，读取失败时不会写入假零值',async t=>{
 const {repo}=await fixture(t),date=localDay();await saveAutomaticSteps(repo,{date,steps:123});for(const steps of [-1,NaN,Infinity,1.2,'100',null,200001])await assert.rejects(saveAutomaticSteps(repo,{date,steps}));assert.equal(repo.measurement(date).steps,123);
});
test('存储失败不改变已有步数，可再次刷新恢复',async t=>{
 const {repo,storage}=await fixture(t),date=localDay();await saveAutomaticSteps(repo,{date,steps:100});storage.fail=true;await assert.rejects(saveAutomaticSteps(repo,{date,steps:200}),/disk full/);assert.equal(repo.measurement(date).steps,100);storage.fail=false;await saveAutomaticSteps(repo,{date,steps:200});assert.equal(repo.measurement(date).steps,200);
});

test('实时步数落盘并进入队列，不按每个步数触发网络同步',async t=>{
 const {repo}=await fixture(t);let schedules=0;repo.schedule=()=>{schedules++};for(const steps of [10,11,12])await saveAutomaticSteps(repo,{date:localDay(),steps});assert.equal(schedules,0);assert.equal(repo.measurement(localDay()).steps,12);assert.ok(repo.state.outbox.length>0);
});
