import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemDestination,ownedItem,equippedItems,attunedItems,acceptsItemDrop,droppedItem} from '../item-drop.js';
import {defaults} from '../rules.js';

const read=name=>JSON.parse(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'));
const layouts={character:read('layouts/character.sheet.gw.json'),monster:read('layouts/monster.sheet.gw.json')};
const collections=Object.fromEntries(['2014','2024'].map(edition=>[edition,read(`compendiums/${edition}.json`)]));
const types=read('manifest.json').system.itemTypes.map(type=>type.id);
const ITEM='application/x-gravewright-item',COMPENDIUM='application/x-gravewright-compendium';
const item=(type='weapon',edition='2014')=>({id:'library-item',name:'Example',type,canOpen:true,data:{rulesEdition:edition,quantity:3,description:'Original',props:{finesse:true}}});
const context={role:'gm',tableId:'our-table'};
const transfer=(type,payload)=>({types:[type],getData:key=>key===type?(typeof payload==='string'?payload:JSON.stringify(payload)):''});
const sourceRef={tableId:'our-table',id:'library-item'};
const packRef={campaign:'our-table',packId:'native:pack',id:'entry',kind:'item'};
const options={edition:'2014',role:'gm',canEdit:true};
const destination=value=>itemDestination(layouts.character,value,options);

test('all 11 declared types route to their real character collection and destination tab',()=>{
 const expected={weapon:['sheet.weapons','inventory'],armor:['sheet.inventory','inventory'],equipment:['sheet.inventory','inventory'],consumable:['sheet.inventory','inventory'],spell:['sheet.spells','spells'],feat:['sheet.features','bio'],feature:['sheet.features','bio'],race:['sheet.features','bio'],background:['sheet.features','bio'],class:['sheet.features','bio'],effect:['sheet.effects','effects']};
 assert.equal(types.length,11);
 for(const type of types){const found=destination(item(type));assert.ok(found,type);assert.deepEqual([found.path,found.tab],expected[type],type);}
});

test('monster routes supported types and rejects types without a declared collection',()=>{
 const expected={weapon:['sheet.attacks','main'],feat:['sheet.features','main'],feature:['sheet.features','main'],effect:['sheet.effects','effects']};
 for(const type of types){const found=itemDestination(layouts.monster,item(type),options);if(expected[type])assert.deepEqual([found.path,found.tab],expected[type],type);else assert.equal(found,null,type);}
});

test('routing requires editing and a supported source edition, with GM access for effects',()=>{
 for(const layout of Object.values(layouts))for(const type of types){
  assert.equal(itemDestination(layout,item(type),{...options,canEdit:false}),null,type);
  assert.equal(itemDestination(layout,item(type,'2030'),options),null,type);
 }
 assert.equal(itemDestination(layouts.character,item('effect'),{...options,role:'player'}),null);
 assert.equal(itemDestination(layouts.monster,item('effect'),{...options,role:'player'}),null);
 assert.equal(itemDestination(layouts.character,item(),{...options,role:'player'}).path,'sheet.weapons');
});

test('editionless legacy items remain compatible and unknown types are rejected',()=>{
 const legacy=item();delete legacy.data.rulesEdition;
 assert.equal(destination(legacy).path,'sheet.weapons');assert.equal(destination(item('unknown')),null);
 for(const edition of [null,''])assert.equal(destination(item('weapon',edition)).path,'sheet.weapons');
 for(const edition of ['2030',2024,false,'2024 ',{}])assert.equal(destination(item('weapon',edition)),null);
 assert.equal(itemDestination(layouts.character,item(),{...options,edition:'2030'}),null);
 assert.equal(itemDestination(layouts.character,null,options),null);
});

test('owned copies retain provenance, isolate their data and use independent identities',()=>{
 const original=item();original.data.provenance={sourceId:'srd-source'};
 const first=ownedItem(original),second=ownedItem(original);
 assert.notEqual(first.id,second.id);assert.notEqual(first.id,original.id);assert.equal(first.source,original.id);
 assert.equal(first.quantity,3);assert.equal(first.equipped,false);assert.equal(first.prepared,false);assert.equal(first.enabled,true);
 assert.deepEqual(first.data,original.data);first.data.props.finesse=false;first.data.provenance.sourceId='changed';
 assert.equal(original.data.props.finesse,true);assert.equal(second.data.provenance.sourceId,'srd-source');
 assert.equal(ownedItem({...original,data:{quantity:-8}}).quantity,1);assert.equal(ownedItem({...original,data:{quantity:Infinity}}).quantity,1);
});

function mockedApi(raw=item()){
 const calls={read:[],import:[],get:[]};
 const imported={...item(raw.type),id:'imported-item',data:structuredClone(raw.data)};
 const api={items:{async get(id){calls.get.push(id);return id==='library-item'?raw:imported;}},compendiums:{async read(ref){calls.read.push(ref);return raw;},async import(ref){calls.import.push(ref);return {kind:'item',id:'imported-item'};}}};
 return {api,calls};
}
const t=key=>key;
const drop=(data,api,overrides={})=>droppedItem(data,{api,context,accepts:value=>!!destination(value),t,...overrides});

test('library drops need a readable same-table source and do not create library documents',async()=>{
 const {api,calls}=mockedApi();const result=await drop(transfer(ITEM,sourceRef),api);assert.equal(result.id,'library-item');assert.equal(calls.import.length,0);
 await assert.rejects(drop(transfer(ITEM,{...sourceRef,tableId:'another-table'}),api));assert.equal(calls.get.length,1);
 const denied=mockedApi({...item(),canOpen:false});await assert.rejects(drop(transfer(ITEM,sourceRef),denied.api));assert.equal(denied.calls.import.length,0);
 const otherEdition=mockedApi(item('weapon','2024'));assert.equal((await drop(transfer(ITEM,sourceRef),otherEdition.api)).data.rulesEdition,'2024');assert.equal(otherEdition.calls.import.length,0);
 const unknownEdition=mockedApi(item('weapon','2030'));await assert.rejects(drop(transfer(ITEM,sourceRef),unknownEdition.api));assert.equal(unknownEdition.calls.import.length,0);
});

test('GM compendium drops resolve one authorized read without importing or rereading the library',async()=>{
 const {api,calls}=mockedApi();const result=await drop(transfer(COMPENDIUM,packRef),api);
 assert.deepEqual(calls.read,[{packId:packRef.packId,id:packRef.id}]);assert.deepEqual(calls.import,[]);
 assert.deepEqual(calls.get,[]);assert.equal(result.canOpen,true);assert.equal(result.canEdit,false);
 assert.equal(result.id,'library-item');assert.deepEqual(result.data,item().data);
 const player={...context,role:'player'};assert.equal(acceptsItemDrop(transfer(COMPENDIUM,packRef),player),false);
 assert.equal(acceptsItemDrop(transfer(ITEM,sourceRef),player),true);
});

test('incompatible type, edition, permissions and malformed references cause zero imports',async()=>{
 const incompatible=[item('unknown'),item('weapon','2030'),{type:'weapon',data:[]},{type:'weapon',data:null},{name:'missing shape'}];
 for(const raw of incompatible){const {api,calls}=mockedApi(raw);await assert.rejects(drop(transfer(COMPENDIUM,packRef),api));assert.equal(calls.import.length,0);assert.equal(calls.get.length,0);}
 for(const ref of [{...packRef,campaign:'other-table'},{...packRef,kind:'actor'},{...packRef,id:5},{...packRef,packId:8}]){
  const {api,calls}=mockedApi();await assert.rejects(drop(transfer(COMPENDIUM,ref),api));assert.equal(calls.read.length,0);assert.equal(calls.import.length,0);
 }
 for(const data of [transfer(COMPENDIUM,'{'),transfer(ITEM,'{')]){const {api,calls}=mockedApi();await assert.rejects(drop(data,api));assert.equal(calls.import.length,0);}
 const player=mockedApi();await assert.rejects(drop(transfer(COMPENDIUM,packRef),player.api,{context:{...context,role:'player'}}));assert.equal(player.calls.read.length,0);assert.equal(player.calls.import.length,0);
 const readonly=mockedApi();await assert.rejects(drop(transfer(COMPENDIUM,packRef),readonly.api,{accepts:value=>!!itemDestination(layouts.character,value,{...options,canEdit:false})}));assert.equal(readonly.calls.import.length,0);
 const effectPlayer=mockedApi(item('effect'));await assert.rejects(drop(transfer(COMPENDIUM,packRef),effectPlayer.api,{accepts:value=>!!itemDestination(layouts.character,value,{...options,role:'player'})}));assert.equal(effectPlayer.calls.import.length,0);
});

test('preflight rechecks cancellation and edit access after an asynchronous compendium read',async()=>{
 for(const reason of ['abort','readonly']){
  const {api,calls}=mockedApi();let resolveRead,aborted=false,canEdit=true;
  api.compendiums.read=ref=>{calls.read.push(ref);return new Promise(resolve=>{resolveRead=resolve;});};
  const pending=drop(transfer(COMPENDIUM,packRef),api,{accepts:value=>!aborted&&!!itemDestination(layouts.character,value,{...options,canEdit})});
  assert.equal(calls.read.length,1);
  if(reason==='abort')aborted=true;else canEdit=false;
  resolveRead(item());await assert.rejects(pending);assert.equal(calls.import.length,0);assert.equal(calls.get.length,0);
 }
});

test('all 2535 licensed entries in 20 packs route to either edition without changing source data',()=>{
 const schema=read('schemas/item.schema.json');
 let packs=0,entries=0;
 for(const edition of ['2014','2024'])for(const pack of collections[edition].packs){
  packs++;
  for(const entry of pack.entries){
   entries++;
   const compatible={edition,role:'gm',canEdit:true};
   const target=itemDestination(layouts.character,entry,compatible);
   assert.ok(target,`${edition}/${pack.id}/${entry.name}`);
   assert.equal(defaults(schema,entry.data).rulesEdition,edition,entry.name);
   assert.deepEqual(itemDestination(layouts.character,entry,{...compatible,edition:edition==='2014'?'2024':'2014'}),target,entry.name);
   const owned=ownedItem(entry);assert.equal(owned.data.rulesEdition,edition);assert.deepEqual(owned.data,entry.data);
  }
 }
 assert.equal(packs,20);assert.equal(entries,2535);
 const derived=Object.values(collections).flatMap(collection=>collection.packs.flatMap(pack=>pack.entries)).filter(entry=>entry.data.provenance.derivedFrom);
 assert.equal(derived.length,11);assert.equal(entries-derived.length,2524);
});

test('all real native compendium entries copy into either edition with unchanged data and provenance',async()=>{
 for(const edition of ['2014','2024'])for(const pack of collections[edition].packs)for(const entry of pack.entries)for(const targetEdition of ['2014','2024']){
  const calls=[];
  const api={compendiums:{
   async read(ref){calls.push('read');assert.equal(ref.id,entry.id);return entry;},
   async import(){assert.fail('Owned copies must not create library documents');},
  },items:{async get(){assert.fail('Compendium reads already supply the complete item');}}};
  const accepts=value=>!!itemDestination(layouts.character,value,{edition:targetEdition,role:'gm',canEdit:true});
  const result=await droppedItem(transfer(COMPENDIUM,{...packRef,packId:pack.id,id:entry.id}),{api,context,accepts,t});
  assert.deepEqual(calls,['read'],`${edition}/${entry.name}`);
  assert.equal(result.id,entry.id);assert.equal(result.canOpen,true);assert.equal(result.canEdit,false);
  const owned=ownedItem(result);
  assert.deepEqual(owned.data,entry.data,`${edition}/${entry.name}`);
  assert.equal(owned.data.rulesEdition,edition);
 }
});

test('real Armor of Vulnerability and Invulnerability accept native and local envelopes without converting editions',async()=>{
 for(const edition of ['2014','2024'])for(const name of ['Armor of Vulnerability','Armor of Invulnerability']){
  const entry=collections[edition].packs.flatMap(pack=>pack.entries).find(entry=>entry.name===name);
  assert.ok(entry,`${edition}/${name}`);
  const local={id:'local-entry',name,kind:'item',version:1,data:{name,type:entry.type,data:entry.data}};
  for(const raw of [entry,local])for(const targetEdition of ['2014','2024']){
   let imports=0,gets=0;
   const before=structuredClone(raw);
   const projected={...entry,id:'imported',canOpen:true};
   const api={compendiums:{async read(){return raw;},async import(){imports++;return {kind:'item',id:'imported'};}},items:{async get(){gets++;return projected;}}};
   const pending=droppedItem(transfer(COMPENDIUM,packRef),{api,context,t,accepts:value=>!!itemDestination(layouts.character,value,{edition:targetEdition,role:'gm',canEdit:true})});
   const result=await pending;
   assert.equal(result.id,raw.id);assert.equal(result.type,entry.type);assert.equal(result.name,name);
   assert.equal(result.canOpen,true);assert.equal(result.canEdit,false);assert.equal(imports,0);assert.equal(gets,0);
   assert.deepEqual(result.data,entry.data);assert.deepEqual(raw,before);
   assert.equal(entry.data.rulesEdition,edition);
  }
 }
});

test('canceling a resolved advancement preview leaves both actor and library untouched',async()=>{
 const original={...item('race'),id:'srd-race',data:{rulesEdition:'2024',provenance:{sourceId:'licensed-parent'},advancement:[{id:'choice',type:'Trait',configuration:{choices:[{count:1,pool:['skills:acrobatics','skills:athletics']}]}}]}},before=structuredClone(original);
 const actor={features:[],abilities:{str:{score:10}}},actorBefore=structuredClone(actor),{api,calls}=mockedApi(original);
 const resolved=await drop(transfer(COMPENDIUM,{...packRef,id:original.id}),api);
 // Choosing Cancel means the caller discards this independent document before committing a plan.
 resolved.data.provenance.sourceId='discarded preview';
 assert.deepEqual(original,before);assert.deepEqual(actor,actorBefore);
 assert.equal(calls.read.length,1);assert.equal(calls.import.length,0);assert.equal(calls.get.length,0);
});

test('compendium reads enforce live permission and ignore forged data in the drag reference',async()=>{
 const trusted={...item('spell'),id:'srd-spell',data:{rulesEdition:'2024',description:'Authorized source'}},forged={...packRef,data:{rulesEdition:'2030'},canOpen:true,name:'Forged',type:'unknown'};
 const {api,calls}=mockedApi(trusted);
 const result=await drop(transfer(COMPENDIUM,forged),api);
 assert.equal(result.id,trusted.id);assert.equal(result.name,trusted.name);assert.deepEqual(result.data,trusted.data);
 assert.deepEqual(calls.read,[{packId:packRef.packId,id:packRef.id}]);assert.deepEqual(calls.import,[]);assert.deepEqual(calls.get,[]);
 api.compendiums.read=async()=>{throw Object.assign(Error('permission_denied'),{code:'permission_denied'});};
 await assert.rejects(drop(transfer(COMPENDIUM,forged),api),{code:'permission_denied'});
 const invalid=mockedApi({id:'actor-entry',kind:'actor',data:{...item('weapon')}});
 await assert.rejects(drop(transfer(COMPENDIUM,packRef),invalid.api),{code:'unsupported_item'});
 assert.deepEqual(invalid.calls.import,[]);assert.deepEqual(invalid.calls.get,[]);
});

test('unknown editions never import even when the destination sheet uses another supported edition',async()=>{
 for(const edition of ['2014','2024']){
  const {api,calls}=mockedApi(item('armor','2030'));
  await assert.rejects(droppedItem(transfer(COMPENDIUM,packRef),{api,context,t,accepts:value=>!!itemDestination(layouts.character,value,{edition,role:'gm',canEdit:true})}),{code:'unsupported_item'});
  assert.equal(calls.import.length,0);assert.equal(calls.get.length,0);
 }
});

const armor=(id,armor_type,equipped=false)=>({id,source:`library-${id}`,name:id,type:'armor',data:{armor_type,base_ac:armor_type==='shield'?2:16,rulesEdition:'2024',provenance:{sourceId:`srd-${id}`}},equipped});
const applyEquipment=(draft,updates)=>({...draft,...Object.fromEntries(Object.entries(updates).map(([path,list])=>[path.replace(/^sheet\./,''),list]))});

test('attunement is explicit, limited to three across collections and reversible',()=>{
 const magic=id=>({...armor(id,'heavy'),data:{requiresAttunement:true},attuned:false});
 const draft={inventory:[magic('one'),magic('two')],weapons:[magic('three')],equipment:[magic('four')]},before=structuredClone(draft);
 let data=draft;for(const [path,id]of [['inventory','one'],['inventory','two'],['weapons','three']])data=applyEquipment(data,attunedItems(data,path,id,true));
 assert.throws(()=>attunedItems(data,'equipment','four',true),{code:'attunementLimit'});
 data=applyEquipment(data,attunedItems(data,'inventory','one',false));data=applyEquipment(data,attunedItems(data,'equipment','four',true));
 assert.equal(data.equipment[0].attuned,true);assert.equal(data.equipment[0].equipped,false);assert.deepEqual(draft,before);
 assert.deepEqual(attunedItems(draft,'__proto__','one',true),{});
 assert.equal(ownedItem(magic('new')).attuned,false);
});

test('equipping plate replaces chain across collections while keeping a shield equipped',()=>{
 const draft={inventory:[armor('chain','heavy',true),armor('shield','shield',true)],equipment:[armor('plate','heavy')]};
 const before=structuredClone(draft),updates=equippedItems(draft,'sheet.equipment','plate',true),result=applyEquipment(draft,updates);
 assert.deepEqual(Object.keys(updates).sort(),['sheet.equipment','sheet.inventory']);
 assert.equal(result.inventory[0].equipped,false);assert.equal(result.inventory[1].equipped,true);assert.equal(result.equipment[0].equipped,true);
 assert.deepEqual(draft,before);
 for(const path of ['inventory','equipment'])for(let i=0;i<draft[path].length;i++){
  assert.equal(result[path][i].source,draft[path][i].source);assert.deepEqual(result[path][i].data,draft[path][i].data);
 }
 result.equipment[0].data.provenance.sourceId='edited-copy';assert.equal(draft.equipment[0].data.provenance.sourceId,'srd-plate');
});

test('equipping another shield leaves one shield and the body armor equipped',()=>{
 const draft={inventory:[armor('plate','heavy',true),armor('old-shield','shield',true)],equipment:[armor('new-shield','shield')]};
 const result=applyEquipment(draft,equippedItems(draft,'inventory','old-shield',true));
 assert.deepEqual(result,draft);
 const replaced=applyEquipment(draft,equippedItems(draft,'sheet.equipment','new-shield',true));
 assert.equal(replaced.inventory[0].equipped,true);assert.equal(replaced.inventory[1].equipped,false);assert.equal(replaced.equipment[0].equipped,true);
 assert.equal([...replaced.inventory,...replaced.equipment].filter(entry=>entry.data.armor_type==='shield'&&entry.equipped).length,1);
});

test('unequipping armor does not change other slots and weapons stay independent',()=>{
 const draft={inventory:[armor('chain','heavy',true),armor('shield','shield',true)],equipment:[armor('plate','heavy')],weapons:[{...item(),id:'sword',equipped:false},{...item(),id:'bow',equipped:true}]};
 const disabled=equippedItems(draft,'sheet.inventory','chain',false);
 assert.deepEqual(Object.keys(disabled),['sheet.inventory']);assert.equal(disabled['sheet.inventory'][1].equipped,true);
 const weapons=equippedItems(draft,'sheet.weapons','sword',true);
 assert.deepEqual(Object.keys(weapons),['sheet.weapons']);assert.ok(weapons['sheet.weapons'].every(entry=>entry.equipped));
 assert.equal(draft.weapons[0].equipped,false);assert.equal(draft.inventory[0].equipped,true);
 assert.deepEqual(equippedItems(draft,'sheet.inventory','missing',true),{});
 assert.deepEqual(equippedItems(draft,'sheet.__proto__','chain',true),{});
 assert.deepEqual(equippedItems({},'sheet.inventory','chain',true),{});
});

test('first dropped armor and shield fill independent slots without replacing existing equipment',()=>{
 const original=armor('chain','heavy'),snapshot=structuredClone(original),draft={inventory:[],equipment:[]};
 const chain=ownedItem(original,draft);assert.equal(chain.equipped,true);assert.deepEqual(draft,{inventory:[],equipment:[]});
 draft.inventory.push(chain);
 const plate=ownedItem(armor('plate','heavy'),draft);assert.equal(plate.equipped,false);
 const shield=ownedItem(armor('shield','shield'),draft);assert.equal(shield.equipped,true);draft.equipment.push(shield);
 const otherShield=ownedItem(armor('other-shield','shield'),draft);assert.equal(otherShield.equipped,false);
 assert.equal(chain.equipped,true);assert.equal(shield.equipped,true);assert.deepEqual(original,snapshot);assert.deepEqual(chain.data,original.data);assert.equal(chain.source,original.id);
 assert.equal(ownedItem(original).equipped,false);assert.equal(ownedItem(item('weapon'),draft).equipped,false);assert.equal(ownedItem(item('equipment'),draft).equipped,false);
});

test('autoequip sees both legacy equipment collections and ignores unequipped armor',()=>{
 const draft={equipment:[armor('old-shield','shield',true),armor('stored-plate','heavy',false)]};
 assert.equal(ownedItem(armor('chain','heavy'),draft).equipped,true);assert.equal(ownedItem(armor('shield','shield'),draft).equipped,false);
 assert.equal(ownedItem(armor('chain','heavy'),{inventory:null,equipment:null}).equipped,true);
});
