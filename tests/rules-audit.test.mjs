// Rules audited against the official SRD 5.1 and SRD 5.2.1 texts, using the shipped compendium entries.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derive,edit,longRest,rollFormula,spellFormula,weaponBonuses,armorState} from '../rules.js';
import {prepareInitiative} from '../combat-rules.js';

const schemas={character:JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url))),
  monster:JSON.parse(readFileSync(new URL('../schemas/monster.schema.json',import.meta.url)))};
const make=(raw={},edition='2014',type='character')=>derive(raw,type,schemas[type],edition);
const books=Object.fromEntries(['2014','2024'].map(edition=>[edition,JSON.parse(readFileSync(new URL(`../compendiums/${edition}.json`,import.meta.url))).packs]));
const entry=(edition,name,type)=>{
  const found=books[edition].flatMap(pack=>pack.entries.map(item=>({...item,pack:pack.id}))).find(item=>item.name===name&&(!type||item.type===type));
  assert.ok(found,`${edition} ${name}`);return found;
};
const owned=(item,extra={})=>({id:item.id,name:item.name,type:item.type,equipped:true,attuned:true,data:structuredClone(item.data),...extra});
const scores=(values={})=>Object.fromEntries(['str','dex','con','int','wis','cha'].map(id=>[id,{score:values[id]??10}]));
const armor=(data)=>({type:'armor',equipped:true,data});
const action=id=>({id,formula:id.startsWith('roll.save.')?`1d20 + @sheet.saves.${id.slice(10)}.mod`:id==='roll.initiative'?'1d20 + @sheet.init':`1d20 + @sheet.abilities.${id.slice(11)}.mod`});

test('unarmored AC is 10 + Dexterity, including sheets that stored the old untouched manual default',()=>{
  assert.equal(make({abilities:scores({dex:16})}).effective_ac,13);
  const legacy=make({acMode:'manual',ac:10,abilities:scores({dex:16})});
  assert.equal(legacy.acMode,'equipment');assert.equal(legacy.effective_ac,13);
  // A typed AC or an explicit manual choice remains the owner's value.
  assert.equal(make({acMode:'manual',ac:15,abilities:scores({dex:16})}).effective_ac,15);
  assert.equal(make({acMode:'manual',acModeExplicit:true,ac:10,abilities:scores({dex:16})}).effective_ac,10);
  assert.equal(make({ac:14,abilities:scores({dex:18})},'2014','monster').effective_ac,14);
});

test('passive AC bonuses from compendium items apply once, and only while equipped and attuned',()=>{
  for(const edition of ['2014','2024'])for(const [name,bonus] of [['Ring of Protection',1],['Cloak of Protection',1],['Staff of Power',2]]){
    const item=entry(edition,name),base=make({abilities:scores({dex:14})},edition).effective_ac,key=item.type==='weapon'?'weapons':'inventory';
    assert.equal(make({abilities:scores({dex:14}),[key]:[owned(item)]},edition).effective_ac,base+bonus,`${edition} ${name}`);
    const unattuned=owned(item,{attuned:false});
    assert.equal(make({abilities:scores({dex:14}),[key]:[unattuned]},edition).effective_ac,base,`${edition} ${name} without attunement`);
    assert.equal(make({abilities:scores({dex:14}),[key]:[owned(item,{equipped:false})]},edition).effective_ac,base,`${edition} ${name} stowed`);
  }
  const scarab=entry('2024','Scarab of Protection');
  assert.equal(make({inventory:[owned(scarab)]},'2024').effective_ac,11);
});

test('the Defense fighting style adds +1 AC only while wearing armor',()=>{
  for(const [edition,type] of [['2014','feature'],['2024','feat']]){
    const defense=owned(entry(edition,'Defense',type)),chain={type:'armor',equipped:true,data:structuredClone(entry(edition,'Chain Mail').data)};
    const shield={type:'armor',equipped:true,data:structuredClone(entry(edition,'Shield','armor').data)};
    assert.equal(make({abilities:scores({dex:14}),features:[defense]},edition).effective_ac,12,`${edition} unarmored`);
    assert.equal(make({abilities:scores({dex:14}),features:[defense],inventory:[shield]},edition).effective_ac,14,`${edition} shield only`);
    assert.equal(make({abilities:scores({dex:14}),features:[defense],inventory:[chain]},edition).effective_ac,17,`${edition} chain mail`);
  }
});

test('Draconic Resilience sets an unarmored base AC that never stacks with other formulas',()=>{
  const old=owned(entry('2014','Draconic Resilience','feature')),current=owned(entry('2024','Draconic Resilience','feature'));
  assert.equal(make({abilities:scores({dex:14}),features:[old]}).effective_ac,15);
  assert.equal(make({abilities:scores({dex:14}),features:[old],inventory:[armor({armor_type:'shield',base_ac:2})]}).effective_ac,17);
  assert.equal(make({abilities:scores({dex:14}),features:[old],inventory:[armor({armor_type:'light',base_ac:11,add_dex:true})]}).effective_ac,13);
  assert.equal(make({abilities:scores({dex:14,cha:18}),features:[current]},'2024').effective_ac,16);
  const barbarian={type:'feature',data:{mechanicalTraits:{unarmoredDefense:'barbarian'}}};
  assert.equal(make({abilities:scores({dex:14,con:18,cha:10}),features:[current,barbarian]},'2024').effective_ac,16);
  assert.equal(armorState(make({abilities:scores({dex:14}),features:[old]})).ac,15);
});

test('Draconic Resilience 2014 adds 1 HP per Sorcerer level',()=>{
  const feature=owned(entry('2014','Draconic Resilience','feature'));
  const d=make({level:3,classLevels:{sorcerer:3},bars:{bar_1:{value:17,max:17},bar_2:{value:0,max:0}},abilities:scores(),features:[feature]});
  assert.equal(d.hp.max,20);
});

test('maximum HP follows Constitution changes by 1 per level on sheets without class advancement',()=>{
  let d=make({level:5,bars:{bar_1:{value:38,max:38},bar_2:{value:0,max:0}},abilities:scores({con:14})});
  assert.equal(d.hp.max,38,'The typed maximum already includes the current Constitution.');
  edit(d,'sheet.abilities.con.score',16);d=make(d);assert.equal(d.hp.max,43);assert.equal(d.hp.value,38);
  edit(d,'sheet.abilities.con.score',17);d=make(d);assert.equal(d.hp.max,43,'Same modifier, same maximum.');
  edit(d,'sheet.abilities.con.score',12);d=make(d);assert.equal(d.hp.max,33);assert.equal(d.hp.value,33);
  // Typing a new maximum records it with the current modifier.
  edit(d,'sheet.hp.max',36);d=make(d);edit(d,'sheet.abilities.con.score',14);d=make(d);assert.equal(d.hp.max,41);
  // Equipment that sets Constitution changes HP while it is worn.
  const amulet=owned(entry('2014','Amulet of Health'));
  let worn=make({...d,inventory:[amulet]});assert.equal(worn.abilities.con.effectiveScore,19);assert.equal(worn.hp.max,51);
  worn=make({...worn,inventory:[{...amulet,equipped:false}]});assert.equal(worn.hp.max,41);
  // Monster stat blocks keep their recorded maximum.
  let monster=make({bars:{bar_1:{value:45,max:45},bar_2:{value:0,max:0}},abilities:scores({con:14})},'2014','monster');
  edit(monster,'sheet.abilities.con.score',20);monster=make(monster,'2014','monster');assert.equal(monster.hp.max,45);
});

test('long rests keep the Constitution-adjusted maximum',()=>{
  let d=make({level:4,bars:{bar_1:{value:10,max:30},bar_2:{value:0,max:0}},abilities:scores({con:12})},'2024');
  edit(d,'sheet.abilities.con.score',14);d=make(d,'2024');longRest(d,'2024');
  assert.equal(d.hp.max,34);assert.equal(d.hp.value,34);
});

test('displayed saves, checks, skills and initiative match the rolled totals',()=>{
  const ring=owned(entry('2014','Ring of Protection')),luck=owned(entry('2014','Stone of Good Luck (Luckstone)'));
  const d=make({abilities:scores({dex:14,wis:12}),saves:{dex:{prof:true}},skills:{perception:{prof:true}},inventory:[ring,luck]});
  assert.equal(d.saves.dex.mod,4);assert.equal(d.saves.dex.bonus,6);
  assert.equal(rollFormula(action('roll.save.dex'),d,{}),'1d20 + 4 + (1) + (1)');
  assert.equal(d.abilities.str.checkBonus,1);assert.equal(rollFormula(action('roll.check.str'),d,{}),'1d20 + 0 + (1)');
  assert.equal(d.skills.perception.bonus,4);assert.equal(d.passive_perception,14);
  assert.equal(d.initBonus,3);assert.equal(rollFormula(action('roll.initiative'),d,{}),'1d20 + 2 + (1)');
  assert.equal(prepareInitiative('1d20 + @init',d).formula,'1d20 + @init + (1)');
});

test('2024 Thaumaturge adds Wisdom (minimum +1) to Arcana and Religion rolls',()=>{
  const order=owned(entry('2024','Divine Order: Thaumaturge','feature'));
  const wise=make({abilities:scores({wis:16}),features:[order]},'2024'),plain=make({abilities:scores({wis:8}),features:[order]},'2024');
  assert.equal(rollFormula({id:'roll.skill.arcana',formula:'1d20'},wise,{}),'1d20 + 0 + (3)');
  assert.equal(rollFormula({id:'roll.skill.religion',formula:'1d20'},plain,{}),'1d20 + 0 + (1)');
  assert.equal(wise.skills.arcana.bonus,3);assert.equal(wise.skills.nature.bonus,0);
});

test('weapon and armor table data follows the official equipment tables',()=>{
  for(const name of ['Trident','War Pick','Trident of Fish Command'])assert.equal(entry('2024',name,'weapon').data.versatile,'1d10',name);
  assert.equal(entry('2014','Trident','weapon').data.versatile,'1d8');
  for(const edition of ['2014','2024'])for(const strike of books[edition].flatMap(pack=>pack.entries).filter(item=>item.name==='Unarmed Strike')){
    const d=make({abilities:scores({str:16})},edition);
    assert.equal(rollFormula({id:'weapon.damage',formula:'@item.data.damage'},d,{item:owned(strike)}),'1 + (3)',edition);
  }
  assert.equal(entry('2024','Energy Bow','weapon').data.attack_type,'ranged');
  const shield=entry('2024','Shield, +1, +2, or +3','armor');assert.equal(shield.data.base_ac,2);
  assert.equal(make({abilities:scores(),inventory:[owned(shield)]},'2024').effective_ac,12);
  const helm=entry('2024','Helm of Brilliance');assert.equal(helm.type,'equipment');assert.equal(helm.pack,'equipment-2024');
  const monk={type:'feature',data:{mechanicalTraits:{unarmoredDefense:'monk'}}};
  assert.equal(make({abilities:scores({dex:16,wis:16}),features:[monk],inventory:[owned(helm)]},'2024').effective_ac,16,'A helm is not armor.');
  const headband=owned(entry('2014','Headband of Intellect'));
  assert.equal(make({abilities:scores({int:12}),inventory:[headband]}).abilities.int.effectiveScore,19);
  assert.equal(make({abilities:scores({int:20}),inventory:[headband]}).abilities.int.effectiveScore,20);
});

test('spell formulas match the official base dice and upgrades',()=>{
  const d=make({level:5,abilities:scores({cha:16}),spell:{ability:'cha'}},'2024');
  const smite=entry('2024','Divine Smite','spell');
  assert.equal(spellFormula(d,smite,{slotLevel:1}),'2d8');assert.equal(spellFormula(d,smite,{slotLevel:3}),'2d8 + 2d8');
  assert.equal(spellFormula(d,entry('2024','Sorcerous Burst','spell')),'1d8 + 1d8');
  assert.equal(spellFormula(d,entry('2024','Prayer of Healing','spell'),{slotLevel:2}),'2d8');
});

test('weapon bonuses use the same rules on every sheet path',()=>{
  const d=make({abilities:scores({dex:16})},'2024');const bow={type:'weapon',data:structuredClone(entry('2024','Longbow','weapon').data)};
  assert.equal(weaponBonuses(d,bow).attackBonus,5);
});
