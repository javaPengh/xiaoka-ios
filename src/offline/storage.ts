import { Capacitor,registerPlugin } from '@capacitor/core';
type NativeStore={load(options:{key:string}):Promise<{value:string|null}>;save(options:{key:string;value:string;records:string}):Promise<void>;credential(options:{action:'read'|'write'|'delete';value?:string}):Promise<{value?:string|null}>};
const native=registerPlugin<NativeStore>('OfflineStorage');
const isNative=()=>Capacitor.isNativePlatform();
let opened:Promise<IDBDatabase>|null=null;
function database(){return opened??=(new Promise((resolve,reject)=>{const req=indexedDB.open('xiaoka-offline-v1',2);req.onupgradeneeded=()=>{for(const name of ['snapshots','records','media','vault'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}));}
async function read(store:string,key:string):Promise<any>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const q=tx.objectStore(store).get(key);q.onsuccess=()=>resolve(q.result??null);q.onerror=()=>reject(q.error);});}
async function write(store:string,key:string,value:unknown,remove=false){const db=await database();return new Promise<void>((resolve,reject)=>{let tx:IDBTransaction;try{tx=db.transaction(store,'readwrite',{durability:'strict'});}catch{tx=db.transaction(store,'readwrite');}if(remove)tx.objectStore(store).delete(key);else tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('本地存储未保存成功，请检查剩余空间。'));});}
const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const blobPath=async(partition:string,id:string)=>`xiaoka-local/${await digest(partition)}/media/${id}`;
const encode=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
const decode=(text:string)=>Uint8Array.from(atob(text),char=>char.charCodeAt(0));
export const localStorageAdapter={
  async load(key:string){if(isNative()){const result=await native.load({key});const value=result.value?JSON.parse(result.value):null;recordReferences.set(key,value?.records||{});return value;}const db=await database();return new Promise<any>((resolve,reject)=>{const tx=db.transaction(['snapshots','records'],'readonly');const q=tx.objectStore('snapshots').get(key);const records=tx.objectStore('records').getAll(IDBKeyRange.bound(key+'\u001f',key+'\u001f\uffff'));tx.oncomplete=()=>{if(!q.result)return resolve(null);const value=q.result;value.records={...(value.records||{}),...Object.fromEntries(records.result.map((r:any)=>[r.key,r.value]))};recordReferences.set(key,value.records);revisions.set(key,value.storageRevision||0);resolve(value);};tx.onabort=tx.onerror=()=>reject(tx.error);});},
  async save(key:string,value:any){const previous=recordReferences.get(key)||{};const changes:{key:string;value:unknown}[]=[];for(const id of new Set([...Object.keys(previous),...Object.keys(value.records)]))if(previous[id]!==value.records[id])changes.push({key:id,value:value.records[id]??null});const meta={...value,storageRevision:(revisions.get(key)||0)+1};delete meta.records;
    if(isNative())await native.save({key,value:JSON.stringify(meta),records:JSON.stringify(changes)});
    else {const db=await database();await new Promise<void>((resolve,reject)=>{let tx:IDBTransaction;try{tx=db.transaction(['snapshots','records'],'readwrite',{durability:'strict'});}catch{tx=db.transaction(['snapshots','records'],'readwrite');}let stale=false;const current=tx.objectStore('snapshots').get(key);current.onsuccess=()=>{if((current.result?.storageRevision||0)!==(revisions.get(key)||0)){stale=true;tx.abort();return;}tx.objectStore('snapshots').put(meta,key);for(const row of changes){const id=key+'\u001f'+row.key;if(row.value===null)tx.objectStore('records').delete(id);else tx.objectStore('records').put({key:row.key,value:row.value},id);}};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(stale?Object.assign(new Error('另一个窗口更新了日记，请刷新后重试。'),{stale:true}):tx.error||new Error('本地保存失败，请检查存储空间。'));});}recordReferences.set(key,value.records);revisions.set(key,meta.storageRevision);},
  async putBlob(partition:string,id:string,blob:Blob){if(isNative()){const {Filesystem,Directory}=await import('@capacitor/filesystem');await Filesystem.writeFile({path:await blobPath(partition,id),directory:Directory.Data,data:encode(new Uint8Array(await blob.arrayBuffer())),recursive:true});}else await write('media',partition+':'+id,blob);},
  async getBlob(partition:string,id:string,mime='image/jpeg'):Promise<Blob|null>{if(isNative()){try{const {Filesystem,Directory}=await import('@capacitor/filesystem');const result=await Filesystem.readFile({path:await blobPath(partition,id),directory:Directory.Data});return new Blob([decode(String(result.data))],{type:mime});}catch{return null;}}return read('media',partition+':'+id);},
  async deleteBlob(partition:string,id:string){if(isNative()){const {Filesystem,Directory}=await import('@capacitor/filesystem');try{await Filesystem.deleteFile({path:await blobPath(partition,id),directory:Directory.Data});}catch{}}else await write('media',partition+':'+id,null,true);},
};
const recordReferences=new Map<string,Record<string,unknown>>();
const revisions=new Map<string,number>();
export async function loadCredential():Promise<any>{
  if(isNative()){const result=await native.credential({action:'read'});return result.value?JSON.parse(result.value):null;}
  const bundle=await read('vault','credential');const key=await read('vault','key');if(!bundle||!key)return null;
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bundle.iv},key,bundle.bytes)));
}
export async function storeCredential(value:unknown){
  if(isNative()){await native.credential({action:value?'write':'delete',...(value?{value:JSON.stringify(value)}:{})});return;}
  if(!value){await write('vault','credential',null,true);return;}
  let key=await read('vault','key');if(!key){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await write('vault','key',key);}
  const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));await write('vault','credential',{iv,bytes});
}
export async function requestPersistence(){if(!isNative()&&navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);}
