// One active plan for every diary date; transport journals are separate from plans.
export function latestCurrentPlan(rows,date,usable=()=>true){
 const candidates=rows.filter(r=>['plan','dayTarget'].includes(r.type)&&!r.deleted&&r.data&&usable(r.data));
 const current=candidates.filter(r=>r.data.currentOnly),pool=current.length?current:candidates;
 const selected=pool.sort((a,b)=>String(b.data.createdAt||'').localeCompare(String(a.data.createdAt||''))||Number(b.version||0)-Number(a.version||0)||b.id.localeCompare(a.id))[0];
 return selected?{...selected.data,date}:null;
}
