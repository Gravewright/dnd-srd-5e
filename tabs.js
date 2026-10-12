import {get,set,numeric,signed,weaponBonuses,spellRollKind,consumeItem} from './rules.js';
import {icon} from './icons.js';
import {equippedItems,attunedItems} from './item-drop.js';

const el=(doc,tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const searchText=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();

// Tab layouts are original Gravewright UI; document writes stay in the sheet's save queue.
export function createTabs(env) {
  const {doc,t,field,node,button,iconButton,api,context,roll,editEmbedded,flush,changed}=env;
  const state=new Map();
  const section=(title,cls='')=>{const box=el(doc,'section',`gw5-section ${cls}`);box.append(el(doc,'h3','',t(title)));return box;};
  const itemsAt=path=>get(env.draft(),path,[]);
  const update=(path,id,change)=>{const list=structuredClone(itemsAt(path)),index=list.findIndex(item=>item.id===id);if(index<0)return;change(list[index]);changed(path,list);};
  const labelType=type=>t({weapon:'weapon',armor:'armor',equipment:'equipment',consumable:'consumables',feat:'feats',feature:'features',race:'race',background:'background',class:'class',effect:'effects'}[type]||'items');
  const levelOf=entry=>Math.max(0,Math.min(9,Math.trunc(numeric(entry.data?.level??entry.level))));
  const levelLabel=level=>level===0?t('cantrips'):`${t('spellLevel')} ${level}`;
  function enumLabel(type,path,value){
    const visit=node=>node?.path===path?node:(node?.children||[]).map(visit).find(Boolean);
    const choice=visit(env.itemLayouts[`items/${type}`]?.body)?.options?.find(option=>option.value===value);
    return choice?t(choice.labelKey||choice.label):String(value||'');
  }

  function browser(kind,listNodes,onUpdate=()=>{}) {
    const box=el(doc,'section','gw5-section gw5-browser');box.dataset.kind=kind;
    const paths=listNodes.map(n=>n.path),key=kind+paths.join(','),current=state.get(key)||{query:'',filter:'all',paths};state.set(key,current);
    const toolbar=el(doc,'div','gw5-browser-toolbar'),search=el(doc,'input');search.type='search';search.placeholder=t('search'+kind);search.setAttribute('aria-label',t('search'+kind));search.value=current.query;
    const filter=el(doc,'select');filter.setAttribute('aria-label',t('filter'));
    const choices=kind==='spells'?[['all','allSpells'],['prepared','prepared'],['ritual','rituals'],['concentration','concentration']]:kind==='inventory'?[['all','allItems'],['equipped','equipped'],['weapon','weapon'],['armor','armor'],['equipment','equipment'],['consumable','consumables']]:kind==='effects'?[['all','allEffects'],['active','activeEffects'],['inactive','inactiveEffects']]:[['all','allFeatures'],['feat','feats'],['feature','features'],['race','race'],['background','background'],['class','class']];
    for(const [value,label] of choices){const option=el(doc,'option','',t(label));option.value=value;filter.append(option);}filter.value=current.filter;
    const canEdit=()=>env.view().canEdit&&(kind!=='effects'||context.role==='gm');
    toolbar.append(search,filter);
    const groups=el(doc,'div','gw5-browser-groups');box.append(toolbar,groups);
    search.oninput=()=>{current.query=search.value;draw();};filter.onchange=()=>{current.filter=filter.value;draw();};
    function draw(){
      groups.replaceChildren();let all=listNodes.flatMap(n=>itemsAt(n.path).map(entry=>({entry,path:n.path,layout:n})));
      const query=searchText(current.query.trim()),filtered=all.filter(({entry})=>{
        if(query&&!searchText([entry.name,entry.data?.school,enumLabel('spell','sheet.school',entry.data?.school),labelType(entry.type),enumLabel(entry.type,'sheet.armor_type',entry.data?.armor_type),entry.data?.description].join(' ')).includes(query))return false;
        if(current.filter==='all')return true;
        if(kind==='spells')return current.filter==='prepared'?!!entry.prepared:!!entry.data?.[current.filter];
        if(current.filter==='equipped')return !!entry.equipped;
        if(current.filter==='active')return entry.enabled!==false;
        if(current.filter==='inactive')return entry.enabled===false;
        return entry.type===current.filter;
      });
      if(!filtered.length){const empty=el(doc,'div','gw5-browser-empty');empty.append(icon(doc,kind==='spells'?'book':kind==='effects'?'sun':kind==='inventory'?'shield':'leaf'),el(doc,'h4','',t(all.length?'noResults':'empty'+kind)),el(doc,'p','',t(all.length?'changeSearch':'hint'+kind)));groups.append(empty);return;}
      const grouped=new Map();for(const record of filtered){const key=kind==='spells'?levelOf(record.entry):kind==='effects'?(record.entry.enabled===false?'inactive':'active'):record.entry.type;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(record);}
      const keys=[...grouped.keys()];if(kind==='spells')keys.sort((a,b)=>a-b);else if(kind==='effects')keys.sort((a,b)=>a==='active'?-1:b==='active'?1:0);
      for(const key of keys){const group=el(doc,'section','gw5-item-group'),heading=el(doc,'header'),title=kind==='spells'?levelLabel(key):kind==='effects'?t(key==='active'?'activeEffects':'inactiveEffects'):key==='weapon'?t('weapons'):labelType(key);heading.append(el(doc,'h4','',title),el(doc,'span','',String(grouped.get(key).length)));group.append(heading);
        const head=el(doc,'div','gw5-browser-head');head.dataset.kind=kind;
        const columns=kind==='spells'?['name','castingTime','range','prepared','actions']:kind==='inventory'?['name','quantity','weight','equipped','actions']:kind==='effects'?['name','duration','enabled','actions']:['name','actions'];for(const label of columns)head.append(el(doc,'span','',t(label==='quantity'?'quantityShort':label)));group.append(head);
        for(const record of grouped.get(key))group.append(row(record));groups.append(group);
      }
    }
    function row({entry,path,layout}){
      const row=el(doc,'article','gw5-catalog-row');row.dataset.kind=kind;row.dataset.entryId=entry.id;
      const details=el(doc,'details','gw5-item-identity'),summary=el(doc,'summary'),glyph=el(doc,'span','gw5-item-glyph');glyph.append(icon(doc,kind==='spells'?'book':kind==='effects'?'sun':entry.type==='weapon'?'swords':entry.type==='armor'?'shield':kind==='features'?'leaf':'star'));
      const title=el(doc,'span','gw5-item-name');title.append(el(doc,'strong','',entry.name));const data=entry.data||{};
      const bonus=entry.type==='weapon'?weaponBonuses(env.draft(),entry):null,damageText=data.damage+(bonus?.damageBonus?' '+signed(bonus.damageBonus):'');
      const subtitle=kind==='spells'?[enumLabel('spell','sheet.school',data.school),data.ritual?t('ritual'):null,data.concentration?t('concentration'):null].filter(Boolean).join(' · '):kind==='effects'?[t({condition:'condition',buff:'positiveEffect',debuff:'negativeEffect',stance:'stance'}[data.category]||'effect'),data.concentration?t('concentration'):null].filter(Boolean).join(' · '):kind==='inventory'?[labelType(entry.type),bonus?t('attackBonus')+' '+signed(bonus.attackBonus):null,data.damage?damageText:null,enumLabel(entry.type,'sheet.armor_type',data.armor_type)].filter(Boolean).join(' · '):labelType(entry.type);
      title.append(el(doc,'small','gw5-item-subtitle',subtitle));summary.append(glyph,title);details.append(summary,el(doc,'p','gw5-item-description',data.description||data.benefits||t('noDescription')));row.append(details);
      const cell=(label,value)=>{const cell=el(doc,'div','gw5-item-cell');cell.dataset.label=t(label);if(typeof value==='string')cell.textContent=value;else cell.append(value);row.append(cell);return cell;};
      const checkbox=(key,label)=>{const input=el(doc,'input');input.type='checkbox';input.checked=key==='enabled'?entry.enabled!==false:!!entry[key];input.disabled=!canEdit();input.setAttribute('aria-label',`${t(label)} · ${entry.name}`);input.dataset.gw5EntryField=key;input.onchange=()=>{if(key==='equipped'){for(const [changedPath,list] of Object.entries(equippedItems(env.draft(),path,entry.id,input.checked)))changed(changedPath,list);}else update(path,entry.id,item=>{item[key]=input.checked;if(key==='enabled'&&input.checked){if(item.data?.duration)delete item.data.duration.remaining;delete item.duration;}});if(current.filter!=='all'||kind==='effects'||key==='equipped'&&entry.type==='armor')draw();onUpdate();};return input;};
      if(kind==='spells'){cell('castingTime',String(data.casting_time||'—'));cell('range',String(data.range||'—'));cell('prepared',checkbox('prepared','prepared'));}
      if(kind==='inventory'){const qty=el(doc,'input');qty.type='number';qty.min='0';qty.max='1000000';qty.step='1';qty.value=String(Math.max(0,numeric(entry.quantity??data.quantity,1)));qty.disabled=!canEdit();qty.setAttribute('aria-label',`${t('quantity')} · ${entry.name}`);qty.dataset.gw5EntryField='quantity';qty.oninput=()=>{if(qty.validity.valid){update(path,entry.id,item=>item.quantity=Math.max(0,Math.trunc(numeric(qty.value))));onUpdate();}};cell('quantity',qty);cell('weight',`${numeric(data.weight)} ${t('weightUnit')}`);const state=el(doc,'div','gw5-item-equipment-state');state.append(checkbox('equipped','equipped'));if(data.requiresAttunement){const label=el(doc,'label','gw5-checkbox',t('attuned')),input=el(doc,'input');input.type='checkbox';input.checked=entry.attuned===true;input.disabled=!canEdit();input.dataset.gw5EntryField='attuned';input.setAttribute('aria-label',`${t('attuned')} · ${entry.name}`);input.onchange=()=>{try{for(const [key,list]of Object.entries(attunedItems(env.draft(),path,entry.id,input.checked)))changed(key,list);draw();onUpdate();}catch(error){input.checked=!input.checked;env.dropError(error);}};label.append(input);state.append(label);}cell('equipped',state);}
      if(kind==='effects'){const duration=data.duration;cell('duration',duration&&typeof duration==='object'?duration.type==='permanent'?t('permanent'):`${numeric(duration.remaining??entry.duration?.remaining??duration.value)} ${t({rounds:'rounds',minutes:'minutes',session:'session'}[duration.type]||'rounds')}`:String(duration||t('permanent')));cell('enabled',checkbox('enabled','enabled'));}
      const controls=el(doc,'div','gw5-row gw5-item-actions');
      controls.append(iconButton(t('edit'),'pencil',()=>editEmbedded(itemsAt(path).find(item=>item.id===entry.id),(updated,fieldPath,value)=>{update(path,entry.id,item=>{if(fieldPath==='core.name')item.name=String(value);else {item.data=structuredClone(updated.data);if(fieldPath.startsWith('sheet.duration.'))delete item.duration;}});onUpdate();},()=>draw()),!canEdit()));
      if(kind==='spells')controls.append(iconButton(t('castSpell'),'book',()=>env.cast(itemsAt(path).find(item=>item.id===entry.id)),!env.view().canEdit));
      if(kind==='spells'&&['attack_melee','attack_ranged'].includes(data.resolution))controls.append(iconButton(t('spellAttack'),'target',()=>roll('spell.attack',itemsAt(path).find(item=>item.id===entry.id)),!env.view().canEdit));
      for(const action of layout.row?.actions||[])if(action.type==='itemAction'&&(!action.action.includes('damage')||data.damage||data.formulaProfile?.kind==='damage'))controls.append(iconButton(t(action.labelKey),action.action.includes('damage')?'dice':'target',()=>roll(action.action,itemsAt(path).find(item=>item.id===entry.id)),!env.view().canEdit));
      if(kind==='spells'&&['healing','temporary'].includes(spellRollKind(entry))&&(data.healingFormula||data.formulaProfile))controls.append(iconButton(t(spellRollKind(entry)==='healing'?'rollHealing':'temporary'),'heart',()=>roll(spellRollKind(entry)==='healing'?'spell.healing':'spell.temporary',itemsAt(path).find(item=>item.id===entry.id)),!env.view().canEdit));
      if(kind==='features'&&(data.damage||data.breathWeapon))controls.append(iconButton(t('damage'),'dice',()=>roll('feature.damage',itemsAt(path).find(item=>item.id===entry.id)),!canEdit()));
      if(kind==='features'&&data.healingFormula)controls.append(iconButton(t('rollHealing'),'heart',()=>roll('feature.healing',itemsAt(path).find(item=>item.id===entry.id)),!canEdit()));
      if(data.uses&&numeric(data.uses.max)>0){
        const uses=el(doc,'span','gw5-item-detail',`${numeric(data.uses.value)} / ${numeric(data.uses.max)}`);uses.setAttribute('aria-label',t('remainingUses'));controls.append(uses);if(kind!=='spells')controls.append(iconButton(t('useResource'),'star',()=>{update(path,entry.id,item=>consumeItem(item));draw();onUpdate();},!canEdit()||numeric(data.uses.value)<=0));
      }
      else if(entry.type==='consumable')controls.append(iconButton(t('consumeItem'),'flask',()=>{update(path,entry.id,item=>consumeItem(item,{quantity:true}));draw();onUpdate();},!canEdit()||numeric(entry.quantity??data.quantity)<=0));
      const parent=env.advancementParent(entry.id);if(parent?.type==='class'){const level=button(t('classLevelShort',{level:parent.classLevel}),()=>env.advanceClass(entry.id),!canEdit());level.classList.add('gw5-class-level');level.setAttribute('aria-label',`${t('classLevel')} ${parent.classLevel}`);level.title=level.getAttribute('aria-label');controls.append(level);}
      if(kind==='effects'&&context.tokenId)controls.append(iconButton(t('applyCondition'),'token',async()=>{await flush();const latest=itemsAt(path).find(item=>item.id===entry.id);await api.tokens.addCondition({sceneId:context.sceneId,tokenIds:[context.tokenId],label:latest.name,description:latest.data?.description||'',kind:latest.data?.category==='buff'?'positive':'negative',visibility:'everyone'});},!canEdit()));
      controls.append(iconButton(t('remove'),'trash',()=>env.removeEntry(path,entry.id),!canEdit()));row.append(controls);return row;
    }
    draw();return box;
  }
  function slots(){
    const box=section('dnd5e.ui.espacos.de.magia','gw5-slot-panel'),grid=el(doc,'div','gw5-slot-grid'),empty=el(doc,'p','gw5-empty',t('noSlots'));let showAll=false;const cards=[];
    const configure=button(t('configureSlots'),()=>{showAll=!showAll;configure.setAttribute('aria-expanded',String(showAll));refresh();});configure.classList.add('gw5-slot-config');configure.setAttribute('aria-expanded','false');
    function refresh(){for(const {card,maxPath} of cards)card.hidden=!showAll&&!numeric(get(env.draft(),maxPath,0));empty.hidden=showAll||cards.some(({maxPath})=>numeric(get(env.draft(),maxPath,0))>0);}
    for(let level=1;level<=9;level++){
      const card=el(doc,'div','gw5-slot-card'),heading=el(doc,'header','',levelLabel(level)),fields=el(doc,'div','gw5-slot-values gw5-row'),pips=el(doc,'div','gw5-slot-pips');
      const valuePath=`sheet.slots.l${level}.value`,maxPath=`sheet.slots.l${level}.max`;
      const maxField=field({type:'numberField',path:maxPath,labelKey:'maximum'},env.draft(),(path,value)=>{const max=Math.max(0,Math.min(100,Math.trunc(value)));changed(path,max);if(numeric(get(env.draft(),valuePath,0))>max){changed(valuePath,max);valueField.querySelector('input').value=String(max);}draw();});const maxInput=maxField.querySelector('input');maxInput.min='0';maxInput.max='100';maxInput.step='1';
      const valueField=field({type:'numberField',path:valuePath,labelKey:'available'},env.draft(),(path,value)=>{const count=Math.max(0,Math.min(Math.trunc(value),numeric(get(env.draft(),maxPath,0))));changed(path,count);valueField.querySelector('input').value=String(count);draw();});valueField.querySelector('input').min='0';valueField.querySelector('input').step='1';
      fields.append(valueField,el(doc,'span','','/'),maxField);card.append(heading,fields,pips);grid.append(card);cards.push({card,maxPath});
      function draw(){const value=numeric(get(env.draft(),valuePath,0)),max=Math.max(0,Math.trunc(numeric(get(env.draft(),maxPath,0))));pips.replaceChildren();card.dataset.empty=String(!max);for(let index=0;index<Math.min(max,10);index++){const target=index<value?index:index+1,b=button('',()=>{changed(valuePath,target);valueField.querySelector('input').value=String(target);draw();},!env.view().canEdit);b.setAttribute('aria-label',t('setSlots',{level,count:target}));b.setAttribute('aria-pressed',String(index<value));pips.append(b);}}draw();
    }
    const pact=el(doc,'details','gw5-pact-slots');pact.append(el(doc,'summary','',t('pactMagic')));
    const pactFields=el(doc,'div','gw5-row');for(const [path,label] of [['sheet.pactSlots.level','slotLevel'],['sheet.pactSlots.value','available'],['sheet.pactSlots.max','maximum']])pactFields.append(field({type:'numberField',path,labelKey:label}));pact.append(pactFields);
    box.append(grid,empty,configure,pact);refresh();return box;
  }
  function spells(entries){
    const dashboard=el(doc,'div','gw5-spell-dashboard'),casting=section('dnd5e.ui.conjuracao','gw5-casting-panel'),settings=el(doc,'div','gw5-casting-settings');
    const config=entries.find(n=>n.variant==='spellcasting')?.children?.find(n=>n.type==='row')?.children||[];
    const ability=config.find(n=>n.path==='sheet.spell.ability');if(ability)settings.append(field(ability));settings.append(field({type:'readonlyField',path:'sheet.spell.mod',labelKey:'spellModifier'}));
    const stats=el(doc,'div','gw5-casting-stats');stats.append(node({type:'combatStat',valuePath:'sheet.spell.dc',labelKey:'dnd5e.ui.cd.de.magia'}),node({type:'combatStat',valuePath:'sheet.spell.attack',labelKey:'spellAttack',interaction:{action:'roll.spell_attack'}}));casting.append(settings,stats);dashboard.append(casting,slots());
    const list=entries.find(n=>n.variant==='spellbook')?.children.find(n=>n.type==='itemList');return [dashboard,...(list?[browser('spells',[list])]:[])];
  }
  function inventory(entries){
    const currency=el(doc,'section','gw5-currency-panel'),strip=el(doc,'div','gw5-currency-strip');currency.setAttribute('aria-label',t('dnd5e.ui.moedas'));for(const [coin,key] of [['cp','dnd5e.ui.pc'],['sp','dnd5e.ui.pp'],['ep','dnd5e.ui.pe'],['gp','dnd5e.ui.po'],['pp','dnd5e.ui.pl']]){const f=field({type:'numberField',path:`sheet.currency.${coin}`,labelKey:key});f.dataset.coin=coin;f.querySelector('input').min='0';strip.append(f);}currency.append(strip);
    const summary=el(doc,'p','gw5-inventory-summary'),main=env.layout.body.tabs.find(tab=>tab.id==='main'),weapon=main?.children.find(n=>n.variant==='attacks')?.children.find(n=>n.type==='itemList'),list=entries.find(n=>n.variant==='inventory-list')?.children.find(n=>n.type==='itemList');
    const lists=[weapon,list].filter(Boolean);function totals(){const all=lists.flatMap(n=>itemsAt(n.path));summary.textContent=t('inventoryTotals',{count:api.i18n.number(all.reduce((sum,item)=>sum+Math.max(0,numeric(item.quantity??item.data?.quantity,1)),0)),weight:api.i18n.number(Math.round(all.reduce((sum,item)=>sum+Math.max(0,numeric(item.data?.weight))*Math.max(0,numeric(item.quantity??item.data?.quantity,1)),0)*100)/100),unit:t('weightUnit')});}totals();return [currency,summary,browser('inventory',lists,totals)];
  }
  function biography(entries){
    const grid=el(doc,'div','gw5-biography-grid'),main=el(doc,'div','gw5-biography-main'),aside=el(doc,'div','gw5-biography-aside'),identity=section('identity','gw5-bio-identity'),identityFields=el(doc,'div','gw5-identity-grid');
    for(const [path,label] of [['sheet.class','class'],['sheet.background','background'],['sheet.race',env.edition()==='2024'?'species':'race'],['sheet.alignment','alignment']])identityFields.append(field({type:'textField',path,labelKey:label}));identity.append(identityFields);main.append(identity);
    const notes=section('storyNotes','gw5-journal gw5-story');const note=field({type:'textArea',path:'sheet.notes',labelKey:'storyNotes'});note.classList.add('gw5-journal-field','gw5-journal-field--notes');note.querySelector('textarea').rows=11;notes.append(note);main.append(notes);
    const personality=section('dnd5e.ui.personalidade','gw5-journal'),traits=el(doc,'div','gw5-personality-grid');for(const child of entries.find(n=>n.variant==='personality')?.children||[]){const f=field(child);f.classList.add('gw5-journal-field');traits.append(f);}personality.append(traits);aside.append(personality);
    const prof=entries.find(n=>n.variant==='proficiencies');if(prof){const panel=node(prof);panel.classList.add('gw5-proficiencies','gw5-journal');panel.querySelectorAll('.gw5-field').forEach(f=>f.classList.add('gw5-journal-field'));aside.append(panel);}
    const data=env.draft(),grants=section('grantedTraits','gw5-granted-traits'),facts=el(doc,'dl','gw5-item-reading-facts');
    const fact=(label,value)=>{if(!value)return;const line=el(doc,'div');line.append(el(doc,'dt','',t(label)),el(doc,'dd','',value));facts.append(line);};
    if(data.size)fact('size',t('size'+data.size[0].toUpperCase()+data.size.slice(1)));
    for(const [sense,value]of Object.entries(data.effectiveSenses||data.senses||{}))if(typeof value==='number'&&value>0)fact('sense'+sense[0].toUpperCase()+sense.slice(1),t('distanceFeetValue',{value}));
    for(const [movement,value]of Object.entries(data.effectiveMovement||data.movement||{}))if(movement!=='walk'&&typeof value==='number'&&value>0)fact('movement'+movement[0].toUpperCase()+movement.slice(1),t('distanceFeetValue',{value}));
    for(const [kind,values]of Object.entries(data.damageTraits||{}))if(Array.isArray(values))fact(kind,values.map(value=>t('damageType'+value[0].toUpperCase()+value.slice(1))).join(', '));
    if(facts.childElementCount){grants.append(facts);aside.append(grants);}grid.append(main,aside);
    const feature=entries.find(n=>n.variant==='feature-list')?.children.find(n=>n.type==='itemList');return [grid,...(feature?[browser('features',[feature])]:[])];
  }
  function effects(entries){
    const list=entries.flatMap(n=>n.children||[]).find(n=>n.type==='itemList');if(!list)return entries.map(node);
    const overview=el(doc,'div','gw5-effects-overview');function totals(){overview.replaceChildren();const effects=itemsAt(list.path);for(const [label,count] of [['activeEffects',effects.filter(e=>e.enabled!==false).length],['inactiveEffects',effects.filter(e=>e.enabled===false).length],['concentration',effects.filter(e=>e.enabled!==false&&e.data?.concentration).length]]){const card=el(doc,'div');card.append(el(doc,'strong','',String(count)),el(doc,'span','',t(label)));overview.append(card);}}totals();return [overview,browser('effects',[list],totals)];
  }
  const renderTab=(id,entries)=>({spells,inventory,bio:biography,effects}[id]?.(entries)||entries.map(node));
  renderTab.revealItem=path=>{for(const current of state.values())if(current.paths.includes(path)){current.query='';current.filter='all';}};
  return renderTab;
}
