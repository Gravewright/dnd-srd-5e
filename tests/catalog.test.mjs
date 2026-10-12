import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog,catalogSignature,createCatalog} from '../catalog.js';

test('catalog reads only visible system packs through bounded authorized batches',async()=>{
  const entries=Array.from({length:251},(_,i)=>({id:`srd-${i}`,kind:'item'})),calls=[];
  let active=0,peak=0;
  const api={compendiums:{state:async()=>({packs:[
    {id:'native:visible',systemId:'gravewright.5e-srd',entries},
    {id:'native:other-system',systemId:'other',entries},
    {id:'user-pack',systemId:'gravewright.5e-srd',entries}
  ]}),read:async payload=>{calls.push(payload);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {entries:payload.ids.map(id=>({id,type:'spell',data:{}}))};}}};
  const catalog=await loadCatalog(api);
  assert.equal(catalog.size,251);
  assert.deepEqual(calls.map(c=>c.ids.length),[100,100,51]);
  assert(calls.every(c=>c.packId==='native:visible'));
  assert.equal(peak,1);
  assert.equal(catalog.get('srd-250').type,'spell');
});

test('catalog exposes no inaccessible packs and rejects a failed authorized read',async()=>{
  let reads=0;
  assert.equal((await loadCatalog({compendiums:{state:async()=>({packs:[]}),read:async()=>{reads++;}}})).size,0);
  assert.equal(reads,0);
  await assert.rejects(loadCatalog({compendiums:{state:async()=>({packs:[{id:'native:revoked',systemId:'gravewright.5e-srd',entries:[{id:'srd-1',kind:'item'}]}]}),read:async()=>{throw new Error('permission_denied');}}}),/permission_denied/);
});

test('catalog invalidation follows visible entries and grants rather than unrelated item events',()=>{
  const pack={id:'native:srd',systemId:'gravewright.5e-srd',version:1,entries:[{id:'a',version:1},{id:'b',version:1}]},before=catalogSignature({packs:[pack]});
  assert.equal(catalogSignature({packs:[{...pack,entries:[...pack.entries].reverse()}]}),before);
  assert.equal(catalogSignature({packs:[pack,{id:'user',systemId:'other',entries:[]}]}),before);
  assert.notEqual(catalogSignature({packs:[]}),before);
  assert.notEqual(catalogSignature({packs:[{...pack,entries:pack.entries.slice(1)}]}),before);
});

const grant=(id,children=[])=>({id,name:id,type:'feature',data:{rulesEdition:'2024',advancement:children.length?[{type:'ItemGrant',configuration:{items:children.map(id=>({id}))}}]:[]}});
const pack=entries=>({id:'native:srd',systemId:'gravewright.5e-srd',version:1,entries:entries.map(item=>({id:item.id,kind:'item',type:item.type,version:1}))});

test('a drop reads only recursive dependencies and reuses them across windows',async()=>{
  const root={...grant('dwarf',['resilience','toughness']),type:'race'},items=[grant('resilience'),grant('toughness',['darkvision']),grant('darkvision'),grant('unrelated')],calls=[];
  const state={packs:[pack(items)]},api={compendiums:{state:async()=>state,read:async request=>{calls.push(request);return {entries:items.filter(item=>request.ids.includes(item.id))};}}};
  const engine=createCatalog(api);engine.update(state);
  const [first,second]=await Promise.all([engine.load({item:root,draft:{}}),engine.load({item:root,draft:{}})]);
  assert.deepEqual(calls.map(call=>call.ids),[['resilience','toughness'],['darkvision']]);
  assert.equal(first.get('dwarf'),root);assert.equal(second.get('darkvision').id,'darkvision');
  assert(!first.has('unrelated'));
});

test('missing and inaccessible dependencies never cause unauthorized reads',async()=>{
  const engine=createCatalog({compendiums:{state:async()=>({packs:[]}),read:async()=>assert.fail('inaccessible read')}});
  const catalog=await engine.load({item:{...grant('origin',['hidden']),type:'race'},draft:{}});
  assert(catalog.has('origin'));assert(!catalog.has('hidden'));
});

test('revocation during a read cannot repopulate a cleared catalog',async()=>{
  const root={...grant('origin',['benefit']),type:'race'},benefit=grant('benefit'),state={packs:[pack([benefit])]},calls=[];
  let resolveRead,started;
  const reading=new Promise(resolve=>{started=resolve;});
  const engine=createCatalog({compendiums:{state:async()=>state,read:request=>{calls.push(request);started();return new Promise(resolve=>{resolveRead=resolve;});}}});
  engine.update(state);
  const first=engine.load({item:root,draft:{}});
  await reading;engine.update({packs:[]});resolveRead({entries:[benefit]});
  await assert.rejects(first,error=>error.code==='stale_context');
  const next=await engine.load({item:root,draft:{}});
  assert(!next.has('benefit'));assert.equal(calls.length,1);
});

test('failed reads do not poison the shared dependency queue',async()=>{
  const root={...grant('origin',['benefit']),type:'race'},benefit=grant('benefit'),state={packs:[pack([benefit])]};let count=0;
  const engine=createCatalog({compendiums:{state:async()=>state,read:async()=>{if(!count++)throw Error('unavailable');return {entries:[benefit]};}}});
  await assert.rejects(engine.load({item:root,draft:{}}),/unavailable/);
  assert((await engine.load({item:root,draft:{}})).has('benefit'));
});

test('an older initial state response never replaces a newer access event',async()=>{
  const root={...grant('origin',['current']),type:'race'},current=grant('current');let resolveState;
  const engine=createCatalog({compendiums:{state:()=>new Promise(resolve=>{resolveState=resolve;}),read:async request=>{assert.deepEqual(request.ids,['current']);return {entries:[current]};}}});
  const result=engine.load({item:root,draft:{}});
  await Promise.resolve();engine.update({packs:[pack([current])]});
  resolveState({packs:[pack([grant('old')])]});
  assert((await result).has('current'));
});
