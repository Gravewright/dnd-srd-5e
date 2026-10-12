import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derive,edit,damage,incomingDamage,heal,grantTemporaryHP,deathSave,stabilize,concentrationDC,startConcentration,endConcentration,concentrationSave,armorState,effectiveSpeed,rollContext,automaticFailure,rollFormula,criticalFormula,spellFormula,spellRollKind,spellCast,hitDicePools,spendHitDie,finishShortRest,longRest,weaponBonuses,conditionSet,evaluateUsesProfile,consumeItem,spellSaveDC,effectiveAbilityScore} from '../rules.js';
const schema=JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url)));
const make=(raw={},edition='2014',type='character')=>derive(raw,type,schema,edition);
const bars=(value=20,max=20,temp=0)=>({bar_1:{value,max},bar_2:{value:temp,max:0}});
const changes=(...modifiers)=>({data:{modifiers}});
const attack={id:'weapon.attack',formula:'1d20'};
const weaponDamage={id:'weapon.damage',formula:'@item.data.damage'};
const weapon=(data={})=>({type:'weapon',data:{attack_ability:'auto',attack_type:'melee',damage:'1d8',...data}});
const spell=(data={})=>({id:'spell-1',type:'spell',data:{level:1,...data}});
const armor=(data={})=>({type:'armor',equipped:true,data:{armor_type:'heavy',base_ac:18,add_dex:false,...data}});
const fails=(code,fn)=>assert.throws(fn,error=>error.code===code);
const books=Object.fromEntries(['2014','2024'].map(edition=>[edition,JSON.parse(readFileSync(new URL(`../compendiums/${edition}.json`,import.meta.url))).packs.flatMap(pack=>pack.entries)]));
const fromBook=(edition,name)=>{const item=books[edition].find(item=>item.type==='spell'&&item.name===name);assert.ok(item,`${edition} ${name}`);return item;};

test('official damage order is flat reduction, resistance, vulnerability, then temporary HP',()=>{
  const d=make({bars:bars(30,30,5),effects:[changes({target:'damage.received',operation:'reduce',value:5},{target:'damage.received',operation:'resistance'},{target:'damage.received.fire',operation:'vulnerability'})]});
  assert.equal(incomingDamage(d,28,'fire'),22);damage(d,28,{damageType:'fire'});
  assert.equal(d.hp.temp,0);assert.equal(d.hp.value,13);
  assert.equal(incomingDamage(d,15,'cold'),5);
  assert.equal(incomingDamage(d,-20,'fire'),0);
  fails('invalid_damage_type',()=>incomingDamage(d,10,'translated fire'));
});

test('typed resistance does not affect other types and duplicate resistance never stacks',()=>{
  const d=make({effects:[changes({target:'damage.received.fire',operation:'resistance'},{target:'damage.received.fire',operation:'resistance'})]});
  assert.equal(incomingDamage(d,7,'fire'),3);assert.equal(incomingDamage(d,7,'cold'),7);
  d.damageTraits={immunities:['fire'],vulnerabilities:['cold']};assert.equal(incomingDamage(d,7,'fire'),0);assert.equal(incomingDamage(d,7,'cold'),14);
  d.effects.push(changes({target:'damage.received',operation:'reduce',value:20}));assert.equal(incomingDamage(d,7,'cold'),0);
});

test('temporary HP are chosen rather than added; healing preserves the buffer and respects maximum',()=>{
  const d=make({bars:bars(8,10,5)});grantTemporaryHP(d,12,{replace:false});assert.equal(d.hp.temp,5);
  grantTemporaryHP(d,3);assert.equal(d.hp.temp,3);heal(d,99);assert.equal(d.hp.value,10);assert.equal(d.hp.temp,3);
  damage(d,7);assert.equal(d.hp.value,6);assert.equal(d.hp.temp,0);
});

test('zero HP, healing and massive damage follow character death rules',()=>{
  let d=make({bars:bars(5,10)});damage(d,5);assert.equal(d.death.unconscious,true);assert.equal(d.death.dead,false);
  d.death.fail=2;d.death.success=1;heal(d,1);assert.equal(d.hp.value,1);assert.equal(d.death.fail,0);assert.equal(d.death.success,0);assert.equal(d.death.unconscious,false);
  d=make({bars:bars(5,10)});damage(d,14);assert.equal(d.death.dead,false);
  d=make({bars:bars(5,10)});damage(d,15);assert.equal(d.death.dead,true);heal(d,10);assert.equal(d.hp.value,0);
});

test('damage at zero HP removes stability and creates one failure, or two on a critical',()=>{
  const d=make({bars:bars(0,20,5)});stabilize(d);damage(d,1);
  assert.equal(d.hp.temp,4);assert.equal(d.death.stable,false);assert.equal(d.death.fail,1);
  damage(d,1,{critical:true});assert.equal(d.death.fail,3);assert.equal(d.death.dead,true);
});

test('death saves use natural 1/20 independently of modified total and reset on stability',()=>{
  const d=make({bars:bars(0,20)});deathSave(d,{natural:1,total:30});assert.equal(d.death.fail,2);
  deathSave(d,{natural:20,total:2});assert.equal(d.hp.value,1);assert.equal(d.death.fail,0);
  const stable=make({bars:bars(0,20)});for(let i=0;i<3;i++)deathSave(stable,{natural:10,total:10});
  assert.equal(stable.death.stable,true);assert.equal(stable.death.success,0);assert.equal(stable.death.fail,0);
  fails('death_save_unavailable',()=>deathSave(stable,{natural:10,total:10}));
});

test('monsters die at zero by default, while an explicit important-monster override allows saves',()=>{
  const d=make({bars:bars(2,20)},'2024','monster');damage(d,2);assert.equal(d.death.dead,true);
  const important=make({bars:bars(2,20),deathSavesEnabled:true},'2024','monster');damage(important,2);assert.equal(important.death.dead,false);
});

test('melee knockout differs between 2014 stable zero HP and 2024 unconscious one HP',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(4,10)},edition);damage(d,99,{edition,nonlethal:true,melee:true});
    assert.equal(d.hp.value,edition==='2014'?0:1);assert.equal(d.death.dead,false);assert.equal(d.death.unconscious,true);
    if(edition==='2014')assert.equal(d.death.stable,true);else{heal(d,1);assert.equal(d.death.unconscious,false);}
  }
});

test('concentration is exclusive and queues separate saves based on damage before temporary HP',()=>{
  const d=make({bars:bars(100,100,80),effects:[{id:'old',enabled:true,data:{concentration:true}},{id:'new',enabled:false,data:{concentration:true}}]});
  startConcentration(d,'old');startConcentration(d,'new');assert.equal(d.effects[0].enabled,false);assert.equal(d.effects[1].enabled,true);
  damage(d,10);damage(d,50);assert.deepEqual(d.concentration.pendingChecks,[{dc:10,damage:10},{dc:25,damage:50}]);assert.equal(d.concentration.pendingDC,10);
  concentrationSave(d,{total:10});assert.equal(d.concentration.active,true);assert.equal(d.concentration.pendingDC,25);
  concentrationSave(d,{total:24});assert.equal(d.concentration.active,false);assert.deepEqual(d.concentration.pendingChecks,[]);assert.equal(d.effects[1].enabled,false);
});

test('2024 caps concentration DC at30; unconsciousness, incapacitation and death end concentration',()=>{
  assert.equal(concentrationDC(150,'2014'),75);assert.equal(concentrationDC(150,'2024'),30);
  let d=make({bars:bars(10,10)});startConcentration(d,'spell');damage(d,10);assert.equal(d.concentration.active,false);
  d=make({conditions:['stunned'],concentration:{active:true,sourceId:'spell'}});assert.equal(d.concentration.active,false);
  fails('incapacitated',()=>startConcentration(d,'other'));endConcentration(d);assert.equal(d.concentration.pendingDC,0);
});

test('exhaustion maxima are derived once, restored when reduced, and level6 means death',()=>{
  let d=make({bars:bars(21,21),exhaustion:4});assert.equal(d.hp.max,10);assert.equal(d.hpBaseMax,21);
  d=make(d);assert.equal(d.hp.max,10);d.exhaustion=3;d=make(d);assert.equal(d.hp.max,21);
  edit(d,'sheet.hp.max',30);d=make(d);assert.equal(d.hp.max,30);
  const revised=make({bars:bars(21,21),exhaustion:4},'2024');assert.equal(revised.hp.max,21);
  assert.equal(make({exhaustion:6}).death.dead,true);
});

test('passives include applicable flat modifiers, disadvantage and cancellation; expertise implies proficiency',()=>{
  const raw={abilities:{wis:{score:14}},skills:{perception:{prof:true}},exhaustion:1};assert.equal(make(raw).passive_perception,9);
  assert.equal(make(raw,'2024').passive_perception,14);
  raw.effects=[changes({target:'roll.check',operation:'advantage'},{target:'roll.check',operation:'add',value:2})];assert.equal(make(raw).passive_perception,16);
  const expert=make({skills:{perception:{expert:true}}});assert.equal(expert.skills.perception.prof,true);assert.equal(expert.skills.perception.mod,4);
});

test('equipment AC has separate armor and shield, respects Dexterity and keeps manual AC unchanged',()=>{
  const raw={ac:15,acMode:'manual',acModeExplicit:true,abilities:{dex:{score:18}},inventory:[armor(),armor({armor_type:'shield',base_ac:2})]};assert.equal(make(raw).effective_ac,15);
  assert.equal(make({...raw,acMode:'equipment'}).effective_ac,20);
  assert.equal(make({acMode:'equipment',abilities:{dex:{score:18}}}).effective_ac,14);
  assert.equal(make({acMode:'equipment',abilities:{dex:{score:18}},inventory:[armor({armor_type:'medium',base_ac:14,add_dex:true,max_dex:2})]}).effective_ac,16);
  assert.equal(make({acMode:'equipment',abilities:{dex:{score:8}},inventory:[armor({armor_type:'medium',base_ac:14,add_dex:true,max_dex:2})]}).effective_ac,13);
});

test('shield training differs by edition and untrained armor applies only to Strength/Dexterity rolls',()=>{
  const raw={acMode:'equipment',armorTraining:{shield:false},inventory:[armor({armor_type:'shield',base_ac:2})]};
  assert.equal(make(raw).effective_ac,12);assert.equal(make(raw,'2024').effective_ac,10);
  assert.equal(armorState(make(raw)).untrained,true);assert.equal(armorState(make(raw,'2024')).untrained,false);
  const d=make({acMode:'equipment',armorTraining:{heavy:false},inventory:[armor({stealth_disadvantage:true,str_req:15})]});
  assert.equal(rollContext(d,{id:'roll.check.str'}).disadvantage,true);assert.equal(rollContext(d,{id:'roll.check.int'}).disadvantage,false);assert.equal(effectiveSpeed(d),20);
  assert.equal(rollContext(d,{id:'roll.skill.stealth'}).disadvantage,true);
});

test('unworn item modifiers stay inactive while passive features and equipped items contribute',()=>{
  const item={data:{modifiers:[{target:'stat.ac',operation:'add',value:2}]}};
  assert.equal(make({inventory:[item]}).effective_ac,10);assert.equal(make({inventory:[{...item,equipped:true}]}).effective_ac,12);
  assert.equal(make({features:[item]}).effective_ac,12);assert.equal(make({features:[{...item,enabled:false}]}).effective_ac,10);
});

test('conditions distinguish checks, attacks, contextual fear, and prone target distance',()=>{
  const d=make({conditions:['poisoned','frightened']});assert.equal(rollContext(d,{id:'roll.check.str'}).disadvantage,true);assert.equal(rollContext(d,{id:'roll.save.con'}).disadvantage,false);
  const afraid=make({conditions:['frightened']});assert.equal(rollContext(afraid,attack).disadvantage,false);assert.equal(rollContext(afraid,attack,{fearSourceVisible:true}).disadvantage,true);
  const standing=make();assert.equal(rollContext(standing,attack,{targetConditions:['prone'],distance:5}).advantage,true);assert.equal(rollContext(standing,attack,{targetConditions:['prone'],distance:10}).disadvantage,true);
  assert.equal(automaticFailure(make({conditions:['stunned']}),{id:'roll.save.dex'}),true);assert.equal(automaticFailure(make({conditions:['stunned']}),{id:'roll.save.con'}),false);
  assert.equal(rollContext(standing,attack,{targetConditions:['paralyzed'],distance:5}).critical,true);
  fails('incapacitated',()=>rollFormula(attack,make({conditions:['unconscious']}),{item:weapon()}));
});

test('2024 surprise and invisibility alter initiative while 2014 surprise does not',()=>{
  const action={id:'roll.initiative',formula:'1d20 + @sheet.init'};
  assert.equal(rollFormula(action,make({conditions:['surprised']})),'1d20 + 0');
  assert.equal(rollFormula(action,make({conditions:['surprised']},'2024')),'2d20kl1 + 0');
  assert.equal(rollFormula(action,make({conditions:['invisible']},'2024')),'2d20kh1 + 0');
});

test('critical damage doubles all selected damage dice and preserves constants and ability modifiers once',()=>{
  assert.equal(criticalFormula('1d8 + 2d6 + 4'),'2d8 + 4d6 + 4');assert.equal(criticalFormula('2d6kh1 + 3'),'(2d6kh1 + 2d6kh1) + 3');
  const d=make({abilities:{str:{score:16}}});assert.equal(rollFormula(weaponDamage,d,{item:weapon(),critical:true,extraDice:'2d6',extraModifier:1}),'2d8 + (3) + (1) + 4d6');
  assert.equal(rollFormula(weaponDamage,d,{item:weapon({versatile:'1d10'}),twoHanded:true}),'1d10 + (3)');
  assert.equal(rollFormula(weaponDamage,d,{item:weapon(),offhand:true}),'1d8');
});

test('real SRD spells keep edition-specific dice, ability modifiers, slot intervals and cantrip scaling',()=>{
  const d=make({level:11,spell:{ability:'wis'},abilities:{wis:{score:16}}},'2024');
  assert.equal(spellFormula(d,fromBook('2014','Cure Wounds'),{slotLevel:2}),'1d8 + 3 + 1d8');
  assert.equal(spellFormula(d,fromBook('2024','Cure Wounds'),{slotLevel:2}),'2d8 + 3 + 2d8');
  assert.equal(spellFormula(d,fromBook('2014','Fire Bolt')),'1d10 + 2d10');
  assert.equal(spellFormula(d,fromBook('2014','Flame Blade'),{slotLevel:3}),'3d6');
  assert.equal(spellFormula(d,fromBook('2024','Flame Blade'),{slotLevel:3}),'3d6 + 3 + 1d6');
  assert.equal(spellFormula(d,fromBook('2014','Spiritual Weapon'),{slotLevel:3}),'1d8 + 3');
  assert.equal(spellFormula(d,fromBook('2024','Spiritual Weapon'),{slotLevel:3}),'1d8 + 3 + 1d8');
});

test('spell healing is distinct from damage, manual applications stay manual, and projectile counts do not multiply damage',()=>{
  const d=make({level:17,spell:{ability:'wis'},abilities:{wis:{score:16}}});
  assert.equal(spellRollKind(fromBook('2024','Cure Wounds')),'healing');assert.equal(spellRollKind(fromBook('2024','Aid')),'manual');
  assert.equal(spellFormula(d,fromBook('2024','Scorching Ray'),{slotLevel:9}),'2d6');
  assert.equal(spellFormula(d,fromBook('2024','Magic Missile'),{slotLevel:9,critical:true}),'1d4 + 1');
  assert.equal(spellFormula(d,fromBook('2024','Cure Wounds'),{critical:true}),'2d8 + 3');
  fails('invalid_formula',()=>spellFormula(d,spell({formulaProfile:{version:1,kind:'damage',base:{dice:[{number:1,faces:6}],constant:0,spellModifier:false},scaling:{mode:'slot',dice:[{number:1000,faces:6}]}}}),{slotLevel:2}));
});

test('spell cast preflight is pure, consumes one chosen slot, and rolling damage does not consume again',()=>{
  const d=make({slots:{l2:{value:2,max:2}},spell:{ability:'wis'}}),item=fromBook('2024','Cure Wounds'),before=structuredClone(d);
  spellCast(d,item,{slotLevel:2,commit:false});assert.deepEqual(d,before);
  spellCast(d,item,{slotLevel:2});assert.equal(d.slots.l2.value,1);spellFormula(d,item,{slotLevel:2});assert.equal(d.slots.l2.value,1);
  fails('spell_slot_unavailable',()=>spellCast(d,item,{slotLevel:3}));
});

test('2014 bonus-action casting limits other spells to action cantrips in either order',()=>{
  for(const reverse of [false,true]){
    const d=make({slots:{l1:{value:4,max:4}}});const bonus=spell({actionType:'bonus'}),action=spell();
    if(reverse){spellCast(d,action,{turnKey:'t'});fails('spell_cast_restricted',()=>spellCast(d,bonus,{turnKey:'t'}));}
    else {spellCast(d,bonus,{turnKey:'t'});fails('spell_cast_restricted',()=>spellCast(d,action,{turnKey:'t'}));spellCast(d,spell({level:0}),{turnKey:'t'});fails('spell_cast_restricted',()=>spellCast(d,spell({level:0,actionType:'reaction'}),{turnKey:'t'}));}
  }
});

test('2024 allows only one expended spell slot per turn, while free and ritual casting do not spend slots',()=>{
  const d=make({slots:{l1:{value:3,max:3}},pactSlots:{value:2,max:2,level:1}},'2024');
  spellCast(d,spell(),{turnKey:'t'});fails('spell_cast_restricted',()=>spellCast(d,spell(),{turnKey:'t',pool:'pact'}));
  spellCast(d,spell(),{turnKey:'t',free:true});spellCast(d,spell({ritual:true}),{ritual:true});assert.equal(d.slots.l1.value,2);
  spellCast(d,spell(),{turnKey:'next',pool:'pact'});assert.equal(d.pactSlots.value,1);
  fails('spell_ritual_unavailable',()=>spellCast(d,spell(),{ritual:true}));
});

test('short rest spends a chosen multiclass Hit Die and 2024 healing has a minimum of1',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(5,20),abilities:{con:{score:2}},hitDicePools:[{id:'fighter',die:'d10',value:2,max:2},{id:'wizard',die:'d6',value:1,max:1}]},edition);
    spendHitDie(d,'wizard',1);assert.equal(d.hp.value,edition==='2014'?5:6);assert.equal(d.hitDicePools[1].value,0);assert.equal(d.hitDicePools[0].value,2);
    fails('hit_die_unavailable',()=>spendHitDie(d,'wizard',6));fails('invalid_roll',()=>spendHitDie(d,'fighter',11));
  }
});

test('long rest recovers half Hit Dice in2014, all in2024, and preserves recognizable legacy pools',()=>{
  for(const edition of ['2014','2024']){
    const d=make({bars:bars(5,20,8),hitdice:'0 / 5 d10',exhaustion:2},edition);longRest(d,edition);
    assert.equal(hitDicePools(d)[0].value,edition==='2014'?2:5);assert.equal(d.hp.value,20);assert.equal(d.hp.temp,0);assert.equal(d.exhaustion,1);
  }
});

test('rests recover only declared resources including partial short-rest recovery and pact slots',()=>{
  const feature={data:{uses:{value:0,max:3},recovery:{short:{mode:'amount',amount:1},long:{mode:'all'}}}};
  const d=make({features:[feature],resources:{daily:{value:0,max:2,recharge:'long'},special:{value:0,max:2}},pactSlots:{value:0,max:2,level:2},slots:{l1:{value:0,max:2}}});
  finishShortRest(d);assert.equal(d.features[0].data.uses.value,1);assert.equal(d.pactSlots.value,2);assert.equal(d.slots.l1.value,0);assert.equal(d.resources.daily.value,0);
  longRest(d);assert.equal(d.features[0].data.uses.value,3);assert.equal(d.resources.daily.value,2);assert.equal(d.resources.special.value,0);assert.equal(d.slots.l1.value,2);
});

test('rest eligibility blocks zero/dead/interrupted states; 2024 restores explicit maxHP reductions',()=>{
  fails('rest_zero_hp',()=>longRest(make({bars:bars(0,20)})));
  fails('rest_dead',()=>longRest(make({death:{dead:true}})));
  fails('rest_ineligible',()=>finishShortRest(make(), '2014',{eligible:false}));
  const d=make({hpBaseMax:20,hpMaxReduction:5,bars:bars(10,20)},'2024');assert.equal(d.hp.max,15);longRest(d,'2024');assert.equal(d.hp.max,20);
  const timed=make({lastLongRest:0});fails('rest_too_soon',()=>longRest(timed,'2014',{validateTime:true,now:23*3600000}));
  longRest(make({lastLongRest:0}),'2024',{validateTime:true,startedAt:16*3600000,now:24*3600000});
});

test('optional schema metadata does not break legacy spells, resource recovery or ability scores',()=>{
  const d=make({features:[{data:{uses:{value:0,max:2},recharge:'short',recovery:{short:{mode:'',amount:0},long:{mode:'',amount:0}}}}]});
  longRest(d,'2024');assert.equal(d.abilities.str.score,10);assert.equal(d.abilities.dex.score,10);assert.equal(d.features[0].data.uses.value,2);
  const legacy=spell({damage:'2d6',formulaProfile:{version:'',kind:'',base:{dice:[],constant:0}}});assert.equal(spellFormula(d,legacy),'2d6');
});

test('multiclass spell ability overrides affect attack and damage, without adding ability universally',()=>{
  const d=make({level:5,spell:{ability:'int'},abilities:{int:{score:10},wis:{score:18}}});
  const item=spell({spell_ability:'wis',formulaProfile:{version:1,kind:'damage',base:{dice:[{number:1,faces:6}],spellModifier:true}}});
  assert.equal(rollFormula({id:'spell.attack',formula:'1d20 + @sheet.spell.attack'},d,{item}),'1d20 + 7');assert.equal(spellFormula(d,item),'1d6 + 4');
  item.data.formulaProfile.base.spellModifier=false;assert.equal(spellFormula(d,item),'1d6');
});

test('petrification resists all damage and grants poison immunity, while 2024 seeing invisibility removes its attack benefit',()=>{
  const d=make({conditions:['petrified']});assert.equal(incomingDamage(d,9,'force'),4);assert.equal(incomingDamage(d,9,'poison'),0);
  for(const edition of ['2014','2024']){
    const invisible=make({conditions:['invisible']},edition);assert.equal(rollContext(invisible,attack,{targetCanSeeAttacker:true}).advantage,edition==='2014');
    assert.equal(rollContext(make({},edition),attack,{targetConditions:['invisible'],canSeeTarget:true}).disadvantage,edition==='2014');
  }
});

test('bar edits wake a living zero-HP creature but cannot silently resurrect the dead',()=>{
  const d=make({bars:bars(0,20),death:{success:1,fail:2}});d.bars.bar_1.value=5;
  const woken=make(d);assert.equal(woken.death.unconscious,false);assert.equal(woken.death.fail,0);
  const dead=make({bars:bars(5,20),death:{dead:true}});assert.equal(dead.hp.value,0);
  assert.equal(make({bars:bars(0,20),death:{fail:3}}).death.dead,true);
  assert.equal(make({bars:bars(0,0)},'2024').death.dead,true);
});

test('2014 Inspiration independently grants advantage and cancels manual or condition disadvantage without consuming it',()=>{
  const action={id:'roll.check.str',formula:'1d20 + @sheet.abilities.str.mod'},d=make({inspiration:true});
  assert.equal(rollFormula(action,d,{mode:'disadvantage',inspiration:true}),'1d20 + 0');
  assert.equal(rollFormula(action,make({conditions:['poisoned'],inspiration:true}),{inspiration:true}),'1d20 + 0');
  assert.equal(rollFormula(action,d,{mode:'normal',inspiration:true}),'2d20kh1 + 0');
  assert.equal(d.inspiration,true);
});

test('missing armor training is visibly true and explicit false training survives derive',()=>{
  assert.deepEqual(make().armorTraining,{light:true,medium:true,heavy:true,shield:true});
  assert.deepEqual(make({armorTraining:{medium:false,shield:false}}).armorTraining,{light:true,medium:false,heavy:true,shield:false});
});

test('a partial long-rest Hit Dice priority restores the selected pool before omitted pools',()=>{
  const d=make({hitDicePools:[{id:'fighter',die:'d10',value:0,max:2},{id:'wizard',die:'d6',value:0,max:2}]});
  longRest(d,'2014',{hitDiceOrder:['wizard']});
  assert.equal(d.hitDicePools[1].value,2);assert.equal(d.hitDicePools[0].value,0);
});

test('characters default to equipment AC: unarmored Dexterity, armor base replacement and one shield',()=>{
  let d=make({abilities:{dex:{score:16}}});assert.equal(d.acMode,'equipment');assert.equal(d.effective_ac,13);
  d=make({ac:19,abilities:{dex:{score:16}},inventory:[armor({armor_type:'light',base_ac:11,add_dex:true})]});assert.equal(d.effective_ac,14);assert.equal(d.ac,19);
  d=make({abilities:{dex:{score:16}},inventory:[armor(),armor({armor_type:'shield',base_ac:2}),armor({armor_type:'shield',base_ac:2})]});assert.equal(d.effective_ac,20);assert.equal(armorState(d).multipleShields,true);
});

test('legacy default-manual character drafts with equipped armor migrate; explicit manual and monsters do not',()=>{
  const raw={ac:17,acMode:'manual',inventory:[armor()]};
  const migrated=make(raw);assert.equal(migrated.acMode,'equipment');assert.equal(migrated.effective_ac,18);assert.equal(migrated.ac,17);assert.equal(raw.acMode,'manual');
  const explicit=make({...raw,acModeExplicit:true});assert.equal(explicit.acMode,'manual');assert.equal(explicit.effective_ac,17);
  assert.equal(make({ac:17,acMode:'manual'}).effective_ac,17);
  const monster=make({ac:17,abilities:{dex:{score:18}},inventory:[armor()]},'2024','monster');assert.equal(monster.acMode,'manual');assert.equal(monster.effective_ac,17);
});

test('automatic armor AC includes typed AC modifiers after armor and shield rather than adding the manual base',()=>{
  const d=make({ac:10,inventory:[armor(),armor({armor_type:'shield',base_ac:2})],effects:[changes({target:'stat.ac',operation:'add',value:2},{target:'stat.armor_class',operation:'subtract',value:1})]});
  assert.equal(d.effective_ac,21);assert.equal(d.ac,10);
});

test('save proficiency adds only the level proficiency bonus to the existing ability modifier',()=>{
  const raw={level:5,abilities:{dex:{score:14}},saves:{dex:{prof:false}}};assert.equal(make(raw).saves.dex.mod,2);
  const proficient=make({...raw,saves:{dex:{prof:true}}});assert.equal(proficient.prof,3);assert.equal(proficient.saves.dex.mod,5);
  assert.equal(rollFormula({id:'roll.save.dex',formula:'1d20 + @sheet.saves.dex.mod'},proficient),'1d20 + 5');
});

test('manual AC overrides only AC, not equipped armor training, Stealth, movement or spell restrictions',()=>{
  for(const edition of ['2014','2024']){
    const d=make({ac:17,acMode:'manual',acModeExplicit:true,armorTraining:{heavy:false},inventory:[armor({str_req:15,stealth_disadvantage:true})]},edition);
    assert.equal(d.effective_ac,17);assert.equal(effectiveSpeed(d),20);
    assert.equal(rollContext(d,{id:'roll.check.str'}).disadvantage,true);
    assert.equal(rollContext(d,{id:'roll.save.dex'}).disadvantage,true);
    assert.equal(rollContext(d,{id:'roll.check.int'}).disadvantage,false);
    assert.equal(rollContext(d,{id:'roll.skill.stealth'}).disadvantage,true);
    fails('incapacitated',()=>spellCast(d,spell({level:0})));
  }
});

test('explicit heavy-armor speed exemption preserves the other armor penalties',()=>{
  const d=make({speed:25,mechanicalTraits:{ignoreHeavyArmorSpeedPenalty:true},armorTraining:{heavy:false},inventory:[armor({str_req:15,stealth_disadvantage:true})]});
  assert.equal(effectiveSpeed(d),25);assert.equal(rollContext(d,{id:'roll.skill.stealth'}).disadvantage,true);
  fails('incapacitated',()=>spellCast(d,spell({level:0})));
  const renamed=make({race:'Dwarf',speed:25,inventory:[armor({str_req:15})]});assert.equal(effectiveSpeed(renamed),15);
});

test('per-level HP grants are idempotent across derive, level changes, manual maximum edits and removal',()=>{
  let d=make({level:5,bars:bars(20,20),mechanicalTraits:{hpPerLevel:1,hpFlat:2}});
  assert.equal(d.hp.max,27);assert.equal(d.hpBaseMax,20);assert.equal(d.hpTraitBonus,7);
  d=make(d);assert.equal(d.hp.max,27);d.level=6;d=make(d);assert.equal(d.hp.max,28);
  edit(d,'sheet.hp.max',35);d=make(d);assert.equal(d.hp.max,35);assert.equal(d.hpBaseMax,27);
  d.exhaustion=4;d=make(d);assert.equal(d.hp.max,17);d.exhaustion=3;d=make(d);assert.equal(d.hp.max,35);
  d.mechanicalTraits={};d=make(d);assert.equal(d.hp.max,27);assert.equal(d.hpTraitBonus,0);
});

test('racial and class save advantages require a matching explicit context, while initiative is unconditional',()=>{
  const d=make({mechanicalTraits:{initiativeAdvantage:true,saveAdvantages:['charmed','poisoned']}},'2024');
  assert.equal(rollContext(d,{id:'roll.initiative'}).advantage,true);
  assert.equal(rollContext(d,{id:'roll.save.wis'}).advantage,false);
  assert.equal(rollContext(d,{id:'roll.save.wis'},{saveAgainst:'charmed'}).advantage,true);
  assert.equal(rollContext(d,{id:'roll.save.con'},{saveAgainst:['poisoned']}).advantage,true);
  assert.equal(rollContext(d,{id:'roll.save.dex'},{saveAgainst:'frightened'}).advantage,false);
  assert.equal(rollContext(d,{id:'roll.check.wis'},{saveAgainst:'charmed'}).advantage,false);
  assert.equal(rollFormula({id:'roll.save.wis',formula:'1d20'},d,{saveAgainst:'charmed',mode:'disadvantage'}),'1d20');
});

test('2024 petrification resists poison damage instead of granting the 2014 poison damage immunity',()=>{
  assert.equal(incomingDamage(make({conditions:['petrified']},'2014'),9,'poison'),0);
  assert.equal(incomingDamage(make({conditions:['petrified']},'2024'),9,'poison'),4);
  assert.equal(incomingDamage(make({conditions:['petrified'],damageTraits:{immunities:['poison']}},'2024'),9,'poison'),0);
});

test('unattuned equipment retains mundane armor and weapon use but not its declared magic or passive modifiers',()=>{
  const magic=weapon({attack_bonus:2,damage_bonus:2,magicBonus:2,requiresAttunement:true,modifiers:[{target:'stat.ac',operation:'add',value:1}]});
  magic.equipped=true;
  const d=make({abilities:{str:{score:16}},weapons:[magic]});
  assert.equal(weaponBonuses(d,magic).attackBonus,5);assert.equal(weaponBonuses(d,magic).damageBonus,3);assert.equal(d.effective_ac,10);
  magic.attuned=true;assert.equal(weaponBonuses(d,magic).attackBonus,7);assert.equal(weaponBonuses(d,magic).damageBonus,5);
  assert.equal(make({...d,weapons:[magic]}).effective_ac,11);
  const suit=armor({base_ac:20,magicBonus:2,requiresAttunement:true}),shield=armor({armor_type:'shield',base_ac:3,magicBonus:1,requiresAttunement:true});
  assert.equal(make({inventory:[suit,shield]}).effective_ac,20);
  suit.attuned=true;shield.attuned=true;assert.equal(make({inventory:[suit,shield]}).effective_ac,23);
  // Unbound metadata is opt-in; legacy equipment keeps its recorded bonuses.
  delete suit.data.requiresAttunement;delete shield.data.requiresAttunement;delete suit.attuned;delete shield.attuned;
  assert.equal(make({inventory:[suit,shield]}).effective_ac,23);
});

test('rituals cannot be upcast and Pact Magic always uses the reserve actual slot level',()=>{
  for(const edition of ['2014','2024']){
    const d=make({slots:{l1:{value:2,max:2}},pactSlots:{value:2,max:2,level:3}},edition);
    fails('spell_ritual_unavailable',()=>spellCast(d,spell({ritual:true}),{ritual:true,slotLevel:2}));
    assert.equal(d.slots.l1.value,2);
    fails('spell_slot_unavailable',()=>spellCast(d,spell(),{pool:'pact',slotLevel:1}));assert.equal(d.pactSlots.value,2);
    spellCast(d,spell(),{pool:'pact'});assert.equal(d.pactSlots.value,1);
    spellCast(d,spell({ritual:true}),{ritual:true});assert.equal(d.slots.l1.value,2);
    fails('spell_slot_unavailable',()=>spellCast(d,spell(),{pool:'unknown'}));
  }
});

test('condition immunity suppresses its active penalty without destroying manually recorded state',()=>{
  const d=make({conditions:['poisoned'],conditionImmunities:['poisoned']});assert.equal(conditionSet(d).has('poisoned'),false);
  assert.equal(rollContext(d,{id:'roll.check.str'}).disadvantage,false);assert.deepEqual(d.conditions,['poisoned']);
  d.conditionImmunities=[];assert.equal(rollContext(d,{id:'roll.check.str'}).disadvantage,true);
  assert.equal(conditionSet(make({conditions:['petrified','poisoned']},'2024')).has('poisoned'),false);
  fails('death_save_unavailable',()=>deathSave(make({bars:bars(0,20),deathSavesEnabled:false}),{natural:20,total:20}));
});

test('class-granted weapon proficiency is opt-in, supports groups and identities, and keeps manual overrides',()=>{
  const item=weapon({weaponGroup:'martial',baseWeapon:'longsword'}),d=make({level:5,abilities:{str:{score:16}},weaponProficiencyMode:'class',weaponProficiencies:['simple']});
  assert.equal(weaponBonuses(d,item).attackBonus,3);assert.equal(weaponBonuses(d,item).proficient,false);
  d.weaponProficiencies.push('longsword');assert.equal(weaponBonuses(d,item).attackBonus,6);
  d.weaponProficiencies=['martial'];assert.equal(weaponBonuses(d,item).attackBonus,6);
  item.data.proficiencyMode='manual';item.data.proficient=false;assert.equal(weaponBonuses(d,item).attackBonus,3);
  item.data.proficient=true;assert.equal(weaponBonuses(d,item).attackBonus,6);
  assert.equal(weaponBonuses(d,weapon()).attackBonus,6); // Metadata-free legacy item.
});

test('resource AST maxima preserve spent uses across proficiency, class-level and ability changes',()=>{
  const profile={type:'max',args:[{type:'constant',value:1},{type:'abilityModifier',ability:'cha'}]};
  let d=make({level:5,abilities:{cha:{score:16}},features:[{id:'resource',data:{usesProfile:profile,uses:{value:2,max:3}}}]});
  assert.deepEqual(d.features[0].data.uses,{value:2,max:3});d.abilities.cha.score=18;d=make(d);assert.deepEqual(d.features[0].data.uses,{value:3,max:4});
  consumeItem(d.features[0]);d=make(d);assert.deepEqual(d.features[0].data.uses,{value:2,max:4});
  assert.equal(evaluateUsesProfile({type:'proficiency'},d),3);
  const source={...d,classLevels:{paladin:4},scales:{fighter:{'action-surge':{value:2}}}};
  assert.equal(evaluateUsesProfile({type:'multiply',args:[{type:'constant',value:5},{type:'classLevel',classId:'paladin'}]},source),20);
  assert.equal(evaluateUsesProfile({type:'scale',classId:'fighter',identifier:'action-surge'},source),2);
  assert.equal(evaluateUsesProfile({type:'classLevel',classId:'missing'},source),null);
  assert.equal(evaluateUsesProfile({type:'divide',args:[{type:'constant',value:1},{type:'constant',value:0}]},source),null);
  assert.equal(evaluateUsesProfile({type:'scale',classId:'__proto__',identifier:'polluted'},source),null);
  assert.equal(evaluateUsesProfile({type:'javascript',value:'alert(1)'},source),null);
  let deep={type:'constant',value:1};for(let n=0;n<14;n++)deep={type:'add',args:[deep]};assert.equal(evaluateUsesProfile(deep,source),null);
});

test('class HP follows retroactive Constitution with per-level minimums while manual HP remains untouched',()=>{
  const parent={type:'class',classLevel:2,item:{data:{identifier:'wizard'}},hpRolls:{1:6,2:1}};
  const d=make({bars:bars(11,11),hpBaseMax:11,hpDerivedMax:11,hpConModifier:2,classHitPointLevels:2,abilities:{con:{score:8}},advancementLedger:{parents:{wizard:parent}}});
  assert.equal(d.hp.max,6);assert.equal(d.hpConModifier,-1);assert.equal(make(d).hp.max,6);
  assert.equal(make({bars:bars(10,10),abilities:{con:{score:8}}}).hp.max,10);
});

test('innate spell grants spend their own uses once, do not expend slots, and keep transactional preflight',()=>{
  const d=make({slots:{l1:{value:2,max:2}}},'2024'),item=spell({uses:{value:1,max:1},concentration:true});
  spellCast(d,item,{castMode:'innate',commit:false});assert.equal(item.data.uses.value,1);assert.equal(d.slots.l1.value,2);
  spellCast(d,item,{castMode:'innate',turnKey:'turn'});assert.equal(item.data.uses.value,0);assert.equal(d.slots.l1.value,2);assert.equal(d.concentration.sourceId,item.id);
  fails('resource_unavailable',()=>spellCast(d,item,{castMode:'innate'}));
  spellCast(d,spell(),{turnKey:'turn'});assert.equal(d.slots.l1.value,1); // Innate casts do not spend the turn slot.
  const free=spell({uses:{value:1,max:1}});spellCast(d,free,{free:true});assert.equal(free.data.uses.value,1);
  fails('spell_unknown_level',()=>spellCast(d,free,{castMode:'innate',slotLevel:2}));assert.equal(free.data.uses.value,1);
  const bad={...free,id:''};bad.data={...free.data,concentration:true};fails('invalid_source',()=>spellCast(d,bad,{castMode:'innate',commit:false}));assert.equal(free.data.uses.value,1);
});

test('explicit consumable use decreases owned quantity and rejects unavailable resources without mutation',()=>{
  const potion={quantity:2,data:{quantity:4}};consumeItem(potion,{quantity:true});assert.equal(potion.quantity,1);assert.equal(potion.data.quantity,4);
  const before=structuredClone(potion);fails('item_quantity_unavailable',()=>consumeItem(potion,{quantity:true,amount:2}));assert.deepEqual(potion,before);
  consumeItem(potion,{quantity:true});fails('item_quantity_unavailable',()=>consumeItem(potion,{quantity:true}));
  fails('resource_unavailable',()=>consumeItem({data:{uses:{value:0,max:1}}}));
});

test('Heavy weapon drawback uses creature size in 2014 and weapon-category ability requirement in 2024',()=>{
  const heavyMelee=weapon({props:{heavy:true}}),heavyRanged=weapon({props:{heavy:true},attack_type:'ranged'});
  const strongSmall={size:'small',abilities:{str:{score:16},dex:{score:12}}};
  assert.equal(rollContext(make(strongSmall),attack,{item:heavyMelee}).disadvantage,true);
  assert.equal(rollContext(make(strongSmall,'2024'),attack,{item:heavyMelee}).disadvantage,false);
  assert.equal(rollContext(make(strongSmall,'2024'),attack,{item:heavyRanged}).disadvantage,true);
  assert.equal(rollContext(make({size:'medium',abilities:{str:{score:12}}}),attack,{item:heavyMelee}).disadvantage,false);
  assert.equal(rollContext(make({size:'medium',abilities:{str:{score:12}}},'2024'),attack,{item:heavyMelee}).disadvantage,true);
});

test('equipment traits follow equip and attunement while disabled feature traits remain inactive',()=>{
  const protection={type:'armor',equipped:false,data:{requiresAttunement:true,damageTraits:{resistances:['fire']},conditionImmunities:['poisoned'],mechanicalTraits:{initiativeAdvantage:true}}};
  const raw={conditions:['poisoned'],inventory:[protection]};
  assert.equal(incomingDamage(make(raw),9,'fire'),9);protection.equipped=true;assert.equal(incomingDamage(make(raw),9,'fire'),9);
  protection.attuned=true;const active=make(raw);assert.equal(incomingDamage(active,9,'fire'),4);assert.equal(conditionSet(active).has('poisoned'),false);
  assert.equal(rollContext(active,{id:'roll.initiative'}).advantage,true);
  protection.equipped=false;assert.equal(rollContext(make(raw),{id:'roll.initiative'}).advantage,false);
  const feature={type:'feature',enabled:true,data:{mechanicalTraits:{hpPerLevel:1}}};let d=make({level:5,bars:bars(20,20),features:[feature]});assert.equal(d.hp.max,25);
  d=make(d);assert.equal(d.hp.max,25);d.features[0].enabled=false;d=make(d);assert.equal(d.hp.max,20);
  assert.deepEqual(d.mechanicalTraits,{}); // Derived equipment/feature sums are never persisted globally.
});

test('spell DC and displayed spell attack use active item bonuses once and support a spell ability override',()=>{
  const focus={type:'equipment',equipped:true,attuned:true,data:{requiresAttunement:true,modifiers:[{target:'spell.attack',operation:'add',value:2},{target:'spell.dc',operation:'add',value:2}]}};
  const d=make({level:5,spell:{ability:'int'},abilities:{int:{score:14},wis:{score:18}},inventory:[focus]});
  assert.equal(d.spell.attack,7);assert.equal(d.spell.dc,15);
  assert.equal(rollFormula({id:'spell.attack',formula:'1d20'},d),'1d20 + 5 + (2)');
  assert.equal(spellSaveDC(d,spell({spell_ability:'wis'})),17);
  focus.attuned=false;const inactive=make({...d,inventory:[focus]});assert.equal(inactive.spell.dc,13);assert.equal(inactive.spell.attack,5);
});

test('ability equipment derives effective scores without changing base scores or accumulating on rerender',()=>{
  const gauntlets={type:'equipment',equipped:true,attuned:true,data:{requiresAttunement:true,effectTemplates:[{passive:true,changes:[{target:'ability.str.score',operation:'minimum',value:19}]}]}};
  let d=make({abilities:{str:{score:8}},inventory:[gauntlets,armor({str_req:15})]});
  assert.equal(d.abilities.str.score,8);assert.equal(d.abilities.str.effectiveScore,19);assert.equal(d.abilities.str.mod,4);assert.equal(effectiveSpeed(d),30);
  d=make(d);assert.equal(d.abilities.str.score,8);assert.equal(d.abilities.str.effectiveScore,19);
  d.abilities.str.score=20;assert.equal(effectiveAbilityScore(d,'str'),20);d=make(d);assert.equal(d.abilities.str.mod,5);
  d.inventory[0].equipped=false;d.abilities.str.score=8;d=make(d);assert.equal(d.abilities.str.effectiveScore,8);assert.equal(d.abilities.str.mod,-1);assert.equal(effectiveSpeed(d),20);
});

test('active movement and senses remain derived and all speeds share exhaustion and immobilization',()=>{
  const boots={type:'equipment',equipped:true,data:{effectTemplates:[{passive:true,changes:[{target:'movement.walk',operation:'minimum',value:35},{target:'movement.swim',operation:'minimum',value:30},{target:'senses.darkvision',operation:'minimum',value:60}]}]}};
  let d=make({speed:25,exhaustion:1,senses:{darkvision:30},inventory:[boots]},'2024');
  assert.equal(d.speed,25);assert.equal(d.effectiveMovement.walk,30);assert.equal(d.effectiveMovement.swim,25);assert.equal(effectiveSpeed(d),30);
  assert.equal(d.senses.darkvision,30);assert.equal(d.effectiveSenses.darkvision,60);d=make(d,'2024');assert.equal(d.effectiveMovement.walk,30);
  d.conditions=['grappled'];d=make(d,'2024');assert.equal(d.effectiveMovement.walk,0);assert.equal(d.effectiveMovement.swim,0);
  d.conditions=[];d.inventory[0].equipped=false;d=make(d,'2024');assert.equal(d.effectiveMovement.walk,20);assert.equal(d.effectiveSenses.darkvision,30);
});

test('declarative unarmored and no-shield requirements gate Bracers without guessing unsupported guards',()=>{
  const bracers={type:'equipment',equipped:true,attuned:true,data:{requiresAttunement:true,effectTemplates:[{passive:false,requirements:{unarmored:true,noShield:true},changes:[{target:'ac',operation:'add',value:2}]}]}};
  assert.equal(make({inventory:[bracers]}).effective_ac,12);
  assert.equal(make({inventory:[bracers,armor()]}).effective_ac,18);
  assert.equal(make({inventory:[bracers,armor({armor_type:'shield',base_ac:2})]}).effective_ac,12);
  bracers.data.effectTemplates[0].requirements={unarmored:true,requiresMoonlight:true};assert.equal(make({inventory:[bracers]}).effective_ac,10);
  bracers.data.effectTemplates[0].requirements={unarmored:true,noShield:true};bracers.attuned=false;assert.equal(make({inventory:[bracers]}).effective_ac,10);
});

test('concentration-only advantage, explicit magical-sleep immunity and formula HP traits stay scoped',()=>{
  const feat={type:'feat',data:{mechanicalTraits:{magicalSleepImmunity:true},effectTemplates:[{passive:true,manual:true,changes:[{target:'concentration',operation:'advantage'},{target:'hp.flat',operation:'add',valueProfile:{type:'proficiency'}}]}]}};
  let d=make({level:5,bars:bars(20,20),features:[feat]});assert.equal(d.hp.max,23);d=make(d);assert.equal(d.hp.max,23);
  assert.equal(rollContext(d,{id:'roll.save.con'}).advantage,false);assert.equal(rollContext(d,{id:'roll.save.con'},{concentration:true}).advantage,true);
  assert.equal(rollContext(d,{id:'roll.save.wis'},{saveAgainst:'magicalSleep'}).immune,'magicalSleep');assert.equal(rollContext(d,{id:'roll.save.wis'},{saveAgainst:'charmed'}).immune,'');
  d.features[0].enabled=false;d=make(d);assert.equal(d.hp.max,20);assert.equal(rollContext(d,{id:'roll.save.con'},{concentration:true}).advantage,false);
});

test('ability increases with an explicit cap never lower a score already above that cap',()=>{
  const belt={type:'equipment',equipped:true,data:{effectTemplates:[{passive:true,changes:[{target:'ability.con.score',operation:'add',value:2,max:20}]}]}};
  assert.equal(make({abilities:{con:{score:19}},inventory:[belt]}).abilities.con.effectiveScore,20);
  assert.equal(make({abilities:{con:{score:21}},inventory:[belt]}).abilities.con.effectiveScore,21);
  assert.equal(make({abilities:{con:{score:10}},inventory:[belt]}).abilities.con.effectiveScore,12);
});

test('Unarmored Defense chooses one legal declared formula and preserves armor, shield and manual AC rules',()=>{
  const stats={abilities:{dex:{score:14},con:{score:16},wis:{score:18}}},shield=armor({armor_type:'shield',base_ac:2});
  for(const edition of ['2014','2024']){
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:'barbarian'}},edition).effective_ac,15);
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:'monk'}},edition).effective_ac,16);
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:['barbarian','monk']}},edition).effective_ac,16);
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:['barbarian','monk']},inventory:[shield]},edition).effective_ac,17);
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:'monk'},inventory:[shield]},edition).effective_ac,14);
    assert.equal(make({...stats,mechanicalTraits:{unarmoredDefense:['barbarian','monk']},inventory:[armor(),shield]},edition).effective_ac,20);
    const manual=make({...stats,ac:11,acMode:'manual',acModeExplicit:true,mechanicalTraits:{unarmoredDefense:'monk'}},edition);
    assert.equal(manual.effective_ac,11);assert.equal(armorState(manual).ac,16);
  }
  const feature={type:'feature',enabled:true,data:{mechanicalTraits:{unarmoredDefense:'monk'}}};
  let d=make({...stats,features:[feature]});assert.equal(d.effective_ac,16);d.features[0].enabled=false;assert.equal(make(d).effective_ac,12);
});

test('declared breath damage uses its own level thresholds without weapon modifiers, critical dice or use consumption',()=>{
  const item={type:'feature',data:{damage:'2d6',damage_bonus:50,uses:{value:1,max:1},breathWeapon:{scale:{0:{number:2,faces:6},6:{number:3,faces:6},11:{number:4,faces:6},16:{number:5,faces:6}}}}};
  const action={id:'feature.damage',formula:'@item.data.damage'};
  for(const [level,expected] of [[1,'2d6'],[5,'2d6'],[6,'3d6'],[10,'3d6'],[11,'4d6'],[15,'4d6'],[16,'5d6'],[20,'5d6']]){
    const d=make({level,abilities:{str:{score:20},con:{score:20}}});
    assert.equal(rollFormula(action,d,{item,critical:true}),expected);
  }
  assert.equal(item.data.uses.value,1);
  const healing={type:'feature',data:{healingFormula:'1d8 + 3',damage_bonus:50}};
  assert.equal(rollFormula({id:'feature.healing',formula:''},make(),{item:healing,critical:true}),'1d8 + 3');
  const temporary={type:'feature',data:{damage:'1d6 + 2'}};
  assert.equal(rollFormula({id:'feature.temporary',formula:''},make(),{item:temporary,critical:true}),'1d6 + 2');
  const profiled={type:'feature',data:{formulaProfile:{version:1,kind:'damage',critical:false,base:{dice:[{number:1,faces:6}]},scaling:{mode:'cantrip',thresholds:[6,11,16],dice:[{number:1,faces:6}]}}}};
  assert.equal(rollFormula(action,make({level:11}),{item:profiled,critical:true}),'1d6 + 2d6');
  const invalid=structuredClone(item);invalid.data.breathWeapon.scale[0].number=51;
  fails('invalid_formula',()=>rollFormula(action,make(),{item:invalid}));
});

test('Archery declared bonus applies once to ranged weapons and never to spells or thrown melee weapons',()=>{
  const style={type:'feature',enabled:true,data:{modifiers:[{target:'weapon.attack.ranged',operation:'add',value:2}]}};
  const d=make({abilities:{str:{score:16},dex:{score:16}},features:[style]});
  const bow=weapon({attack_type:'ranged'}),dagger=weapon({attack_type:'melee',props:{finesse:true,thrown:true}});
  assert.equal(weaponBonuses(d,bow).attackBonus,7);assert.equal(rollFormula(attack,d,{item:bow}),'1d20 + 7');
  assert.equal(weaponBonuses(d,dagger).attackBonus,5);assert.equal(rollFormula(attack,d,{item:dagger}),'1d20 + 5');
  assert.equal(rollFormula({id:'spell.attack',formula:'1d20'},d,{item:spell()}),'1d20 + 2');
  assert.equal(rollFormula(weaponDamage,d,{item:bow}),'1d8 + (3)');
  d.features[0].enabled=false;assert.equal(weaponBonuses(d,bow).attackBonus,5);
});
