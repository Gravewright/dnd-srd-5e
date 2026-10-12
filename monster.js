import {get,numeric} from './rules.js';
import {icon} from './icons.js';

const element=(doc,tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};

// The monster's original layout remains the source of every editable field.
// Only their presentation changes; collection actions and native bar edits are reused.
export function renderMonster(env){
  const {doc,t,node,field,button,iconButton,resource,layout,flush,openModal,saveIndicator}=env;
  const root=element(doc,'section','gw5-monster');
  const entries=layout.body.tabs.find(tab=>tab.id==='main')?.children||[],leaves=[];
  const collect=entry=>{if(entry.children?.length)entry.children.forEach(collect);else leaves.push(entry);};entries.forEach(collect);
  const used=new Set(),readers=[];
  const find=path=>leaves.find(entry=>(entry.path||entry.valuePath)===path);
  const render=entry=>{used.add(entry);return node(entry);};
  const section=(label,cls)=>{const box=element(doc,'section',`gw5-section ${cls}`);box.append(element(doc,'h3','',t(label)));return box;};
  const readable=(path,label,cls='')=>{
    const item=element(doc,'div',`gw5-monster-fact ${cls}`),value=element(doc,'span','gw5-monster-fact-value');
    item.append(element(doc,'span','gw5-monster-fact-label',t(label)),value);readers.push({path,value});return item;
  };
  function refresh(){for(const {path,value}of readers){const raw=String(get(env.draft(),path,'')).trim(),text=path==='sheet.size'&&env.sizeLabel?env.sizeLabel(raw):raw;value.textContent=text||'—';value.classList.toggle('gw5-monster-fact-value--empty',!text);}}
  const profileFields=[
    {type:'selectField',path:'sheet.size',labelKey:'size',options:[['tiny','sizeTiny'],['small','sizeSmall'],['medium','sizeMedium'],['large','sizeLarge'],['huge','sizeHuge'],['gargantuan','sizeGargantuan']].map(([value,labelKey])=>({value,labelKey}))},
    {type:'textField',path:'sheet.type',labelKey:'creatureType'},
    {type:'textField',path:'sheet.alignment',labelKey:'alignment'},
    {type:'textField',path:'sheet.cr',labelKey:'cr'},
    {type:'numberField',path:'sheet.prof',labelKey:'proficiency'},
    {type:'textField',path:'sheet.speed',labelKey:'monsterSpeed'},
    {type:'textField',path:'sheet.hp.formula',labelKey:'monsterHPFormula'},
    ...['sheet.senses','sheet.languages','sheet.resistances'].map(find).filter(Boolean),
  ];
  for(const definition of profileFields){const source=find(definition.path);if(source)used.add(source);}
  function openEditor(title,definitions){
    const modal=openModal(title),body=element(doc,'div','gw5-modal-body gw5-monster-settings'),fields=element(doc,'div','gw5-monster-settings-grid');
    modal.append(body);body.append(fields);
    for(const definition of definitions){const control=field(definition);if(definition.type==='textArea')control.classList.add('gw5-monster-setting-wide');fields.append(control);}
    const footer=element(doc,'footer','gw5-monster-settings-footer');footer.append(saveIndicator(),button(t('done'),async()=>{await flush();modal.close();}));body.append(footer);
    body.addEventListener('input',refresh);body.addEventListener('change',refresh);
    modal.addEventListener('close',()=>{refresh();env.onUpdate?.();},{once:true});
  }
  const profile=element(doc,'div','gw5-monster-summary'),classification=element(doc,'div','gw5-monster-classification');
  classification.append(readable('sheet.type','creatureType'),readable('sheet.size','size'),readable('sheet.alignment','alignment'));
  const challenge=readable('sheet.cr','monsterChallenge','gw5-monster-challenge');
  const configure=iconButton(t('monsterDetails'),'settings',()=>openEditor(t('monsterProfile'),profileFields),!env.view().canEdit);configure.dataset.gw5MonsterSettings='';
  profile.append(classification,challenge,configure);root.append(profile);

  const grid=element(doc,'div','gw5-monster-grid'),aside=element(doc,'aside','gw5-monster-aside'),play=element(doc,'div','gw5-monster-play');root.append(grid);grid.append(aside,play);
  const skills=section('dnd5e.ui.pericias','gw5-skills gw5-monster-skills'),head=element(doc,'div','gw5-skill-head');
  head.append(element(doc,'span','gw5-skill-head-name',t('skill')),element(doc,'span','gw5-skill-head-ability',t('ability')),element(doc,'span','gw5-skill-head-bonus',t('bonus')));skills.append(head);
  for(const entry of leaves.filter(entry=>entry.type==='rollableStat'))skills.append(render(entry));
  const flourish=icon(doc,'leaf');flourish.classList.add('gw5-skills-flourish');skills.append(flourish);aside.append(skills);

  const abilities=section('dnd5e.ui.atributos','gw5-monster-abilities'),abilityGrid=element(doc,'div','gw5-monster-ability-grid');
  for(const entry of leaves.filter(entry=>entry.type==='abilityCard'))abilityGrid.append(render(entry));abilities.append(abilityGrid);play.append(abilities);

  const combat=section('combatResources','gw5-combat gw5-monster-combat'),stats=element(doc,'div','gw5-combat-stats gw5-monster-stats');
  for(const path of ['sheet.ac','sheet.init']){const entry=find(path);if(entry)stats.append(render(entry));}
  const speed=element(doc,'div','gw5-stat gw5-monster-speed'),speedLabel=element(doc,'span','gw5-monster-speed-label',t('monsterSpeed')),speedValue=element(doc,'output');speed.append(icon(doc,'boot'),speedLabel,speedValue);readers.push({path:'sheet.speed',value:speedValue});stats.append(speed);
  stats.append(node({type:'combatStat',valuePath:'sheet.prof',labelKey:'proficiencyShort'}));combat.append(stats);play.append(combat);

  const resources=element(doc,'div','gw5-monster-resources'),health=section('dnd5e.ui.pontos.de.vida','gw5-health gw5-monster-health'),hp=find('sheet.hp.value');
  if(hp){used.add(hp);health.append(resource(hp));}resources.append(health);
  const tracks=leaves.filter(entry=>entry.type==='checkboxTrack'),legendary=element(doc,'details','gw5-section gw5-monster-legendary-resources');
  legendary.open=tracks.some(entry=>numeric(get(env.draft(),entry.path,0))>0);legendary.append(element(doc,'summary','',t('monsterLegendaryResources')));
  const counters=element(doc,'div','gw5-monster-legendary-counters');for(const entry of tracks)counters.append(render(entry));legendary.append(counters);resources.append(legendary);play.append(resources);

  const defenses=section('monsterDefenses','gw5-monster-defenses'),defenseValues=element(doc,'div','gw5-monster-defense-values');
  for(const path of ['sheet.senses','sheet.languages','sheet.resistances']){const entry=find(path);if(entry)defenseValues.append(readable(path,entry.labelKey,path==='sheet.resistances'?'gw5-monster-defense-wide':''));}defenses.append(defenseValues);play.append(defenses);

  function prose(entry,label){
    used.add(entry);const box=element(doc,'details','gw5-monster-prose'),summary=element(doc,'summary'),heading=element(doc,'span','',t(label));
    box.open=!!String(get(env.draft(),entry.path,'')).trim();summary.append(heading);
    const edit=iconButton(t('editSection',{section:t(label)}),'pencil',()=>openEditor(t(label),[entry]),!env.view().canEdit);edit.dataset.gw5MonsterEdit=entry.path;edit.addEventListener('click',event=>event.stopPropagation());summary.append(edit);box.append(summary);
    const text=element(doc,'div','gw5-monster-prose-text');readers.push({path:entry.path,value:text});box.append(text);return box;
  }
  const attacks=section('dnd5e.ui.ataques','gw5-monster-attacks'),attackList=find('sheet.attacks');if(attackList)attacks.append(render(attackList));
  const actionsText=find('sheet.actions_text');if(actionsText)attacks.append(prose(actionsText,'monsterActions'));play.append(attacks);
  const features=section('dnd5e.ui.caracteristicas','gw5-monster-features'),featureList=find('sheet.features');if(featureList)features.append(render(featureList));
  const traits=find('sheet.traits');if(traits)features.append(prose(traits,'monsterTraits'));play.append(features);
  const legendaryText=find('sheet.legendary');if(legendaryText)play.append(prose(legendaryText,'dnd5e.ui.acoes.lendarias'));
  // New fields added to the declarative layout remain available automatically.
  const additional=leaves.filter(entry=>!used.has(entry));if(additional.length){const box=section('moreResources','gw5-monster-additional');additional.forEach(entry=>box.append(render(entry)));play.append(box);}
  root.addEventListener('input',refresh);root.addEventListener('change',refresh);refresh();return root;
}
