import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derive,get,set,edit,damage,longRest,rollFormula,effectiveSpeed,weaponBonuses} from '../rules.js';
const schema=JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url)));
const make=(raw={},edition='2014')=>derive(raw,'character',schema,edition);
test('proficiency, expertise, spell DC and passive scores derive from source fields',()=>{
 const d=make({level:5,abilities:{dex:{score:18},wis:{score:14}},skills:{stealth:{expert:true}},spell:{ability:'wis'}});
 assert.equal(d.prof,3);assert.equal(d.skills.stealth.mod,10);assert.equal(d.spell.attack,5);assert.equal(d.spell.dc,13);assert.equal(d.passive_perception,12);
});
test('native bars remain authoritative after quick-control edits',()=>{
 const d=make({hp:{value:99,max:99,temp:99},bars:{bar_1:{value:7,max:20},bar_2:{value:3,max:0}}});
 assert.equal(d.hp.value,7);edit(d,'sheet.hp.value',4);assert.equal(make(d).hp.value,4);
 damage(d,5);assert.equal(d.bars.bar_2.value,0);assert.equal(d.bars.bar_1.value,2);
});
test('2014 exhaustion applies disadvantage; 2024 subtracts twice the level',()=>{
 const action={id:'roll.check.dex',formula:'1d20 + @sheet.abilities.dex.mod'};
 const d=make({exhaustion:2,abilities:{dex:{score:16}}});
 assert.equal(rollFormula(action,d), '2d20kl1 + 3');
 assert.equal(rollFormula(action,d,{edition:'2024'}), '1d20 + 3 + (-4)');
 assert.equal(rollFormula(action,d,{mode:'advantage'}),'1d20 + 3');
 assert.equal(effectiveSpeed({...d,speed:30},'2014'),15);assert.equal(effectiveSpeed({...d,speed:30},'2024'),20);
});
test('2024 initiative exhaustion is applied once',()=>{
 const d=make({exhaustion:2,abilities:{dex:{score:16}}},'2024');
 assert.equal(d.init,-1);assert.equal(rollFormula({id:'roll.initiative',formula:'1d20 + @sheet.init'},d,{edition:'2024'}),'1d20 + -1');
});
test('long rest restores native resources and reduces exhaustion once',()=>{
 const d=make({exhaustion:3,slots:{l1:{value:0,max:3}}});damage(d,9);longRest(d,'2024');
 assert.equal(d.bars.bar_1.value,10);assert.equal(d.exhaustion,2);assert.equal(d.slots.l1.value,3);
});
test('safe paths reject prototype mutation and formulas reject injected extra dice',()=>{
 assert.throws(()=>set({},'__proto__.polluted',true));assert.equal(get({},'constructor'), '');
 assert.throws(()=>rollFormula({id:'roll.check.str',formula:'1d20'},make(),{extraDice:'1d6; alert(1)'}));
});
test('active effect modifiers affect rolls, AC and incoming damage',()=>{
 const effect={data:{modifiers:[{target:'roll.attack',operation:'add',value:2},{target:'stat.ac',operation:'add',value:3},{target:'damage.received',operation:'resistance'}]}};
 const d=make({effects:[effect]});assert.equal(d.effective_ac,13);
 assert.equal(rollFormula({id:'weapon.attack',formula:'1d20 + @sheet.prof'},d),'1d20 + 2 + (2)');
 damage(d,7);assert.equal(d.bars.bar_1.value,7);
 const off=make({...d,effects:[{...effect,enabled:false}]});assert.equal(off.effective_ac,10);
});

const attack={id:'weapon.attack',formula:'1d20 + @sheet.prof + @item.data.attack_bonus'};
const weaponDamage={id:'weapon.damage',formula:'@item.data.damage'};
const weapon=(data={})=>({type:'weapon',data:{attack_ability:'auto',attack_type:'melee',damage:'1d8',...data}});

test('SRD melee weapons include Strength and magic once in attack and damage',()=>{
 const d=make({abilities:{str:{score:16},dex:{score:12}}});
 const mundane=weapon(),magic=weapon({attack_bonus:1,damage_bonus:1});
 assert.equal(rollFormula(attack,d,{item:mundane}),'1d20 + 5');
 assert.equal(rollFormula(weaponDamage,d,{item:mundane}),'1d8 + (3)');
 assert.deepEqual(weaponBonuses(d,magic),{ability:'str',abilityModifier:3,proficient:true,proficiencyBonus:2,attackBonus:6,damageBonus:4});
 assert.equal(rollFormula(attack,d,{item:magic}),'1d20 + 6');
 assert.equal(rollFormula(weaponDamage,d,{item:magic}),'1d8 + (4)');
});

test('ranged, finesse and thrown weapons choose their appropriate ability',()=>{
 const nimble=make({abilities:{str:{score:12},dex:{score:18}}});
 assert.equal(weaponBonuses(nimble,weapon({attack_type:'ranged'})).attackBonus,6);
 assert.equal(weaponBonuses(nimble,weapon({props:{finesse:true}})).ability,'dex');
 assert.equal(weaponBonuses(nimble,weapon({props:{thrown:true}})).ability,'str');
 const strong=make({abilities:{str:{score:18},dex:{score:12}}});
 assert.equal(weaponBonuses(strong,weapon({attack_type:'ranged',props:{finesse:true}})).ability,'str');
 assert.equal(rollFormula(weaponDamage,nimble,{item:weapon({attack_type:'ranged',damage:'1'})}),'1 + (4)');
});

test('explicit abilities, nonproficiency and manual legacy bonuses remain usable',()=>{
 const d=make({abilities:{str:{score:18},wis:{score:16}}});
 assert.equal(weaponBonuses(d,weapon({attack_ability:'wis'})).abilityModifier,3);
 const untrained=weapon({attack_ability:'wis',proficient:false,attack_bonus:1,damage_bonus:1});
 assert.equal(rollFormula(attack,d,{item:untrained}),'1d20 + 4');
 assert.equal(rollFormula(weaponDamage,d,{item:untrained}),'1d8 + (4)');
 for(const mode of [undefined,'none']) {
   const manual=weapon({attack_ability:mode,attack_bonus:5,damage:'1d8 + 4'});
   assert.equal(rollFormula(attack,d,{item:manual}),'1d20 + 7');
   assert.equal(rollFormula(weaponDamage,d,{item:manual}),'1d8 + 4');
 }
 assert.equal(rollFormula(weaponDamage,d,{item:weapon({attack_ability:'none',damage_bonus:2})}),'1d8 + (2)');
});

test('weapon ability bonuses compose with effects and both exhaustion profiles once',()=>{
 const d=make({exhaustion:3,abilities:{str:{score:16}},effects:[{data:{modifiers:[{target:'roll.attack',operation:'add',value:2},{target:'roll.damage',operation:'add_dice',value:'1d4'}]}}]});
 const item=weapon({attack_bonus:1,damage_bonus:1});
 assert.equal(rollFormula(attack,d,{item}),'2d20kl1 + 6 + (2)');
 assert.equal(rollFormula(attack,d,{item,edition:'2024'}),'1d20 + 6 + (-6) + (2)');
 assert.equal(rollFormula(attack,d,{item,mode:'advantage'}),'1d20 + 6 + (2)');
 assert.equal(rollFormula(weaponDamage,d,{item,edition:'2024'}),'1d8 + (4) + 1d4');
});

test('weapon modifiers do not alter spell damage or pass unresolved macros to dice',()=>{
 const d=make({abilities:{str:{score:18}}}),item=weapon({attack_bonus:2,damage_bonus:2,damage:'2d6'});
 assert.equal(rollFormula({id:'spell.damage',formula:'@item.data.damage'},d,{item}),'2d6');
 for(const damage of ['1d8 + @mod','@item.damage','1d8; alert(1)','[[1d8]]']) {
   assert.throws(()=>rollFormula(weaponDamage,d,{item:weapon({damage})}),/Invalid damage formula/);
 }
 assert.equal(rollFormula(weaponDamage,d,{item:weapon({damage:'2d6kh1'})}),'2d6kh1 + (4)');
});
