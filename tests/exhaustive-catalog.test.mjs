import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCatalog} from '../catalog.js';
import {droppedItem,itemDestination,ownedItem} from '../item-drop.js';
import {planAdvancement} from '../advancement.js';

const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const systemId='gravewright.5e-srd',COMPENDIUM='application/x-gravewright-compendium';
const collections=['2014','2024'].map(edition=>read(`compendiums/${edition}.json`));
const packs=collections.flatMap((collection,i)=>collection.packs.map(pack=>({id:`native:${i}:${pack.id}`,systemId,version:1,
  entries:pack.entries.map(item=>({id:item.id,name:item.name,kind:'item',type:item.type,version:1}))})));
const items=collections.flatMap(collection=>collection.packs.flatMap(pack=>pack.entries));
const full=new Map(items.map(item=>[item.id,item])),packFor=new Map(packs.flatMap(pack=>pack.entries.map(item=>[item.id,pack])));
const layout=read('layouts/character.sheet.gw.json'),monsterLayout=read('layouts/monster.sheet.gw.json');
const context={tableId:'exhaustive-table',role:'gm'},options={type:'character',role:'gm'};
const actor=(level=1,edition='2014')=>({rulesEdition:edition,level,abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(id=>[id,{score:10}])),skills:{},saves:{},armorTraining:{light:true,medium:true,heavy:true,shield:true},features:[],inventory:[],weapons:[],spells:[],languages:'',hpBaseMax:10,bars:{bar_1:{value:10,max:10},bar_2:{value:0,max:0}}});
const advanced=item=>['race','background','class'].includes(item.type)||item.data?.advancement?.length;
const subclass=item=>item.data?.isSubclass===true||item.data?.classType==='subclass'||item.data?.subclass===true;
function fixture(){
  const calls={single:0,batches:0,documents:0,state:0,imports:0},api={compendiums:{
    async state(){calls.state++;return {packs};},
    async read(ref){
      const pack=packs.find(pack=>pack.id===ref.packId);assert.ok(pack,'Only an exposed native pack may be read');
      if(ref.ids){
        calls.batches++;calls.documents+=ref.ids.length;assert.ok(ref.ids.length<=100);
        assert.equal(new Set(ref.ids).size,ref.ids.length);
        for(const id of ref.ids)assert.equal(packFor.get(id),pack,'Dependencies must use their actual authorized pack');
        return {entries:ref.ids.map(id=>full.get(id))};
      }
      calls.single++;assert.equal(packFor.get(ref.id),pack);return full.get(ref.id);
    },
    async import(){calls.imports++;assert.fail('Owned sheet copies must not import into the library');}
  },items:{async get(){assert.fail('Native drops must not reread a library item');}}};
  return {api,calls,engine:createCatalog(api)};
}
async function drop(item,edition,draft=actor(1,edition)){
  const fixtureState=fixture(),ref={campaign:context.tableId,packId:packFor.get(item.id).id,id:item.id,kind:'item'};
  const transfer={types:[COMPENDIUM],getData:type=>type===COMPENDIUM?JSON.stringify(ref):''};
  const target=value=>itemDestination(layout,value,{edition,role:'gm',canEdit:true});
  const resolved=await droppedItem(transfer,{api:fixtureState.api,context,accepts:value=>!!target(value),t:key=>key});
  const destination=target(resolved);assert.ok(destination,item.name);
  const catalog=advanced(resolved)?await fixtureState.engine.load({item:resolved,draft,operation:'drop'}):null;
  return {...fixtureState,resolved,destination,catalog};
}
function canonical(plan){
  return {...plan,choices:plan.choices.map(choice=>({...choice,options:[...choice.options||[]].sort((a,b)=>a.id.localeCompare(b.id))}))};
}
function answer(choices,answers,variant){
  for(const choice of choices){
    if(choice.type==='number')answers[choice.id]=variant==='last'?choice.max:choice.average||choice.min;
    else if(choice.type==='ability'){
      let remaining=choice.points;const values={},abilities=[...choice.abilities];if(variant==='last')abilities.reverse();
      for(const ability of abilities){values[ability.id]=Math.min(ability.max,remaining);remaining-=values[ability.id];}
      assert.equal(remaining,0,JSON.stringify(choice));answers[choice.id]=values;
    }else{
      const pool=[...choice.options].sort((a,b)=>a.id.localeCompare(b.id));if(variant==='last')pool.reverse();
      assert.ok(pool.length>=choice.count,`Insufficient choice pool: ${JSON.stringify(choice)}`);
      answers[choice.id]=choice.type==='select'?pool[0].id:pool.slice(0,choice.count).map(option=>option.id);
    }
  }
}
function resolve(draft,item,catalog,opts,variant='first'){
  const answers={};
  for(let round=0;round<60;round++){
    const plan=planAdvancement(draft,item,catalog,answers,{...options,...opts});
    if(!plan.choices.length)return plan;
    answer(plan.choices,answers,variant);
  }
  assert.fail(`Unresolved advancement loop for ${item.name}`);
}
const contexts=new Map();
function baseFor(item,level,edition){
  // A character's background supplies two skills independently of the class.
  // High-level Bard expertise otherwise has too few legal trained skills when
  // testing a separate subclass before its extra proficiencies are granted.
  const baseActor=()=>({...actor(level,edition),skills:{history:{prof:true},religion:{prof:true}}});
  const classId=item.data?.classIdentifier||item.data?.prerequisiteClass;
  const sourceClass=items.find(candidate=>candidate.type==='class'&&candidate.data.identifier===classId&&candidate.data.rulesEdition===item.data.rulesEdition);
  if(item.type==='class'||!sourceClass)return baseActor();
  const key=`${sourceClass.id}:${level}:${edition}`;
  if(!contexts.has(key)){
    // A matching real class, advanced without choosing its subclass yet, models
    // the legitimate separate subclass drop and supplies feature prerequisites.
    const base=structuredClone(sourceClass);base.data.advancement=base.data.advancement.filter(row=>row.type!=='Subclass');
    contexts.set(key,resolve(baseActor(),base,full,{edition,classLevel:level}).data);
  }
  return contexts.get(key);
}

test('every licensed document follows the real drop pipeline into either sheet edition without ordinary preload',async t=>{
  assert.equal(items.length,2535);assert.equal(packs.length,20);
  const totals={drops:0,ordinary:0,advanced:0,singleReads:0,dependencyReads:0,dependencyDocuments:0,maxDependencyDocuments:0};
  const byType={};
  for(const item of items)for(const edition of ['2014','2024']){
    const before=structuredClone(item),draft=baseFor(item,1,edition),result=await drop(item,edition,draft);
    totals.drops++;totals.singleReads+=result.calls.single;totals.dependencyReads+=result.calls.batches;totals.dependencyDocuments+=result.calls.documents;
    totals.maxDependencyDocuments=Math.max(totals.maxDependencyDocuments,result.calls.documents);
    byType[item.type]=(byType[item.type]||0)+1;
    assert.equal(result.calls.single,1,item.name);assert.equal(result.calls.imports,0,item.name);
    assert.equal(result.resolved.data.rulesEdition,item.data.rulesEdition);assert.deepEqual(result.resolved.data,item.data);
    if(advanced(item)){
      totals.advanced++;assert.ok(result.catalog.has(item.id));assert.ok(result.catalog.size<items.length,item.name);
      const partial=planAdvancement(draft,result.resolved,result.catalog,{}, {...options,edition});
      const complete=planAdvancement(draft,result.resolved,full,{}, {...options,edition});
      assert.deepEqual(canonical(partial),canonical(complete),`${item.data.rulesEdition}/${edition}/${item.name}`);
    }else{
      totals.ordinary++;assert.equal(result.calls.state,0,item.name);assert.equal(result.calls.batches,0,item.name);assert.equal(result.catalog,null);
      const copy=ownedItem(result.resolved,draft);assert.deepEqual(copy.data,item.data);assert.equal(copy.source,item.id);
      assert.notEqual(copy.id,item.id);assert.equal(copy.type,item.type);assert.equal(copy.attuned,false);
    }
    assert.deepEqual(item,before,`Source mutation: ${item.name}`);
  }
  assert.equal(totals.drops,5070);assert.equal(totals.advanced,186);assert.equal(totals.ordinary,4884);
  assert.equal(totals.singleReads,5070);assert.equal(Object.keys(byType).length,10); // No synthetic effects in the licensed SRD.
  t.diagnostic(JSON.stringify({totals,byType}));
});

test('all real documents respect monster routing and reject unsupported types before dependency reads',async t=>{
  let accepted=0,rejected=0;
  for(const item of items)for(const edition of ['2014','2024']){
    const {api,calls}=fixture(),ref={campaign:context.tableId,packId:packFor.get(item.id).id,id:item.id,kind:'item'};
    const transfer={types:[COMPENDIUM],getData:type=>type===COMPENDIUM?JSON.stringify(ref):''};
    const destination=value=>itemDestination(monsterLayout,value,{edition,role:'gm',canEdit:true});
    if(destination(item)){
      const resolved=await droppedItem(transfer,{api,context,accepts:value=>!!destination(value),t:key=>key}),copy=ownedItem(resolved);
      assert.deepEqual(copy.data,item.data);assert.equal(copy.source,item.id);assert.equal(copy.type,item.type);accepted++;
    }else{
      await assert.rejects(droppedItem(transfer,{api,context,accepts:value=>!!destination(value),t:key=>key}),error=>error.code==='unsupported_item');rejected++;
    }
    // One authorized read is required to validate a native compendium payload;
    // monster sheets never invoke advancement/dependency loading or import.
    assert.equal(calls.single,1);assert.equal(calls.state,0);assert.equal(calls.batches,0);assert.equal(calls.imports,0);
  }
  assert.equal(accepted+rejected,5070);assert.ok(accepted>0&&rejected>0);t.diagnostic(JSON.stringify({accepted,rejected}));
});

test('all 93 advanced documents preserve resolved semantics across levels and alternative answers',async t=>{
  let documents=0,scenarios=0,comparedPlans=0,maxReads={documents:0,name:''};
  for(const item of items.filter(advanced)){
    documents++;
    for(const level of [1,5,11,20])for(const variant of ['first','last']){
      const edition=variant==='first'?item.data.rulesEdition:item.data.rulesEdition==='2014'?'2024':'2014';
      const draft=baseFor(item,level,edition),before=structuredClone(draft),{catalog,calls,resolved}=await drop(item,edition,draft),answers={};
      const opts={...options,edition,...(item.type==='class'?{classLevel:level}:{})};
      if(calls.documents>maxReads.documents)maxReads={documents:calls.documents,name:`${item.data.rulesEdition}/${item.name}`};
      for(let round=0;round<60;round++){
        const partial=planAdvancement(draft,resolved,catalog,answers,opts),complete=planAdvancement(draft,resolved,full,answers,opts);comparedPlans++;
        assert.deepEqual(canonical(partial),canonical(complete),`${item.name}/${edition}/level${level}/${variant}/round${round}`);
        if(!complete.choices.length)break;
        assert.ok(round<59,`Unresolved ${item.name}`);answer(complete.choices,answers,variant);
      }
      assert.deepEqual(draft,before,`Draft mutation: ${item.name}`);scenarios++;
    }
  }
  assert.equal(documents,93);assert.equal(scenarios,744);
  t.diagnostic(JSON.stringify({documents,scenarios,comparedPlans,maxReads}));
});
