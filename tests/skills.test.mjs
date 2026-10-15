import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ABILITIES,SKILLS,derive,skillAbility,skillModifier,rollFormula,rollContext} from '../rules.js';
import {sortSkillEntries} from '../sheet.js';

const read=file=>JSON.parse(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
const schemas=Object.fromEntries(['character','monster'].map(type=>[type,read(`schemas/${type}.schema.json`)]));
const make=(raw={},edition='2014',type='character')=>derive(raw,type,schemas[type],edition);
const action=skill=>({id:`roll.skill.${skill}`,formula:`1d20 + @sheet.skills.${skill}.mod`});
const changes=(...modifiers)=>({data:{modifiers}});

test('legacy skills retain their default links without adding choices to source documents',()=>{
  for(const type of Object.keys(schemas)){
    const raw={abilities:{dex:{score:18},wis:{score:14}},skills:{stealth:{expert:true}}},original=structuredClone(raw),d=make(raw,'2014',type);
    assert.deepEqual(raw,original);
    for(const [skill,ability] of Object.entries(SKILLS)){
      assert.equal(skillAbility(d,skill),ability);
      assert.equal(Object.hasOwn(d.skills[skill],'ability'),false);
    }
    assert.equal(d.skills.stealth.mod,8);
    assert.equal(d.passive_perception,12);
  }
});

test('persisted ability links survive serialization and derive expertise and passives for both editions and actor types',()=>{
  for(const type of Object.keys(schemas))for(const edition of ['2014','2024']){
    const raw={level:5,prof:3,abilities:{str:{score:18},wis:{score:8}},skills:{perception:{ability:'str',expert:true}}};
    const d=make(JSON.parse(JSON.stringify(raw)),edition,type);
    assert.equal(d.skills.perception.ability,'str');assert.equal(d.skills.perception.mod,10);assert.equal(d.passive_perception,20);
    assert.equal(rollFormula(action('perception'),d),'1d20 + 10');
    assert.equal(make(JSON.parse(JSON.stringify(d)),edition,type).skills.perception.mod,10);
    assert.deepEqual(schemas[type].properties.skills.properties.perception.properties.ability.enum,ABILITIES);
  }
});

test('per-roll ability overrides use effective scores and add proficiency, effects and extra modifiers once without mutating the saved link',()=>{
  const d=make({level:5,abilities:{str:{score:12},dex:{score:14},wis:{score:8}},skills:{perception:{ability:'wis',expert:true}},effects:[
    {data:{effectTemplates:[{passive:true,changes:[{target:'ability.str.score',operation:'set',value:20}]}]}},
    changes({target:'roll.check',operation:'add',value:2},{target:'roll.skill.perception',operation:'subtract',value:1}),
  ]}),original=structuredClone(d);
  assert.equal(skillModifier(d,'perception','str'),11);
  assert.equal(rollFormula(action('perception'),d,{skillAbility:'str',extraModifier:3,extraDice:'1d4'}),'1d20 + 11 + (3) + (2) - (1) + 1d4');
  assert.equal(rollFormula(action('perception'),d,{skillAbility:'dex'}),'1d20 + 8 + (2) - (1)');
  assert.equal(d.skills.perception.mod,5);assert.equal(d.passive_perception,16);assert.deepEqual(d,original);
  assert.equal(skillAbility(d,'perception','invalid'),'wis');
});

test('armor restrictions and passive advantage follow the actual ability rather than the original skill link',()=>{
  const raw={abilities:{str:{score:16},dex:{score:14},wis:{score:10}},armorTraining:{heavy:false},inventory:[{type:'armor',equipped:true,data:{armor_type:'heavy',base_ac:18,stealth_disadvantage:true}}],skills:{perception:{ability:'str'},stealth:{ability:'wis'}}};
  for(const edition of ['2014','2024']){
    const d=make(raw,edition);
    assert.equal(rollContext(d,action('perception')).disadvantage,true);
    assert.equal(rollContext(d,action('perception'),{skillAbility:'wis'}).disadvantage,false);
    assert.equal(rollContext(d,action('stealth')).disadvantage,false);
    assert.equal(rollContext(d,action('stealth'),{skillAbility:'dex'}).disadvantage,true);
    assert.equal(d.passive_perception,8);
  }
});

test('invalid legacy skill links safely fall back and are not saved as invalid enum values',()=>{
  const d=make({skills:{athletics:{ability:'constructor'},perception:{ability:''}}});
  assert.equal(skillAbility(d,'athletics'),'str');assert.equal(Object.hasOwn(d.skills.athletics,'ability'),false);
  assert.equal(skillAbility(d,'perception'),'wis');assert.equal(Object.hasOwn(d.skills.perception,'ability'),false);
});

test('character and monster skills sort by translated labels in the active locale without changing declarative order',()=>{
  // The production layout is the source of its label keys, including translations
  // whose identifiers intentionally differ from their English display names.
  const collect=(node,result=[])=>{
    if(node.type==='rollableStat'&&/^sheet\.skills\.[^.]+\.mod$/.test(node.modPath||''))result.push(node);
    for(const child of Object.values(node))if(child&&typeof child==='object'){
      if(Array.isArray(child))child.forEach(value=>value&&typeof value==='object'&&collect(value,result));
      else collect(child,result);
    }
    return result;
  };
  for(const type of Object.keys(schemas)){
    const skills=collect(read(`layouts/${type}.sheet.gw.json`)),original=skills.map(entry=>entry.labelKey);
    assert.equal(skills.length,18);
    for(const locale of ['en','pt-BR','es']){
      const messages=read(`locales/${locale}.json`),t=key=>messages[key],sorted=sortSkillEntries(skills,t,locale),names=sorted.map(entry=>t(entry.labelKey));
      assert.ok(names.every(name=>typeof name==='string'));
      assert.deepEqual(names,[...names].sort(new Intl.Collator(locale,{sensitivity:'base',numeric:true}).compare));
      if(locale==='pt-BR')assert.ok(names.indexOf('Furtividade')<names.indexOf('História'));
    }
    assert.deepEqual(skills.map(entry=>entry.labelKey),original);
  }
});
