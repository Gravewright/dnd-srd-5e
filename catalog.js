import {dependencyIndex,selectDependencies} from './dependency-selection.js';

// Compendium documents are table-scoped reads, never public package assets.
export function catalogSignature({packs},systemId='gravewright.5e-srd'){
  return JSON.stringify(packs.filter(pack=>pack.id.startsWith('native:')&&pack.systemId===systemId).map(pack=>[pack.id,pack.version,pack.entries.map(entry=>[entry.id,entry.version]).sort((a,b)=>a[0].localeCompare(b[0]))]).sort((a,b)=>a[0].localeCompare(b[0])));
}

export async function loadCatalog(api, systemId='gravewright.5e-srd',state) {
  const {packs}=state||await api.compendiums.state(), jobs=[];
  for(const pack of packs) {
    if(!pack.id.startsWith('native:')||pack.systemId!==systemId)continue;
    const ids=pack.entries.filter(entry=>entry.kind==='item').map(entry=>entry.id);
    for(let start=0;start<ids.length;start+=100)jobs.push({packId:pack.id,ids:ids.slice(start,start+100)});
  }
  const entries=[];
  // SDK reads renew a database lease. Serialize batches so local SQLite hosts
  // do not contend for that write lock while verifying installed archives.
  for(const job of jobs){const result=await api.compendiums.read(job);entries.push(...result.entries);}
  return new Map(entries.map(item=>[item.id,item]));
}

// Reuse authorized documents within this table/module lifetime. Index updates
// invalidate both cached documents and in-flight reads when visible grants change.
export function createCatalog(api,systemId='gravewright.5e-srd'){
  let state,index,signature,generation=0,pending,queue=Promise.resolve();
  const documents=new Map();
  function update(next){
    const nextSignature=catalogSignature(next,systemId);
    if(signature!==undefined&&signature!==nextSignature){generation++;documents.clear();}
    state=next;signature=nextSignature;index=dependencyIndex(next.packs,systemId);
  }
  async function ensureState(){
    if(state)return;
    pending??=api.compendiums.state().then(next=>{if(!state)update(next);}).finally(()=>{pending=undefined;});
    await pending;
  }
  async function prepare(options){
    await ensureState();
    const revision=generation,catalog=new Map(documents);
    for(;;){
      const selection=selectDependencies({...options,catalog,index});
      for(const root of selection.roots)catalog.set(root.id,root);
      if(selection.complete)return catalog;
      const jobs=new Map();
      for(const id of selection.ids){
        const entry=index.get(id);if(!entry)continue;
        if(!jobs.has(entry.packId))jobs.set(entry.packId,[]);
        jobs.get(entry.packId).push(id);
      }
      // Explicit references outside the visible index stay missing; the planner
      // reports them without ever reading a package through a public asset URL.
      if(!jobs.size)return catalog;
      for(const [packId,ids] of jobs)for(let start=0;start<ids.length;start+=100){
        const batch=ids.slice(start,start+100),result=await api.compendiums.read({packId,ids:batch});
        if(revision!==generation)throw Object.assign(Error('Compendium access changed'),{code:'stale_context'});
        for(const item of result.entries){
          if(!batch.includes(item.id))throw Error('Invalid compendium response');
          documents.set(item.id,item);catalog.set(item.id,item);
        }
        if(batch.some(id=>!catalog.has(id)))throw Error('Incomplete compendium response');
      }
    }
  }
  return {update,load(options){
    // One shared read queue prevents duplicate dependencies and SQLite lease
    // contention when several actor windows accept drops at the same time.
    const result=queue.then(()=>prepare(options));queue=result.catch(()=>{});return result;
  }};
}
