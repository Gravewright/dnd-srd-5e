import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dependencyIndex,selectDependencies} from '../dependency-selection.js';
import {planAdvancement,syncAdvancementLevel,removeAdvancement} from '../advancement.js';

const systemId='gravewright.5e-srd';
const types=['weapon','armor','equipment','consumable','spell','feat','feature','race','background','class','effect'];
const entry=(id,type='feature',data={})=>({id,name:id,type,data:{rulesEdition:'2014',...data}});
const row=(type,configuration={},extra={})=>({id:type,type,configuration,...extra});
const indexOf=items=>dependencyIndex([{id:'native:fixture',systemId,entries:items.map(item=>({id:item.id,name:item.name,kind:'item',type:item.type,version:1}))}]);
const bookOf=items=>new Map(items.map(item=>[item.id,item]));
const actor=(extra={})=>({rulesEdition:'2014',level:1,abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(id=>[id,{score:10}])),skills:{},saves:{},armorTraining:{light:true,medium:true,heavy:true,shield:true},features:[],inventory:[],weapons:[],spells:[],languages:'',hpBaseMax:10,bars:{bar_1:{value:10,max:10},bar_2:{value:0,max:0}},...extra});
const options={type:'character',role:'gm',edition:'2014'};
function load(selection,all,index){
  const catalog=new Map(selection.catalog||[]),requests=[];
  for(let round=0;round<100;round++){
    const result=selectDependencies({...selection,catalog,index});
    for(const item of result.roots)catalog.set(item.id,item);
    if(result.complete)return {catalog,requests,unresolved:result.unresolved};
    requests.push([...result.ids]);
    for(const id of result.ids){assert.ok(all.has(id),`Missing fixture ${id}`);catalog.set(id,all.get(id));}
  }
  assert.fail('Dependency selection did not converge');
}
function canonical(plan){
  return {...plan,choices:plan.choices.map(choice=>({...choice,options:[...choice.options||[]].sort((a,b)=>a.id.localeCompare(b.id))}))};
}
function answerChoices(choices,answers){
  for(const choice of choices){
    if(choice.type==='number')answers[choice.id]=choice.average||choice.min;
    else if(choice.type==='ability'){
      let remaining=choice.points;const values={};for(const ability of choice.abilities){values[ability.id]=Math.min(ability.max,remaining);remaining-=values[ability.id];}
      assert.equal(remaining,0,JSON.stringify(choice));answers[choice.id]=values;
    }else{
      const pool=[...choice.options].sort((a,b)=>a.id.localeCompare(b.id));assert.ok(pool.length>=choice.count,JSON.stringify(choice));
      answers[choice.id]=choice.type==='select'?pool[0].id:pool.slice(0,choice.count).map(option=>option.id);
    }
  }
}
function comparePlans(draft,item,all,lazy,opts={},answers={}){
  for(let round=0;round<40;round++){
    const full=planAdvancement(draft,item,all,answers,{...options,...opts}),selected=planAdvancement(draft,item,lazy,answers,{...options,...opts});
    assert.deepEqual(canonical(selected),canonical(full),`${item.name}: round ${round}`);
    if(!full.choices.length)return full;
    answerChoices(full.choices,answers);
  }
  assert.fail(`Unresolved choices: ${item.name}`);
}

test('index includes only table-exposed native item documents for the exact system',()=>{
  const packs=[{id:'native:a',systemId,entries:[{id:'yes',name:'Any translated label',kind:'item',type:'weapon',version:4},{id:'actor',kind:'actor'}]},
    {id:'native:b',systemId:'another.system',entries:[{id:'wrong-system',kind:'item'}]},
    {id:'custom',systemId,entries:[{id:'non-native',kind:'item'}]}];
  const before=structuredClone(packs),index=dependencyIndex(packs);
  assert.deepEqual([...index.keys()],['yes']);assert.equal(index.get('yes').packId,'native:a');assert.equal(index.get('yes').type,'weapon');assert.deepEqual(packs,before);
});

test('recursive grants cover all eleven types, cycles, optional items and every equipment alternative',()=>{
  const items=types.map((type,i)=>entry('item-'+i,type,{advancement:[row('ItemGrant',{items:[{id:'item-'+((i+1)%types.length),optional:true}]})]}));
  items[0].data.startingEquipment={groups:[{id:'branch',type:'OR'},{id:'left',group:'branch',type:'linked',itemId:'left'},{id:'right',group:'branch',type:'weapon',pool:['right']}]};
  items.push(entry('left','armor'),entry('right','weapon'));items[3].data.advancement.push(row('ItemGrant',{items:['unavailable']}));
  const all=bookOf(items),index=indexOf(items),draft=actor(),before=structuredClone({items,draft});
  const result=load({item:items[0],draft},all,index);
  assert.equal(result.catalog.size,13);assert.deepEqual(result.unresolved,['unavailable']);assert.ok(result.requests.every(batch=>!batch.includes(items[0].id)));
  assert.deepEqual({items,draft},before);assert.equal(all.size,13);
});

test('explicit spell pools retain every list and level alternative without reading unrelated categories',()=>{
  const spells=[entry('wizard','spell',{level:0,spellLists:['wizard']}),entry('cleric','spell',{level:0,spellLists:['cleric']}),entry('future','spell',{level:3,spellLists:['wizard']})];
  const origin=entry('origin','race',{advancement:[row('ItemChoice',{pool:spells.map(item=>item.id),restriction:{list:['class:cleric','class:wizard']},choices:{0:{count:1},5:{count:1}}})]});
  const items=[origin,...spells,entry('unrelated','armor')],result=load({item:origin},bookOf(items),indexOf(items));
  assert.deepEqual([...result.catalog.keys()].sort(),['origin','wizard','cleric','future'].sort());
});

test('dynamic feat and weapon pools load the matching types plus unknown legacy summaries',()=>{
  const origin=entry('class','class',{advancement:[row('AbilityScoreImprovement',{allowFeats:true,points:2},{level:19}),row('Trait',{choices:[{count:1,pool:['weapon:sim:*']}]})]});
  const items=[origin,entry('feat','feat',{advancement:[row('ItemGrant',{items:['spell']})]}),entry('weapon','weapon'),entry('unknown','equipment'),entry('spell','spell'),entry('irrelevant','armor')],all=bookOf(items),index=indexOf(items);
  delete index.get('unknown').type;
  const first=selectDependencies({item:origin,index});assert.deepEqual([...first.ids].sort(),['feat','weapon','unknown'].sort());
  const result=load({item:origin},all,index);assert.ok(result.catalog.has('spell'));assert.ok(!result.catalog.has('irrelevant'));
  const withoutFeats=selectDependencies({item:origin,index,options:{allowFeats:false}});assert.deepEqual(withoutFeats.ids.sort(),['weapon','unknown'].sort());
  const legacy=indexOf(items);for(const summary of legacy.values())delete summary.type;
  assert.deepEqual(selectDependencies({item:origin,index:legacy}).ids.sort(),items.filter(item=>item!==origin).map(item=>item.id).sort());
});

test('subclass explicit pools stay narrow while empty pools support custom subclasses of any item type',()=>{
  const sub=entry('sub','armor',{subclass:true,classIdentifier:'wizard'}),unrelated=entry('other','consumable');
  const origin=entry('wizard','class',{advancement:[row('Subclass',{pool:[sub.id]})]}),all=bookOf([origin,sub,unrelated]),index=indexOf([...all.values()]);
  assert.deepEqual(selectDependencies({item:origin,index}).ids,[sub.id]);
  const fallback=structuredClone(origin);fallback.data.advancement[0].configuration.pool=[];
  assert.deepEqual(selectDependencies({item:fallback,index}).ids.sort(),[sub.id,unrelated.id].sort());
});

test('class drops, sync and remove seed all ledger origins for level-dependent replanning',()=>{
  const spell=entry('innate','spell'),race=entry('race','race',{advancement:[row('ItemGrant',{items:[spell.id]},{level:5})]}),classItem=entry('class','class'),other=entry('other','feature');
  const draft=actor({advancementLedger:{parents:{race:{item:race},class:{item:classItem}}}}),index=indexOf([race,classItem,spell,other]);
  for(const operation of ['drop','sync','remove']){
    const selection=selectDependencies({item:classItem,draft,index,operation});assert.deepEqual(selection.ids,[spell.id]);assert.equal(selection.roots.length,2);
  }
  assert.equal(selectDependencies({item:other,draft,index}).roots.length,1);
  assert.deepEqual(selectDependencies({item:classItem,draft,index,options:{resyncDependents:false}}).ids,[]);
  const updated=structuredClone(classItem);updated.data.advancement=[row('ItemGrant',{items:[other.id]})];
  assert.ok(selectDependencies({item:updated,draft,index}).ids.includes(other.id));
});

const collections=['2014','2024'].map(edition=>JSON.parse(readFileSync(new URL(`../compendiums/${edition}.json`,import.meta.url),'utf8')));
const realItems=collections.flatMap(collection=>collection.packs.flatMap(pack=>pack.entries));
const realBook=bookOf(realItems),realIndex=dependencyIndex(collections.flatMap((collection,i)=>collection.packs.map(pack=>({
  id:`native:${i}:${pack.id}`,systemId,entries:pack.entries.map(item=>({id:item.id,name:item.name,kind:'item',type:item.type,version:1}))
}))));

test('all real SRD species and backgrounds produce identical choices and results with the selected catalogue',()=>{
  const origins=realItems.filter(item=>['race','background'].includes(item.type));assert.equal(origins.length,28);
  for(const item of origins){
    const selected=load({item},realBook,realIndex);assert.deepEqual(selected.unresolved,[],item.name);
    assert.ok(selected.catalog.size<realItems.length/2,`${item.name}: unnecessary full catalogue`);
    for(const level of [1,20])comparePlans(actor({level}),item,realBook,selected.catalog);
  }
});

test('all real SRD classes retain future level choices, nested feat grants, equipment and spell lists',()=>{
  const classes=realItems.filter(item=>item.type==='class');assert.equal(classes.length,24);
  for(const item of classes){
    const selected=load({item},realBook,realIndex);assert.deepEqual(selected.unresolved,[],item.name);
    for(const classLevel of [1,5,20])comparePlans(actor(),item,realBook,selected.catalog,{classLevel});
  }
});

test('sync/remove selected catalogues match full replanning including previously skipped grants',()=>{
  const spells=[entry('innate','spell'),entry('secondary-only','feature')];
  const race=entry('race','race',{advancement:[row('ItemGrant',{items:['innate']},{level:3})]});
  const first=entry('first','class',{identifier:'first',hit_die:'d8',advancement:[row('HitPoints')]}),second=entry('second','class',{identifier:'second',hit_die:'d6',advancement:[row('HitPoints'),row('ItemGrant',{items:['secondary-only']},{level:3})]});
  const all=bookOf([race,first,second,...spells]),index=indexOf([...all.values()]);
  const origin=comparePlans(actor(),race,all,all),a=comparePlans(origin.data,first,all,all),b=comparePlans(a.data,second,all,all);
  const selected=load({draft:b.data,operation:'sync'},all,index).catalog;
  const pending=syncAdvancementLevel(b.data,b.parentId,3,all),answers={};answerChoices(pending.choices,answers);
  assert.deepEqual(canonical(syncAdvancementLevel(b.data,b.parentId,3,selected,answers)),canonical(syncAdvancementLevel(b.data,b.parentId,3,all,answers)));
  assert.deepEqual(canonical(removeAdvancement(b.data,a.parentId,selected)),canonical(removeAdvancement(b.data,a.parentId,all)));
  assert.ok(selected.has('secondary-only'));assert.ok(selected.has('innate'));
});
