// SRD 5.1 pp.87,358; SRD 5.2.1 pp.185,187. Rest completion is confirmed
// by the table; these tests cover rule changes without inventing a game clock.
// https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf
// https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derive,restEligibility,spendHitDie,finishShortRest,longRest,hitDicePools,consumeItem} from '../rules.js';

const schema=JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url)));
const make=(raw={},edition='2014')=>derive(raw,'character',schema,edition);
const bars=(value=5,max=30,temp=0)=>({bar_1:{value,max},bar_2:{value:temp,max:0}});
const fails=(code,fn)=>assert.throws(fn,error=>error.code===code);
const hour=3600000;
const books=Object.fromEntries(['2014','2024'].map(edition=>[edition,JSON.parse(readFileSync(new URL(`../compendiums/${edition}.json`,import.meta.url))).packs.flatMap(pack=>pack.entries)]));
const feature=(edition,name)=>structuredClone(books[edition].find(item=>item.type==='feature'&&item.name===name));

test('eligibility is reusable before rolling and rejects dead or interrupted rests without spending resources',()=>{
  for(const edition of ['2014','2024'])for(const short of [true,false]){
    const d=make({bars:bars(),hitDice:{value:2,max:2,die:'d8'},features:[{data:{uses:{value:0,max:2},recharge:'short'}}]},edition);
    const before=structuredClone(d);
    fails('rest_ineligible',()=>restEligibility(d,edition,{eligible:false},short));
    assert.deepEqual(d,before);
    d.death.dead=true;const dead=structuredClone(d);
    fails('rest_dead',()=>restEligibility(d,edition,{},short));assert.deepEqual(d,dead);
  }
  const original=make({bars:bars(0,20)});
  assert.equal(restEligibility(original,'2014',{},true),original);
  fails('rest_zero_hp',()=>restEligibility(original,'2014',{},false));
  fails('rest_zero_hp',()=>restEligibility(make({bars:bars(0,20)},'2024'),'2024',{},true));
});

test('Hit Dice use fresh effective Constitution and spend exactly the chosen multiclass reserve',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(),hitDicePools:[{id:'fighter',die:'d10',value:2,max:2},{id:'wizard',die:'d6',value:1,max:1}]},edition);
    d.abilities.con.score=16;assert.equal(d.abilities.con.mod,0);
    spendHitDie(d,'wizard',4);
    assert.equal(d.hp.value,12);assert.equal(d.hitDicePools[0].value,2);assert.equal(d.hitDicePools[1].value,0);
    const before=structuredClone(d);
    fails('hit_die_unavailable',()=>spendHitDie(d,'wizard',4));
    fails('invalid_roll',()=>spendHitDie(d,'fighter',11));
    fails('invalid_roll',()=>spendHitDie(d,'fighter',1.5));
    assert.deepEqual(d,before);
  }
});

test('attuned Constitution passives affect Hit Die healing once without changing the recorded score',()=>{
  const amulet={type:'equipment',equipped:true,attuned:true,data:{requiresAttunement:true,
    effectTemplates:[{passive:true,enabled:true,changes:[{target:'ability.con.score',operation:'minimum',value:19}]}]}};
  const d=make({bars:bars(),inventory:[amulet],hitDice:{value:2,max:2,die:'d8'}});
  d.abilities.con.mod=-5;spendHitDie(d,'default',2);
  assert.equal(d.hp.value,11);assert.equal(d.abilities.con.score,10);
  d.inventory[0].attuned=false;spendHitDie(d,'default',2);
  assert.equal(d.hp.value,13);assert.equal(d.hitDice.value,0);
});

test('Hit Die healing has the correct edition floor and can never exceed current maximum HP',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(5,6),abilities:{con:{score:2}},hitDice:{value:2,max:2,die:'d6'}},edition);
    spendHitDie(d,'default',1);assert.equal(d.hp.value,edition==='2014'?5:6);
    d.abilities.con.score=20;spendHitDie(d,'default',6);
    assert.equal(d.hp.value,6);assert.equal(d.hitDice.value,0);
  }
});

test('legacy pools clamp unavailable dice and preserve zero and numeric reserve identities',()=>{
  const d=make({bars:bars(),hitdice:'9 / 2 d8'});
  assert.equal(hitDicePools(d)[0].value,2);spendHitDie(d,'default',2);
  assert.equal(d.hitdice,'1 / 2 d8');
  const multi=make({bars:bars(),hitDicePools:[{id:0,die:'d6',value:1,max:1},{id:7,die:'d8',value:1,max:1}]});
  spendHitDie(multi,7,3);assert.equal(multi.hitDicePools[0].value,1);assert.equal(multi.hitDicePools[1].value,0);
});

test('2014 long-rest recovery is one shared half-total budget with player-chosen multiclass priority',()=>{
  const d=make({hitDicePools:[{id:'fighter',die:'d10',max:3,value:0},{id:'wizard',die:'d6',max:2,value:0}]});
  longRest(d,'2014',{hitDiceOrder:['wizard']});
  assert.deepEqual(d.hitDicePools.map(pool=>[pool.id,pool.value]),[['fighter',0],['wizard',2]]);
  const partlyFull=make({hitDicePools:[{id:'fighter',die:'d10',max:3,value:0},{id:'wizard',die:'d6',max:2,value:1}]});
  longRest(partlyFull,'2014',{hitDiceOrder:['wizard']});
  assert.deepEqual(partlyFull.hitDicePools.map(pool=>pool.value),[1,2]);
  const firstLevel=make({hitDice:{value:0,max:1,die:'d6'}});longRest(firstLevel);assert.equal(firstLevel.hitDice.value,1);
});

test('2024 long rest restores every configured pool and does not spend or change its dice types',()=>{
  const d=make({hitDicePools:[{id:'fighter',die:'d10',max:3,value:1},{id:'wizard',die:'d6',max:2,value:0}]},'2024');
  longRest(d,'2024',{hitDiceOrder:['wizard']});
  assert.deepEqual(d.hitDicePools.map(pool=>[pool.id,pool.value,pool.max,pool.die]),[['fighter',3,3,'d10'],['wizard',2,2,'d6']]);
});

test('short rest restores Pact Magic and declared uses while preserving normal slots, temporary HP and exhaustion',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(5,30,8),exhaustion:2,pactSlots:{value:0,max:2,level:3},slots:{l1:{value:0,max:4},l3:{value:0,max:2}},
      resources:{daily:{value:0,max:2,recharge:'long'},plain:{value:0,max:2}},
      features:[{data:{uses:{value:0,max:3},recovery:{short:{mode:'amount',amount:1},long:{mode:'all'}}}}]},edition);
    finishShortRest(d,edition);
    assert.equal(d.features[0].data.uses.value,1);assert.equal(d.features[0].data.usesSpent,2);
    assert.equal(d.pactSlots.value,2);assert.equal(d.pactSlots.level,3);assert.equal(d.slots.l1.value,0);assert.equal(d.slots.l3.value,0);
    assert.equal(d.hp.value,5);assert.equal(d.hp.temp,8);assert.equal(d.exhaustion,2);
    assert.equal(d.resources.daily.value,0);assert.equal(d.resources.plain.value,0);
  }
});

test('explicit per-rest resource recovery outranks legacy recharge and survives a subsequent derive',()=>{
  const d=make({features:[
    {data:{uses:{value:1,max:5},usesSpent:4,recharge:'short',recovery:{short:{mode:'amount',amount:1}}}},
    {data:{uses:{value:0,max:5},recharge:'short',recovery:{long:{mode:'amount',amount:2}}}},
  ]});
  finishShortRest(d);assert.deepEqual(d.features.map(item=>item.data.uses.value),[2,0]);
  longRest(d);assert.deepEqual(d.features.map(item=>item.data.uses.value),[2,2]);
  assert.deepEqual(d.features.map(item=>item.data.usesSpent),[3,3]);
  assert.deepEqual(make(d).features.map(item=>item.data.uses.value),[2,2]);
});

test('rest recovery refreshes a changed declarative maximum before adding recovered uses',()=>{
  const d=make({abilities:{cha:{score:14}},features:[{data:{uses:{value:0,max:2},usesProfile:{type:'abilityModifier',ability:'cha'},
    recovery:{short:{mode:'amount',amount:1},long:{mode:'all'}}}}]});
  d.abilities.cha.score=18;finishShortRest(d);
  assert.deepEqual(d.features[0].data.uses,{value:3,max:4});assert.equal(d.features[0].data.usesSpent,1);
  longRest(d);assert.deepEqual(d.features[0].data.uses,{value:4,max:4});assert.equal(d.features[0].data.usesSpent,0);
});

test('real Second Wind and Rage metadata recover all in2014 and one on a2024 short rest',()=>{
  for(const edition of ['2014','2024']){
    const d=make({scales:{fighter:{'second-wind':3},barbarian:{rages:3}},features:[feature(edition,'Second Wind'),feature(edition,'Rage')]},edition);
    for(const item of d.features){assert.ok(item.data.uses.max>0);consumeItem(item,{amount:item.data.uses.value});}
    finishShortRest(d,edition);
    assert.deepEqual(d.features.map(item=>item.data.uses.value),edition==='2014'?[1,0]:[1,1]);
    longRest(d,edition);
    assert.ok(d.features.every(item=>item.data.uses.value===item.data.uses.max&&item.data.usesSpent===0));
  }
});

test('2024 restores reduced Constitution before filling HP and uses, honoring per-level minimum and racial HP',()=>{
  const d=make({level:3,bars:bars(2,12,7),abilities:{con:{score:8},cha:{score:8}},abilityScoreBases:{con:14,cha:18},
    hpBaseMax:9,hpMaxReduction:2,hpConModifier:-1,classHitPointLevels:3,mechanicalTraits:{hpPerLevel:1},
    advancementLedger:{parents:{caster:{type:'class',classLevel:3,item:{data:{}},hpRolls:{1:6,2:1,3:4}}}},
    features:[{data:{uses:{value:0,max:1},usesProfile:{type:'max',args:[{type:'constant',value:1},{type:'abilityModifier',ability:'cha'}]},recharge:'long'}}]},'2024');
  assert.equal(d.hp.max,10);longRest(d,'2024');
  assert.equal(d.abilities.con.score,14);assert.equal(d.hpConModifier,2);assert.equal(d.hpBaseMax,17);
  assert.equal(d.hp.value,20);assert.equal(d.hp.max,20);assert.equal(d.hp.temp,0);assert.equal(d.hpMaxReduction,0);
  assert.deepEqual(d.features[0].data.uses,{value:4,max:4});assert.equal(d.features[0].data.usesSpent,0);
  const refreshed=make(d,'2024');assert.equal(refreshed.hp.value,20);assert.equal(refreshed.hp.max,20);assert.equal(refreshed.hpBaseMax,17);
});

test('2024 only restores reductions and never replaces a higher score with an old recorded baseline',()=>{
  const d=make({abilities:{str:{score:18},wis:{score:8}},abilityScoreBases:{str:14,wis:12,dex:'invalid'}},'2024');
  longRest(d,'2024');assert.equal(d.abilities.str.score,18);assert.equal(d.abilities.wis.score,12);assert.equal(d.abilities.dex.score,10);
  const original=make({abilities:{wis:{score:8}},abilityScoreBases:{wis:12},hpMaxReduction:2});
  longRest(original);assert.equal(original.abilities.wis.score,8);assert.equal(original.hpMaxReduction,2);
});

test('2014 food/drink gates exhaustion recovery and HP are filled after the exhaustion maximum changes',()=>{
  const d=make({bars:bars(5,31,8),hpBaseMax:31,exhaustion:4});assert.equal(d.hp.max,15);
  longRest(d,'2014',{foodAndDrink:false});assert.equal(d.exhaustion,4);assert.equal(d.hp.value,15);assert.equal(d.hp.temp,0);
  longRest(d,'2014',{foodAndDrink:true});assert.equal(d.exhaustion,3);assert.equal(d.hp.value,31);assert.equal(d.hp.max,31);
  const revised=make({exhaustion:2},'2024');longRest(revised,'2024',{foodAndDrink:false});assert.equal(revised.exhaustion,1);
});

test('time validation uses24h between2014 benefits and16h before a2024 rest starts, with explicit shorter-rest support',()=>{
  fails('rest_too_soon',()=>longRest(make({lastLongRest:0}),'2014',{validateTime:true,now:24*hour-1}));
  const original=make({lastLongRest:0});longRest(original,'2014',{validateTime:true,now:24*hour});assert.equal(original.lastLongRest,24*hour);
  fails('rest_too_soon',()=>longRest(make({lastLongRest:0},'2024'),'2024',{validateTime:true,now:16*hour}));
  fails('rest_too_soon',()=>longRest(make({lastLongRest:0},'2024'),'2024',{validateTime:true,startedAt:16*hour-1,now:24*hour}));
  const revised=make({lastLongRest:0},'2024');longRest(revised,'2024',{validateTime:true,now:24*hour});assert.equal(revised.lastLongRest,24*hour);
  const trance=make({lastLongRest:0},'2024');longRest(trance,'2024',{validateTime:true,durationHours:4,now:20*hour});assert.equal(trance.lastLongRest,20*hour);
  fails('rest_ineligible',()=>longRest(make({lastLongRest:0}),'2024',{validateTime:true,startedAt:25*hour,now:24*hour}));
  const first=make({},'2024');assert.equal(Object.hasOwn(first,'lastLongRest'),false);
  longRest(first,'2024',{validateTime:true,now:12*hour});assert.equal(first.lastLongRest,12*hour);
});

test('confirmed rests preserve undeclared resources, item quantities, conditions and equipment choices',()=>{
  const d=make({conditions:['poisoned'],inspiration:true,resources:{custom:{value:0,max:5}},
    inventory:[{type:'consumable',quantity:1,equipped:false,data:{uses:{value:0,max:3}}}],
    spells:[{type:'spell',prepared:false,data:{uses:{value:0,max:2},recharge:'long'}}]});
  longRest(d);
  assert.equal(d.resources.custom.value,0);assert.equal(d.inventory[0].data.uses.value,0);assert.equal(d.inventory[0].quantity,1);
  assert.equal(d.inventory[0].equipped,false);assert.equal(d.spells[0].prepared,false);assert.equal(d.spells[0].data.uses.value,2);
  assert.deepEqual(d.conditions,['poisoned']);assert.equal(d.inspiration,true);
});
