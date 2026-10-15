import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInitiative,advanceEffectClocks,periodicModifiers,applyPeriodic,advanceCombatEffects,combatConditions,hasCombatEffects} from '../combat-rules.js';

const sheet=(extra={})=>({rulesEdition:'2014',abilities:{dex:{score:16}},bars:{bar_1:{value:20,max:20},bar_2:{value:0,max:0}},...extra});
const event=(extra={})=>({phase:'start',periodic:true,isCurrent:true,tokenId:'token',actorId:'actor',
  ownerActorId:'actor',documentKey:['actor','actor'],clockKeys:new Set(),conditions:[],actorType:'character',...extra});
const effect=(value=3,extra={})=>({data:{duration:{type:'turns',value,expires:'start',...extra}}});
const periodic=(value=3,extra={})=>({data:{modifiers:[{operation:'damage_over_time',target:'damage.self',value,...extra}]}});

test('effect detection rejects empty, disabled, unequipped and unmatched documents without mutating input',()=>{
  const tick=event({periodic:false}),clock=effect(3,{sourceTokenId:'someone-else'});
  for(const source of [sheet(),sheet({effects:[clock]}),sheet({effects:[effect(3,{remaining:'invalid'})]}),
    sheet({effects:[{...effect(),enabled:false}]}),sheet({effects:[{data:{duration:{type:'turns',value:3}}}]}),
    sheet({inventory:[periodic(3)]}),sheet({effects:[{...periodic(3),enabled:false}]})]){
    const before=structuredClone(source),keys=new Set(tick.clockKeys);
    assert.equal(hasCombatEffects(source,[tick]),false);assert.deepEqual(source,before);assert.deepEqual(tick.clockKeys,keys);
  }
  const source=sheet({effects:[effect(0)]}),before=structuredClone(source);
  assert.equal(hasCombatEffects(source,[tick]),true);assert.deepEqual(source,before);assert.equal(tick.clockKeys.size,0);
  tick.clockKeys.add(JSON.stringify([...tick.documentKey,0,tick.phase]));
  assert.equal(hasCombatEffects(source,[tick]),false);assert.equal(tick.clockKeys.size,1);
  assert.equal(hasCombatEffects(sheet({effects:[effect(3,{sourceActorId:'actor',sourceTokenId:'other'})]}),[event()]),false);
  assert.equal(hasCombatEffects(sheet({effects:[effect(3,{sourceActorId:'actor'})]}),[event({isCurrent:false})]),true);
});

test('effect detection conservatively retains eligible periodic and conditional candidates without evaluating formulas',()=>{
  const cases=[sheet({effects:[periodic('not valid syntax;')]}),
    sheet({features:[{data:{condition:'1d6 > 3'}}]}),sheet({features:[{data:{condition:'invalid condition;'}}]}),
    sheet({inventory:[{...periodic(3),equipped:true}]}),sheet({effects:[effect(3,{remaining:2})]})];
  for(const source of cases){
    const before=structuredClone(source);assert.equal(hasCombatEffects(source,[event()]),true);assert.deepEqual(source,before);
  }
  for(const source of [sheet({effects:[periodic()]}),sheet({features:[{data:{condition:'1d6'}}]})]){
    assert.equal(hasCombatEffects(source,[event({periodic:false})]),false);
    assert.equal(hasCombatEffects(source,[event({isCurrent:false})]),false);
    assert.equal(hasCombatEffects(source,[event({phase:'end'})]),false);
  }
  assert.equal(hasCombatEffects(sheet({effects:[{data:{condition:'  '}}]}),[event()]),false);
  assert.equal(hasCombatEffects(sheet({effects:[{data:{requiresAttunement:true,condition:'1d6'}}]}),[event()]),false);
});

test('initiative derives source ability with equipment without persisting stale derived values',()=>{
  const source=sheet({init:99,init_misc:2,inventory:[{equipped:true,attuned:true,data:{requiresAttunement:true,
    effectTemplates:[{passive:true,changes:[{target:'ability.dex.score',operation:'minimum',value:19}]}]}}]});
  const before=structuredClone(source),prepared=prepareInitiative('1d20 + @init',source);
  assert.equal(prepared.data.init,6);assert.equal(prepared.data.abilities.dex.mod,4);assert.deepEqual(source,before);
  assert.equal(prepareInitiative('1d20 + @init',{init:7}).data.init,7);
});

test('initiative handles 2014/2024 exhaustion, canonical conditions, immunities and cancellation',()=>{
  assert.equal(prepareInitiative('1d20 + @init',sheet({exhaustion:1})).formula,'2d20kl1 + @init');
  const source=sheet({rulesEdition:'2024',exhaustion:2,conditions:['invisible','surprised']});
  assert.equal(prepareInitiative('1d20 + @init',source).formula,'1d20 + @init - 4');
  assert.equal(prepareInitiative('2d20kh1 + @init',source).formula,'2d20kh1 + @init - 4');
  assert.equal(prepareInitiative('1d20',sheet(),{conditions:[{label:'Poisoned',id:'uuid'}]}).formula,'1d20');
  assert.equal(prepareInitiative('1d20',sheet(),{conditions:[{code:'poisoned'}]}).formula,'2d20kl1');
  assert.equal(prepareInitiative('1d20',sheet({conditionImmunities:['poisoned']}),{conditions:[{conditionId:'poisoned'}]}).formula,'1d20');
});

test('initiative equipment training, attunement and modifier dice follow the declared item gates',()=>{
  const source=sheet({armorTraining:{heavy:false},inventory:[{type:'armor',equipped:true,data:{armor_type:'heavy'}}],
    effects:[{data:{modifiers:[{target:'roll.check',operation:'add',value:2},{target:'roll.initiative',operation:'add_dice',value:'1d4'}]}}]});
  assert.equal(prepareInitiative('1d20 + @init + 9',source).formula,'2d20kl1 + @init + 9 + (2) + 1d4');
  source.inventory[0].data={armor_type:'shield',trained:false};source.rulesEdition='2024';
  assert.equal(prepareInitiative('1d20',source).formula,'1d20 + (2) + 1d4');
  source.effects[0].data.modifiers[1].value='1d4; invalid';
  assert.throws(()=>prepareInitiative('1d20',source),{code:'combat-formula-invalid'});
});

test('explicit duration expires once per shared event while informational durations stay manual',()=>{
  const source={effects:[effect(),effect(3,{expires:undefined})]},before=structuredClone(source),tick=event({periodic:false});
  const first=advanceEffectClocks(source,tick);
  assert.equal(first.changed,true);assert.equal(first.data.effects[0].data.duration.remaining,2);
  assert.equal(first.data.effects[1].duration,undefined);assert.deepEqual(source,before);
  const second=advanceEffectClocks(first.data,tick);assert.equal(second.changed,false);
  assert.equal(second.data.effects[0].data.duration.remaining,2);
});

test('token source takes priority, independent tokens do not tick actor owner clocks, canonical data wins',()=>{
  const source={effects:[effect(),effect(3,{sourceActorId:'actor'}),effect(3,{sourceTokenId:'other',sourceActorId:'actor'})]};
  source.effects[0].duration={type:'turns',value:99,expires:'end'};
  const result=advanceEffectClocks(source,event({isCurrent:false,tokenId:'independent'}));
  assert.equal(result.data.effects[0].data.duration.remaining,undefined);
  assert.equal(result.data.effects[1].data.duration.remaining,2);
  assert.equal(result.data.effects[2].data.duration.remaining,undefined);
  assert.equal(advanceEffectClocks({effects:[effect(1)]},event()).data.effects[0].enabled,false);
  for(const value of [true,null,'2.0',10001,-1])assert.equal(advanceEffectClocks({effects:[effect(value)]},event()).changed,false);
});

test('periodic effects require enabled, equipped, attuned items and evaluated conditions',async()=>{
  const item=periodic('1+2',{damageType:'fire'});item.data.requiresAttunement=true;item.data.condition='@sheet.level >= 2';
  for(const [equipped,attuned,enabled,level,loss] of [[false,true,true,2,0],[true,false,true,2,0],
    [true,true,false,2,0],[true,true,true,1,0],[true,true,true,2,1]]) {
    const source=sheet({level,damageTraits:{resistances:['fire']},inventory:[{...structuredClone(item),equipped,attuned,enabled}]});
    const result=await advanceCombatEffects(source,event());assert.equal(result.data.bars.bar_1.value,20-loss);
    assert.equal(result.changed,loss>0);
  }
});

test('expiration precedes periodic damage, skips never cause periodic damage, other documents remain untouched',async()=>{
  const source=sheet({effects:[{...periodic(100),data:{...periodic(100).data,duration:{type:'turns',value:1,expires:'start'}}}]});
  assert.equal((await advanceCombatEffects(source,event({isCurrent:false}))).changed,false);
  const result=await advanceCombatEffects(source,event());assert.equal(result.data.bars.bar_1.value,20);
  assert.equal(result.data.effects[0].enabled,false);
  assert.equal((await advanceCombatEffects(sheet({effects:[periodic(3)]}),event({periodic:false}))).changed,false);
});

test('periodic conditions and formulas observe earlier applied changes in collection order',async()=>{
  const first=periodic(4),second=periodic('@sheet.bars.bar_1.value');second.data.condition='@sheet.bars.bar_1.value == 16';
  const source=sheet({inventory:[{...first,equipped:true}],effects:[second]});
  const result=await advanceCombatEffects(source,event());assert.equal(result.data.bars.bar_1.value,0);
  assert.equal(result.data.lastDamage.amount,16);assert.equal(source.bars.bar_1.value,20);
});

test('periodic damage applies resistance before temporary HP and retains each concentration check',async()=>{
  const source=sheet({bars:{bar_1:{value:100,max:100},bar_2:{value:100,max:0}},rulesEdition:'2024',
    concentration:{active:true,sourceId:'spell'},damageTraits:{resistances:['fire']},effects:[periodic(80,{damageType:'fire'}),periodic(4)]});
  const result=await advanceCombatEffects(source,event());assert.equal(result.data.bars.bar_2.value,56);
  assert.equal(result.data.bars.bar_1.value,100);assert.deepEqual(result.data.concentration.pendingChecks,[{dc:20,damage:40},{dc:10,damage:4}]);
});

test('token conditions affect damage without replacing authored conditions, and monsters die at zero by default',()=>{
  const source=sheet({conditions:['charmed'],concentration:{active:true,sourceId:'spell'}});
  const result=applyPeriodic(source,{operation:'damage_over_time',target:'bars.bar_1.value',damageType:'fire'},12,
    {conditions:[{code:'petrified'}],actorType:'character'});
  assert.equal(result.data.bars.bar_1.value,14);assert.deepEqual(result.data.conditions,['charmed']);
  assert.equal(result.data.concentration.active,false);assert.equal(result.data.concentration.pendingDC,null);
  const monster=applyPeriodic(sheet(),{operation:'damage_over_time',target:'bars.bar_1.value'},20,{actorType:'monster'});
  assert.equal(monster.data.death.dead,true);assert.equal(monster.data.deathSavesEnabled,undefined);
});

test('periodic healing wakes living targets, never revives dead targets and preserves temporary HP',()=>{
  const source=sheet({bars:{bar_1:{value:0,max:20},bar_2:{value:5,max:0}},death:{fail:2,success:1,stable:true,unconscious:true}});
  const descriptor={operation:'heal_over_time',target:'bars.bar_1.value'};
  const result=applyPeriodic(source,descriptor,3);assert.equal(result.data.bars.bar_1.value,3);
  assert.equal(result.data.bars.bar_2.value,5);assert.equal(result.data.death.fail,0);assert.equal(result.data.death.unconscious,false);
  source.death.dead=true;assert.equal(applyPeriodic(source,descriptor,100).changed,false);
});

test('generic explicit resource paths have a floor, no inferred cap and reject unsafe targets',async()=>{
  const source=sheet({charge:{value:3,max:4},effects:[periodic(5,{target:'sheet.charge.value',operation:'heal_over_time'})]});
  assert.equal((await advanceCombatEffects(source,event())).data.charge.value,8);
  source.effects=[periodic(5,{target:'resource.undeclared'}),periodic(5,{target:'sheet.__proto__.polluted'})];
  assert.deepEqual(await periodicModifiers(source,event()),[]);assert.equal({}.polluted,undefined);
  assert.equal(combatConditions(sheet(),[{conditionId:'petrified'},{code:'poisoned'}]).has('poisoned'),false);
});

test('all periodic random expressions use the durable native callback and input documents stay immutable',async()=>{
  const source=sheet({level:4,effects:[periodic('if(@sheet.level>2,die(4),1)')]});
  const before=structuredClone(source),calls=[];
  const result=await advanceCombatEffects(source,event(),{prefix:'turn-job',roll:async(formula,id)=>{calls.push({formula,id});return 3;}});
  assert.equal(result.data.bars.bar_1.value,17);assert.deepEqual(source,before);
  assert.equal(calls.length,1);assert.match(calls[0].id,/^turn-job:/);
});
