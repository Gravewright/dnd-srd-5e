import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derive,weaponBonuses} from '../rules.js';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
const schema=read('schemas/monster.schema.json');
for(const [edition,count] of [['2014',317],['2024',330]]){
 const entries=read(`compendiums/monsters-${edition}.json`).packs[0].entries;
 test(`${edition}: all ${count} licensed monsters preserve official AC, HP and ability scores after sheet derivation`,()=>{
  assert.equal(entries.length,count);assert.equal(new Set(entries.map(e=>e.id)).size,count);
  for(const entry of entries){
   const d=entry.data,derived=derive(d,'monster',schema,edition);
   assert.equal(d.ac,Number(d.description.match(/(?:Armor Class|AC)\s+(\d+)/)[1]),entry.name);
   assert.equal(d.hp.max,Number(d.description.match(/(?:Hit Points|HP)\s+(\d+)/)[1]),entry.name);
   assert.equal(derived.effective_ac,d.ac,entry.name);assert.equal(derived.hp.max,d.hp.max,entry.name);
   for(const [ability,value] of Object.entries(d.abilities))assert.equal(derived.abilities[ability].score,value.score,entry.name);
   assert.equal(d.provenance.contentLicense,'CC-BY-4.0');assert.ok(d.provenance.officialPage);
   assert.doesNotMatch(d.description,/@UUID|\[\[|<script|System Reference Document/);
   for(const attack of d.attacks){
    const bonuses=weaponBonuses(derived,attack);
    assert.equal(bonuses.attackBonus,attack.data.attack_bonus,entry.name);
    assert.equal(bonuses.damageBonus,0,entry.name);
    assert.match(attack.data.damage,/^\d+d\d+(?:[+-]\d+)?$/);
   }
  }
 });
 test(`${edition}: Aboleth retains edition-specific mechanics and full action descriptions`,()=>{
  const d=entries.find(e=>e.name==='Aboleth').data;
  assert.equal(d.hp.max,edition==='2014'?135:150);assert.equal(d.ac,17);
  assert.match(d.actions_text,edition==='2014'?/Enslave/:/Dominate Mind/);
  assert.ok(d.attacks.some(a=>a.name==='Tentacle'));
 });
}
test('direct PDF conversions include Giant Centipede and Giant Wasp without unlicensed YAML',()=>{
 const entries=read('compendiums/monsters-2024.json').packs[0].entries;
 for(const name of ['Giant Centipede','Giant Wasp']){
  const d=entries.find(e=>e.name===name).data;assert.match(d.provenance.adaptation,/Direct official PDF/);
  assert.ok(d.actions_text);assert.equal(d.init_misc,0);
 }
});
