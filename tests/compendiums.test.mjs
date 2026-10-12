import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=read('../manifest.json');
const report=read('../compendiums/PROVENANCE.json');
const collections=Object.fromEntries(['2014','2024'].map(edition=>[edition,read(`../compendiums/${edition}.json`)]));
const entries=edition=>collections[edition].packs.flatMap(pack=>pack.entries);
const find=(edition,name,type)=>entries(edition).find(entry=>entry.name===name&&(!type||entry.type===type));

test('installed collections preserve edition, registered types and unique stable IDs',()=>{
 assert.deepEqual(manifest.content.compendiums,['compendiums/2014.json','compendiums/2024.json']);
 const types=new Set(manifest.system.itemTypes.map(type=>type.id)),ids=new Set();
 for(const edition of ['2014','2024']){
  assert.equal(collections[edition].language,'en');assert.equal(collections[edition].license,'CC-BY-4.0');
  assert.equal(collections[edition].packs.length,10);
  const counts={};
  for(const entry of entries(edition)){
   assert.ok(types.has(entry.type));assert.equal(entry.systemId,manifest.id);assert.equal(entry.data.rulesEdition,edition);
   assert.match(entry.id,/^[a-f0-9-]{36}$/);assert.ok(!ids.has(entry.id));ids.add(entry.id);
   assert.equal(entry.data.provenance.contentLicense,'CC-BY-4.0');
   assert.match(entry.data.provenance.sourceGitBlob,/^[a-f0-9]{40}$/);
   assert.match(entry.data.provenance.sourceSha256,/^[a-f0-9]{64}$/);
   assert.equal(entry.data.provenance.sourceCommit,report.upstream.commit);
   counts[entry.type]=(counts[entry.type]||0)+1;
  }
  assert.deepEqual(counts,report.counts[edition]);
 }
});

test('spell text and base mechanics remain edition specific and free of PDF spillover',()=>{
 for(const edition of ['2014','2024']){
  const fireball=find(edition,'Fireball');assert.equal(fireball.data.damage,'8d6');assert.equal(fireball.data.range,'150 ft');
  assert.equal(fireball.data.resolution,'save_dex');assert.match(fireball.data.description,/8d6/);
  assert.match(find(edition,'Zone of Truth').data.description,/truth/);
  assert.doesNotMatch(find(edition,'Zone of Truth').data.description,/Traps|System Reference Document/);
  const cure=find(edition,'Cure Wounds');assert.equal(cure.data.damage,'');assert.match(cure.data.description,/spellcasting ability modifier/);
  assert.equal(find(edition,'Animal Messenger').data.duration,'24 hours');
 }
 assert.match(find('2014','Cure Wounds').data.description,/1d8/);
 assert.match(find('2024','Cure Wounds').data.description,/2d8/);
 assert.equal(entries('2014').filter(entry=>entry.type==='spell').length,319);
 assert.equal(entries('2024').filter(entry=>entry.type==='spell').length,338);
 assert.ok(!find('2024','Arcane Vigor'));assert.ok(!find('2024','Ice Knife'));assert.ok(!find('2024','Book of Shadows'));
});

test('weapons, armor and resources match usable Gravewright fields',()=>{
 for(const edition of ['2014','2024']){
  const sword=find(edition,'Longsword','weapon').data;
  assert.equal(sword.damage,'1d8');assert.equal(sword.versatile,'1d10');assert.equal(sword.category,'martial');
  assert.equal(sword.attack_ability,'auto');assert.equal(sword.proficient,true);assert.equal(sword.props.versatile,true);
  assert.equal(find(edition,'Dagger','weapon').data.props.finesse,true);
  assert.equal(find(edition,'Chain Mail','armor').data.base_ac,16);
  assert.equal(find(edition,'Potion of Healing','consumable').data.weight,.5);
  assert.equal(find(edition,'Barbarian','class').data.hit_die,'d12');
  const race=find(edition,'Dragonborn','race').data;assert.equal(race.size,'medium');assert.equal(race.speed,30);
  assert.ok(find(edition,'Acolyte','background').data.skill_proficiencies);
  for(const entry of entries(edition).filter(entry=>entry.type==='feature')){
   if(entry.data.uses===undefined){assert.ok(entry.data.provenance.derivedFrom&&entry.data.mechanicalTraits,'Only an explicitly derived passive omits resource tracking');continue;}
   assert.equal(typeof entry.data.uses,'object');assert.equal(typeof entry.data.uses.max,'number');assert.equal(typeof entry.data.uses.value,'number');
  }
 }
 assert.equal(find('2014','Plate Armor +1','armor').data.base_ac,19);
 assert.equal(find('2024','Dragon Scale Mail','armor').data.base_ac,15);
 assert.match(find('2014','Potion of Healing','consumable').data.description,/2d4 \+ 2 Hit Points/);
});

test('runtime descriptions contain no upstream HTML, macros, automation notes or executable formulas',()=>{
 for(const edition of ['2014','2024'])for(const entry of entries(edition)){
  assert.doesNotMatch(entry.data.description,/<\/?[a-z][^>]*>|\[\[|&reference\[|@(?:UUID|Embed|\w+\.)|Foundry Note|System Reference Document/i,`${edition}: ${entry.name}`);
  for(const field of ['damage','range','duration','casting_time'])assert.doesNotMatch(String(entry.data[field]||''),/@|\[\[/,`${entry.name}.${field}`);
  if(entry.data.damage)assert.match(entry.data.damage,/^[0-9dD+*()/ .-]{1,120}$/);
 }
});

test('select field values from the compendium exist in their item editor layouts',()=>{
 for(const type of ['weapon','armor','consumable','spell','class','race','feature']){
  const layout=read(`../layouts/items/${type}.sheet.gw.json`),selects=[];
  function walk(node){if(!node||typeof node!=='object')return;if(node.type==='selectField')selects.push(node);for(const child of node.children||[])walk(child);}walk(layout.body);
  for(const edition of ['2014','2024'])for(const entry of entries(edition).filter(entry=>entry.type===type))for(const select of selects){
   const value=entry.data[select.path.replace(/^sheet\./,'')];
   if(value!==undefined&&value!=='')assert.ok(select.options.some(option=>option.value===value),`${entry.name}: ${select.path}=${value}`);
  }
 }
});
