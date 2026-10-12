// Select table-readable compendium documents needed by the advancement planner.
// This module performs no reads, makes no choices, and never mutates its inputs.
const TYPES=new Set(['weapon','armor','equipment','consumable','spell','feat','feature','race','background','class','effect']);
const list=value=>Array.isArray(value)?value:[];
const entries=value=>value instanceof Map?[...value.entries()]:Object.entries(value||{});
const reference=value=>typeof value==='string'?value:value?.id;
const subclass=item=>item?.data?.isSubclass===true||item?.data?.classType==='subclass'||item?.data?.subclass===true;

/** Index only documents exposed by the table's installed-system compendium state. */
export function dependencyIndex(packs,systemId='gravewright.5e-srd'){
  const index=new Map();
  for(const pack of list(packs)){
    if(typeof pack?.id!=='string'||!pack.id.startsWith('native:')||pack.systemId!==systemId)continue;
    for(const item of list(pack.entries))if(item?.kind==='item'&&typeof item.id==='string'&&item.id){
      index.set(item.id,{...item,packId:pack.id});
    }
  }
  return index;
}

/**
 * Call again after loading `ids`, until `complete`. Seed the caller's catalogue
 * with `roots` (already available documents) before invoking the planner.
 *
 * All supplied levels and alternative pools are traversed: a class-level or
 * choice dialog can change its answer without requiring another catalogue read.
 * A legacy index without item types falls back to every unknown-type document
 * for dynamic feat/weapon pools. Names and pack labels never imply edition/type.
 */
export function selectDependencies({item,draft={},catalog=new Map(),index=new Map(),operation='drop',options={}}={}){
  const available=new Map(entries(catalog)),summaries=new Map(entries(index));
  const roots=[],rootIds=new Set(),queue=[],visited=new Set(),ids=new Set(),unresolved=new Set(),categories=new Set();
  const seed=document=>{
    if(!document||typeof document.id!=='string'||!document.id)return;
    // The selected source takes precedence over its older ledger snapshot.
    if(!rootIds.has(document.id)){available.set(document.id,document);roots.push(document);rootIds.add(document.id);}
    queue.push(document.id);
  };
  seed(item);
  if(operation==='sync'||operation==='remove'||item?.type==='class'&&!subclass(item)&&options.resyncDependents!==false){
    for(const parent of Object.values(draft?.advancementLedger?.parents||{}))seed(parent?.item);
  }
  const request=value=>{
    const id=reference(value);if(typeof id!=='string'||!id)return;
    if(available.has(id)){queue.push(id);return;}
    if(summaries.has(id))ids.add(id);else unresolved.add(id);
  };
  const category=type=>{
    if(categories.has(type))return;categories.add(type);
    // Already loaded documents also participate in planner.values(), even when
    // they were supplied by the caller rather than this particular index.
    for(const [id,document] of available)if(type==='all'||document?.type===type)request(id);
    for(const [id,summary] of summaries){
      const document=available.get(id);
      if(document){if(type==='all'||document.type===type)request(id);}
      else if(type==='all'||summary?.type===type||!TYPES.has(summary?.type))request(id);
    }
  };
  for(let cursor=0;cursor<queue.length;cursor++){
    const id=queue[cursor];if(visited.has(id))continue;visited.add(id);
    const document=available.get(id);if(!document||typeof document!=='object')continue;
    const data=document.data||{},rows=Array.isArray(data.advancement)?data.advancement:Object.values(data.advancement||{});
    for(const row of rows){
      if(!row||typeof row!=='object')continue;const config=row.configuration||{};
      if(row.type==='ItemGrant')for(const ref of list(config.items))request(ref);
      else if(row.type==='ItemChoice')for(const ref of list(config.pool))request(ref);
      else if(row.type==='Subclass'){
        const declared=list(config.pool);if(declared.length)for(const ref of declared)request(ref);
        // The planner's subclass predicate is independent of item.type.
        else category('all');
      }else if(row.type==='Trait'){
        if(list(config.choices).some(choice=>list(choice?.pool).some(value=>typeof value==='string'&&value.startsWith('weapon:')&&value.includes('*'))))category('weapon');
      }else if(row.type==='AbilityScoreImprovement'&&(document.type==='class'||subclass(document))&&config.allowFeats&&options.allowFeats!==false)category('feat');
    }
    for(const group of list(data.startingEquipment?.groups)){
      if(group?.itemId)request(group.itemId);
      for(const ref of list(group?.pool))request(ref);
    }
  }
  return {ids:[...ids],unresolved:[...unresolved],complete:ids.size===0,roots};
}
