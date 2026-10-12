import {SKILLS,derive,defaults,get,set,edit,numeric,signed,damage,heal,deathSave,concentrationSave,effectiveSpeed,rollFormula,rollContext,weaponBonuses,spellRollKind,hitDicePools,automaticFailure} from './rules.js';
import {rollResult,rollOutcome,heroicDice,heroicReroll} from './automation.js';
import {createAutomationUI} from './automation-ui.js';
import {icon} from './icons.js';
import {createTabs} from './tabs.js';
import {itemEditor} from './item-editor.js';
import {acceptsItemDrop,droppedItem,itemDestination,ownedItem} from './item-drop.js';
import {renderMonster} from './monster.js';
import {chooseAdvancement} from './advancement-ui.js';
import {removeAdvancement,syncAdvancementLevel} from './advancement.js';

const SIZE_KEYS={tiny:'sizeTiny',small:'sizeSmall',medium:'sizeMedium',large:'sizeLarge',huge:'sizeHuge',gargantuan:'sizeGargantuan'};

function element(doc,tag,cls,text) { const e=doc.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e; }
export function openModal(api,doc,title,signal,closeLabel='Close',opener=doc.activeElement) {
  const d=element(doc,'section','gw5-modal');
  d.setAttribute('translate','no');
  d.setAttribute('aria-label',title);d.dataset.movable='';
  const header=element(doc,'header','gw5-modal-title',title), close=element(doc,'button','gw5-close','×');
  header.dataset.moveHandle='';
  close.type='button';close.setAttribute('aria-label',closeLabel);close.onclick=()=>d.close();header.append(close);d.append(header);
  const abort=()=>d.close(true);signal?.addEventListener('abort',abort,{once:true});
  d.addEventListener('close',()=>{
    signal?.removeEventListener('abort',abort);
    queueMicrotask(()=>{if(!signal?.aborted&&opener?.isConnected&&!opener.disabled&&!opener.closest('[inert]'))opener.focus();});
  },{once:true});
  return api.ui.openModal(d,{nested:true});
}

export async function mountSheet(block, system, isItem=false) {
  const {root,context,api,signal,storage}=block, doc=root.ownerDocument, t=(key,params)=>api.i18n.t(key,params);
  root.setAttribute('translate','no');
  const sizeLabel=value=>SIZE_KEYS[value]?t(SIZE_KEYS[value]):String(value||'');
  let view=isItem ? await api.items.get(context.itemId) : await api.actors.sheet(context.actorId,context.tokenId?{tokenId:context.tokenId}:{});
  if(signal.aborted)return;
  const type=view.type || context.actorType, schema=system.schemas[isItem?'item':type];
  const layout=system.layouts[isItem?`items/${type}`:type];
  if(!layout || !schema)throw Error(t('unsupported'));
  let setting=await storage.table.get('rules'), edition=view.data.rulesEdition || setting?.value?.edition || '2014';
  let draft=isItem ? defaults(schema,view.data) : derive(view.data,type,schema,edition);
  if(isItem&&view.data.trained===undefined)delete draft.trained;
  if(isItem&&type==='effect'&&!draft.duration)draft.duration={type:'permanent',value:0};
  let name=view.name, changes=0,saved=0,pending,timer,uploadPromise,uploading=false,editing=0,saveState='saved',tab=layout.body.tabs?.[0]?.id;
  const shell=element(doc,'form','gw5-sheet'), notice=element(doc,'p','gw5-notice');notice.role='status';notice.hidden=true;
  const itemState={tab:'description'};
  let dropQueue=Promise.resolve(),actionSource;
  const work=new Set(),rollWindows=new Map(),pendingResolutions=new Set(),heroicControls=new Set(),advancementWindows=new Set();let heroicBusy=false;
  const registerAdvancement=window=>{notice.hidden=true;advancementWindows.add(window);window.addEventListener('close',()=>advancementWindows.delete(window),{once:true});};
  root.replaceChildren(shell);shell.onsubmit=event=>event.preventDefault();
  const indicators=new Set();let retry,conflicted=false;
  function status(state=saveState){saveState=state;if(retry)retry.hidden=state!=='error'||conflicted;for(const indicator of indicators){indicator.dataset.state=view.canEdit?state:'readonly';indicator.textContent=t(view.canEdit?{waiting:'autosaveWaiting',saving:'autosaveSaving',saved:'autosaveSaved',error:'autosaveError'}[state]:'readOnly');indicator.title=state==='error'?notice.textContent:t('autosaveHint');}}
  function saveIndicator(){const indicator=element(doc,'span','gw5-save-status');indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');indicators.add(indicator);status();return indicator;}
  const error=e=>{if(signal.aborted)return;conflicted=e.code==='conflict';notice.textContent=conflicted?t('conflict'):t('saveError');notice.hidden=false;status('error');};
  const dropError=e=>{if(signal.aborted)return;notice.textContent=t(e.code==='attunementLimit'?'attunementLimit':e.code==='unsupported_item'?'itemDropUnsupported':'itemDropError');notice.hidden=false;};
  function mark(){ changes++;status('waiting');clearTimeout(timer);timer=setTimeout(()=>void flush().catch(error),450); }
  function changed(path,value) {
    if(!view.canEdit)return;
    if(path==='core.name')name=String(value);else if(isItem){set(draft,path,value);if(['sheet.damage','sheet.healingFormula'].includes(path))delete draft.formulaProfile;if(path.startsWith('sheet.duration.')&&draft.duration){delete draft.duration.remaining;}}else edit(draft,path,value);
    if(!isItem&&path==='sheet.acMode')draft.acModeExplicit=true;
    if(!isItem&&path.startsWith('sheet.skills.')){if(path.endsWith('.prof')&&!value)set(draft,path.replace(/\.prof$/,'.expert'),false);if(path.endsWith('.expert')&&value)set(draft,path.replace(/\.expert$/,'.prof'),true);}
    if(path==='sheet.rulesEdition')edition=value==='2024'?'2024':'2014';
    if(!isItem)draft=derive(draft,type,schema,edition);
    mark();updateComputed();
  }
  const portraitFocus=()=>['x','y'].map((axis,index)=>Math.max(0,Math.min(100,numeric(get(draft,`sheet.portraitFocus.${axis}`,index===0?50:0),index===0?50:0))));
  const portraitPosition=()=>portraitFocus().map(value=>`${value}%`).join(' ');
  function syncHeroic(){for(const control of heroicControls)control.disabled=heroicBusy||!draft.inspiration||control.dataset.gw5RollLocked==='true';}
  function updateComputed() {
    syncHeroic();
    shell.querySelectorAll('input[type=checkbox][data-gw5-path]').forEach(input=>{input.checked=!!get(draft,input.dataset.gw5Path,false);});
    shell.querySelectorAll('[data-gw5-computed]').forEach(e=>{const value=get(draft,e.dataset.gw5Computed,0);e.textContent=e.dataset.gw5Signed?signed(value):String(value);if(e.dataset.gw5EffectiveAcExtra)e.hidden=value===draft.ac;});
    shell.querySelectorAll('[data-gw5-ability-bonus]').forEach(out=>{const ability=out.dataset.gw5AbilityBonus,proficient=get(draft,`saves.${ability}.prof`,false);out.textContent=signed(get(draft,`${proficient?'saves':'abilities'}.${ability}.mod`,0));out.title=t(proficient?'dnd5e.ui.salvaguarda':'abilityCheck');});
    shell.querySelectorAll('[data-gw5-effective-ability]').forEach(out=>{const ability=out.dataset.gw5EffectiveAbility;out.hidden=get(draft,`abilities.${ability}.score`)===get(draft,`abilities.${ability}.effectiveScore`);out.parentElement.classList.toggle('gw5-ability-base',!out.hidden);});
    shell.querySelectorAll('.gw5-hp-meter').forEach(meter=>{meter.max=Math.max(1,numeric(draft.bars?.bar_1?.max));meter.value=Math.max(0,numeric(draft.bars?.bar_1?.value));});
    shell.querySelectorAll('.gw5-portrait').forEach(image=>{image.style.objectPosition=portraitPosition();});
    shell.querySelectorAll('[data-gw5-weapon-stat]').forEach(output=>{const entry=[...(draft.weapons||[]),...(draft.attacks||[])].find(item=>item.id===output.dataset.entryId);if(!entry)return;const bonus=weaponBonuses(draft,entry);output.textContent=output.dataset.gw5WeaponStat==='attack'?signed(bonus.attackBonus):(entry.data?.damage||'—')+(bonus.damageBonus?' '+signed(bonus.damageBonus):'');});
  }
  async function drain() {
    if(saved!==changes)status('saving');
    while(saved!==changes && !signal.aborted) {
      const revision=changes,data=structuredClone(draft),nextName=name;
      if(isItem) {
        const result=await api.items.update({id:view.id,version:view.version,name:nextName,data});
        view={...view,version:result?.item?.version??result?.version??view.version+1,data,name:nextName};
      } else {
        const result=await api.actors.saveSheet({actorId:context.actorId,tokenId:context.tokenId||null,name:nextName,version:view.version,sheetVersion:view.sheetVersion,data});
        view={...view,...result,data,name:nextName};
      }
      saved=revision;
    }
    notice.hidden=true;
    status('saved');
  }
  function flush(){clearTimeout(timer);if(!pending)pending=drain().finally(()=>{pending=undefined;});return pending;}
  async function flushAll(){
    for(const window of advancementWindows)void window.close();
    while(!signal.aborted){
      const drops=dropQueue,upload=uploadPromise;
      await Promise.all([drops,upload,...work]);
      for(const finish of rollWindows.values())await finish();
      for(const finish of pendingResolutions)await finish();
      await flush();
      if(drops===dropQueue&&upload===uploadPromise&&!work.size)return;
    }
  }
  root.closest('.gw-window,.item-sheet')?.addEventListener('gravewright:sheet-flush',event=>event.detail.waitUntil(flushAll().catch(e=>{error(e);throw e;})),{signal});
  signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
  function managedModal(title,opener=actionSource||doc.activeElement){
    const entryId=opener?.closest('[data-entry-id]')?.dataset.entryId;
    const option=opener?.dataset.gw5Options,label=opener?.getAttribute('aria-label')||opener?.textContent;
    const modal=openModal(api,doc,title,signal,t('close'),opener);editing++;
    modal.addEventListener('gravewright:sheet-flush',event=>event.detail.waitUntil((async()=>{await Promise.all([...work]);await flush();})().catch(e=>{error(e);throw e;})));
    modal.addEventListener('close',()=>{
      editing--;for(const indicator of indicators)if(!indicator.isConnected)indicators.delete(indicator);
      // Editors redraw their source after close; restore its replacement button.
      queueMicrotask(()=>{
        if(signal.aborted||opener?.isConnected)return;
        const scope=entryId?[...shell.querySelectorAll('[data-entry-id]')].find(row=>row.dataset.entryId===entryId):shell;
        const replacement=[...scope?.querySelectorAll('button')||[]].find(button=>option?button.dataset.gw5Options===option:(button.getAttribute('aria-label')||button.textContent)===label);
        if(replacement&&!replacement.closest('[inert]'))replacement.focus();
      });
    },{once:true});
    return modal;
  }
  function button(label,run,disabled=false) {
    const b=element(doc,'button','gw5-button',label);b.type='button';b.disabled=disabled;
    b.onclick=async()=>{
      b.disabled=true;
      try{let result;const prior=actionSource;try{actionSource=b;result=run();}finally{actionSource=prior;}if(result?.then){work.add(result);try{await result;}finally{work.delete(result);}}}
      catch(e){error(e);}finally{if(b.isConnected)b.disabled=disabled||heroicControls.has(b)&&(heroicBusy||!draft.inspiration||b.dataset.gw5RollLocked==='true');}
    };
    return b;
  }
  function iconButton(label,glyph,run,disabled=false){
    const b=button(label,run,disabled);b.classList.add('gw5-icon-button');b.replaceChildren(icon(doc,glyph));b.setAttribute('aria-label',label);b.title=label;return b;
  }
  function field(node, owner=draft, callback=changed) {
    if(owner===draft&&!isItem&&node.path==='sheet.level'&&Object.values(draft.advancementLedger?.parents||{}).some(parent=>parent.type==='class'))node={...node,type:'readonlyField'};
    const path=node.path, label=t(node.labelKey||'name'), wrap=element(doc,'label','gw5-field',label);
    let value=path==='core.name'?name:get(owner,path,node.type==='numberField'?0:'');
    if(node.type==='readonlyField') {
      const out=element(doc,'output','',String(value));out.dataset.gw5Computed=path;wrap.append(out);return wrap;
    }
    const input=element(doc,node.type==='selectField'?'select':node.type==='textArea'?'textarea':'input');
    input.dataset.gw5Path=path;input.setAttribute('aria-label',label);input.title=label;
    if(node.type==='selectField') {
      for(const choice of node.options||[]) {const option=element(doc,'option','',t(choice.labelKey||choice.label));option.value=String(choice.value);input.append(option);}
      if(value!=='' && ![...input.options].some(o=>o.value===String(value))){const option=element(doc,'option','',String(value));option.value=String(value);input.append(option);}
    } else if(node.type==='numberField') {input.type='number';input.step='any';input.min='-1000000';input.max='1000000';}
    else if(node.type==='checkboxField')input.type='checkbox';else if(node.type!=='textArea')input.type='text';
    if(input.type==='checkbox')input.checked=!!value;else input.value=String(value);
    if(node.type==='textArea'){input.rows=3;input.maxLength=10000;}else if(input.type==='text')input.maxLength=1000;
    input.disabled=!view.canEdit;
    if(input.type==='checkbox'){wrap.classList.add('gw5-checkbox');wrap.title=label;}
    input.addEventListener(input.type==='checkbox'||node.type==='selectField'?'change':'input',()=>{
      if(input.type==='number' && !input.validity.valid)return;
      callback(path,input.type==='checkbox'?input.checked:input.type==='number'?numeric(input.value):input.value);
    },{signal});
    wrap.append(input);return wrap;
  }
  async function refreshEdition() {
    const current=draft.rulesEdition?undefined:await storage.table.get('rules');const next=draft.rulesEdition||current?.value?.edition||'2014';
    if(next!==edition){await flush();edition=next;if(!isItem)draft=derive(draft,type,schema,edition);render();}
    return edition;
  }
  const lastAttacks=new Map();
  async function roll(actionId,item,ability,overrides={}) {
    const opener=actionSource||doc.activeElement;
    for(const finish of pendingResolutions)await finish();
    await refreshEdition();await flush();
    const metadata=system.actions[actionId];if(!metadata)return;
    const d=managedModal(t(metadata.label?.startsWith('@')?'roll':metadata.label||'roll'),opener);
    let submitting,finishRoll,deferFinish=false;
    const settle=async()=>{await submitting;if(!deferFinish)await finishRoll?.();};
    rollWindows.set(d,settle);
    d.addEventListener('gravewright:sheet-flush',event=>event.detail.waitUntil(settle()));
    d.addEventListener('close',()=>rollWindows.delete(d),{once:true});
    const form=element(doc,'form','gw5-modal-body');d.append(form);
    const options={kind:'check',mode:'normal',extraModifier:0,extraDice:'',visibility:'public',critical:lastAttacks.get(item?.id)==='critical',...overrides};
    if(options.concentration){options.kind='save';options.dc=draft.concentration?.pendingDC;}
    const select=(key,label,choices)=>{
      const wrap=element(doc,'label','gw5-field',t(label)),input=element(doc,'select');input.name=key;
      for(const [value,text] of choices){const option=element(doc,'option','',t(text));option.value=value;input.append(option);}
      wrap.append(input);form.append(wrap);input.onchange=()=>options[key]=input.value;return input;
    };
    if(ability&&!options.concentration){
      const kind=select('kind','kind',[['check','abilityCheck'],['save','dnd5e.ui.salvaguarda']]);
      options.kind=actionId.startsWith('roll.save.')?'save':'check';kind.value=options.kind;
      kind.onchange=()=>{options.kind=kind.value;const title=t(system.actions[`roll.${options.kind}.${ability}`].label);d.querySelector('.gw5-modal-title').firstChild.nodeValue=title;d.setAttribute('aria-label',title);};
    }
    if((ability||actionId.startsWith('roll.save.'))&&!options.concentration)select('saveAgainst','saveAgainst',[['','ordinarySave'],['charmed','conditionCharmed'],['poisoned','conditionPoisoned'],['frightened','conditionFrightened'],['magicalSleep','magicalSleep']]);
    if(metadata.formula.includes('1d20'))select('mode','dnd5e.ui.modo',[['normal','dnd5e.ui.normal'],['advantage','dnd5e.ui.vantagem'],['disadvantage','dnd5e.ui.desvantagem']]);
    if(actionId.includes('damage')){
      const wrap=element(doc,'label','gw5-checkbox',t('critical')),input=element(doc,'input');input.type='checkbox';input.checked=options.critical;input.onchange=()=>options.critical=input.checked;wrap.append(input);form.append(wrap);
    }
    if(item?.type==='spell'&&numeric(item.data?.level)>0){const level=select('slotLevel','slotLevel',Array.from({length:10-numeric(item.data.level)},(_,index)=>[numeric(item.data.level)+index,'spellLevel'+(numeric(item.data.level)+index)]));options.slotLevel=numeric(draft.lastCast?.sourceId===item.id?draft.lastCast.slotLevel:item.data.level);level.value=String(options.slotLevel);level.onchange=()=>options.slotLevel=numeric(level.value);}
    if(actionId.includes('attack')||actionId.includes('save')||ability){const label=actionId.includes('attack')?'targetAC':'targetDC',wrap=element(doc,'label','gw5-field',t(label)),input=element(doc,'input');input.type='number';input.min='0';input.max='1000';input.placeholder='—';if(options.concentration){input.value=String(options.dc);input.disabled=true;}else input.oninput=()=>options[actionId.includes('attack')?'ac':'dc']=input.value===''?undefined:numeric(input.value);wrap.append(input);form.append(wrap);}
    if(edition==='2014'&&draft.inspiration&&metadata.formula.includes('1d20')){const wrap=element(doc,'label','gw5-checkbox',t('useInspiration')),input=element(doc,'input');input.type='checkbox';input.onchange=()=>options.inspiration=input.checked;wrap.append(input);form.append(wrap);}
    if(actionId.includes('attack')||item?.type==='weapon'||(draft.conditions||[]).includes('frightened')){
      const details=element(doc,'details','gw5-roll-context');details.append(element(doc,'summary','',t('rollContext')));
      const check=(key,label)=>{const wrap=element(doc,'label','gw5-checkbox',t(label)),input=element(doc,'input');input.type='checkbox';input.onchange=()=>options[key]=input.checked;wrap.append(input);details.append(wrap);return input;};
      if((draft.conditions||[]).includes('frightened'))check('fearSourceVisible','fearSourceVisible');
      if(item?.type==='weapon'){check('twoHanded','twoHanded');check('offhand','offhand');check('addOffhandAbility','addOffhandAbility');}
      if(actionId.includes('attack')){
        const wrap=element(doc,'label','gw5-field',t('distanceFeet')),distance=element(doc,'input');distance.type='number';distance.min='0';distance.step='any';distance.oninput=()=>options.distance=distance.value===''?undefined:numeric(distance.value);wrap.append(distance);details.append(wrap);
        check('canSeeTarget','canSeeTarget');check('targetCanSeeAttacker','targetCanSeeAttacker');
        const target=element(doc,'fieldset','gw5-condition-grid');target.append(element(doc,'legend','',t('targetConditions')));options.targetConditions=[];
        for(const id of ['blinded','invisible','paralyzed','petrified','prone','restrained','stunned','unconscious']){const label=element(doc,'label','gw5-checkbox',t('condition'+id[0].toUpperCase()+id.slice(1))),input=element(doc,'input');input.type='checkbox';input.onchange=()=>{options.targetConditions=[...target.querySelectorAll('input:checked')].map(input=>input.value);};input.value=id;label.append(input);target.append(label);}details.append(target);
      }
      form.append(details);
    }
    for(const [key,label,type] of [['extraModifier','dnd5e.ui.modificador.extra','number'],['extraDice','dnd5e.ui.dados.extras','text']]){
      const wrap=element(doc,'label','gw5-field',t(label)),input=element(doc,'input');input.name=key;input.type=type;input.value=String(options[key]);
      if(type==='number'){input.min='-1000000';input.max='1000000';}else input.maxLength=100;
      input.oninput=()=>options[key]=type==='number'?numeric(input.value):input.value;wrap.append(input);form.append(wrap);
    }
    select('visibility','dnd5e.ui.visibilidade',[['public','public'],['gm','gm']]);
    const message=element(doc,'p','gw5-notice');message.role='alert';form.append(message);
    const submit=element(doc,'button','gw5-button',t('roll'));submit.type='submit';form.append(submit);
    form.onsubmit=event=>{
      event.preventDefault();if(submitting)return;
      const task=(async()=>{submit.disabled=true;
      try {
        await refreshEdition();
        const id=ability?`roll.${options.kind}.${ability}`:actionId,action={...system.actions[id],id};
        const context=rollContext(draft,action,{...options,item,edition});options.criticalOnHit=context.critical;
        if(context.immune){message.textContent=t('saveImmune');submit.disabled=false;return;}
        if(automaticFailure(draft,action)){message.textContent=t('automaticFailure');submit.disabled=false;return;}
        const kind=actionId.includes('damage')?(item?.type==='spell'?spellRollKind(item):'damage'):actionId.endsWith('.healing')?'healing':actionId.endsWith('.temporary')?'temporary':null;
        let expression=rollFormula(action,draft,{...options,item,edition});
        if(['damage','healing','temporary'].includes(kind))expression=`max(0, ${expression})`;
        const label=(item?.name || t(action.label) || t('roll')).slice(0,48);
        let nativeMessage=await api.dice.roll(expression,{label,visibility:options.visibility,requestId:crypto.randomUUID()}),parsed=rollResult(nativeMessage);
        for(const control of heroicControls)control.dataset.gw5RollLocked='true';syncHeroic();
        if(options.inspiration){draft.inspiration=false;mark();}
        let finalized,pendingReroll;
        let applied=false,locked=false,controls;
        const stateful=actionId==='roll.death_save'||options.concentration;
        const concentrationSource=draft.concentration?.sourceId,concentrationCheck=JSON.stringify(draft.concentration?.pendingChecks?.[0]||{dc:draft.concentration?.pendingDC});
        const finish=()=>finalized??=(async()=>{
          if(pendingReroll)await pendingReroll;
          if(!applied){
            if(actionId==='roll.death_save'&&!draft.death?.dead&&!draft.death?.stable&&numeric(draft.bars?.bar_1?.value)===0)deathSave(draft,parsed);
            if(options.concentration&&draft.concentration?.active&&draft.concentration.pendingDC&&draft.concentration.sourceId===concentrationSource&&JSON.stringify(draft.concentration.pendingChecks?.[0]||{dc:draft.concentration.pendingDC})===concentrationCheck)concentrationSave(draft,parsed);
            if(actionId.includes('attack'))lastAttacks.set(item?.id,rollOutcome(actionId,parsed,options));
            applied=true;
          }
          draft=derive(draft,type,schema,edition);mark();await flush();render();
          pendingResolutions.delete(finish);
          if(stateful)controls?.querySelectorAll('[data-heroic-reroll],select,[data-keep-roll]').forEach(control=>{control.disabled=true;control.dataset.gw5RollLocked='true';});
        })().catch(error=>{finalized=undefined;throw error;});
        finishRoll=finish;
        const show=()=>{
          controls=element(doc,'div','gw5-chat-actions');
          const outcome=rollOutcome(actionId,parsed,options);if(outcome)controls.append(element(doc,'strong','gw5-chat-outcome',t(outcome)));
          if(!locked&&(!stateful||!applied)&&edition==='2024'&&draft.inspiration){
            const choices=heroicDice(parsed.result);if(choices.length){
              const wrap=element(doc,'label','gw5-field',t('rerollDie')),selectDie=element(doc,'select');
              for(const [index,choice] of choices.entries()){const option=element(doc,'option','',`d${choice.sides}: ${choice.face}`);option.value=String(index);selectDie.append(option);}wrap.append(selectDie);controls.append(wrap);
              const rerollButton=button(t('heroicReroll'),async()=>{
                if(locked||selectDie.dataset.gw5RollLocked==='true'||heroicBusy||!draft.inspiration)return;
                heroicBusy=true;syncHeroic();
                const previous=controls;previous.querySelectorAll('button,select').forEach(control=>control.disabled=true);
                pendingReroll=(async()=>{const plan=heroicReroll(expression,parsed.result,choices[numeric(selectDie.value)]),message=await api.dice.roll(plan.expression,{label:t('heroicReroll').slice(0,48),visibility:options.visibility,requestId:crypto.randomUUID()}),next=rollResult(message);next.natural=plan.natural(next.result);nativeMessage=message;parsed=next;expression=plan.expression;draft.inspiration=false;mark();await flush();})();
                try{await pendingReroll;}catch(error){previous.querySelectorAll('button,select').forEach(control=>control.disabled=false);throw error;}finally{pendingReroll=undefined;heroicBusy=false;syncHeroic();}
                if(stateful)await finish();else if(actionId.includes('attack'))lastAttacks.set(item?.id,rollOutcome(actionId,parsed,options));
                previous.replaceChildren(element(doc,'span','gw5-chat-replaced',t('rollReplaced')));show();
              });rerollButton.dataset.heroicReroll='';heroicControls.add(rerollButton);heroicControls.add(selectDie);controls.append(rerollButton);
              if(stateful){const keep=button(t('keepRoll'),async()=>{await finish();show();});keep.dataset.keepRoll='';controls.append(keep);}
            }
          }
          if(kind&&!item?.data?.formulaProfile?.manual)automation.applyResult(controls,{kind,total:parsed.total,damageType:item?.data?.damage_type,critical:options.critical,beforeApply:async()=>{locked=true;await finish();controls.querySelectorAll('select,[data-heroic-reroll]').forEach(control=>{control.disabled=true;control.dataset.gw5RollLocked='true';});}});
          if(controls.childElementCount)system.chatRolls.add(nativeMessage.id,controls,signal);
        };
        deferFinish=!!(stateful&&edition==='2024'&&draft.inspiration&&heroicDice(parsed.result).length);
        if(deferFinish)pendingResolutions.add(finish);else await finish();
        show();d.close();
      }catch(e){message.textContent=t(e.code&&api.i18n.has(e.code)?e.code:'rollError');}finally{submit.disabled=false;}
      })();submitting=task;work.add(task);
      void task.finally(()=>{work.delete(task);submitting=undefined;});
    };
  }
  function resource(node,owner=draft,callback=changed) {
    const box=element(doc,'div','gw5-resource');
    if(node.valuePath!=='sheet.hp.value'){
      box.append(element(doc,'strong','',t(node.labelKey)),field({type:'numberField',path:node.valuePath,labelKey:'current'},owner,callback),element(doc,'span','','/'),field({type:'numberField',path:node.maxPath,labelKey:'maximum'},owner,callback));return box;
    }
    box.classList.add('gw5-resource--hp');
    const main=element(doc,'div','gw5-hp-main'),heading=element(doc,'strong','gw5-hp-heading',t(node.labelKey));heading.prepend(icon(doc,'heart'));main.append(heading);
    const values=element(doc,'div','gw5-hp-values');
    for(const [path,label] of [['sheet.hp.value','current'],['sheet.hp.max','maximum']]){
      if(path==='sheet.hp.max')values.append(element(doc,'span','gw5-hp-slash','/'));
      const value=field({type:'numberField',path,labelKey:label});value.classList.add('gw5-value-field');values.append(value);
    }
    const meter=element(doc,'progress','gw5-hp-meter');meter.max=Math.max(1,numeric(draft.bars?.bar_1?.max));meter.value=Math.max(0,numeric(draft.bars?.bar_1?.value));meter.setAttribute('aria-label',t(node.labelKey));main.append(values,meter);
    const side=element(doc,'div','gw5-hp-side');
    for(const [path,label,glyph,kind] of [['sheet.hp.temp','temporary','shield','numberField']]){
      const value=field({type:kind,path,labelKey:label});value.prepend(icon(doc,glyph));side.append(value);
    }
    if(type!=='monster'){
      const pools=hitDicePools(draft),available=pools.reduce((sum,pool)=>sum+pool.value,0),maximum=pools.reduce((sum,pool)=>sum+pool.max,0);
      const configure=button(`${available} / ${maximum}${pools.length===1?' '+pools[0].die:''}`,()=>automation.hitDiceSettings(),!view.canEdit);
      configure.classList.add('gw5-hit-dice-config');configure.title=t('configureHitDice');configure.setAttribute('aria-label',t('configureHitDice'));configure.prepend(icon(doc,'dice'));
      side.append(element(doc,'span','gw5-hit-dice-label',t('hitDice')),configure);
    }
    const tools=element(doc,'div','gw5-damage-tools'),amount=element(doc,'input');amount.type='number';amount.min='0';amount.max='1000000';amount.value='1';amount.setAttribute('aria-label',t('amount'));amount.disabled=!view.canEdit;tools.append(amount);
    const damageOptions=element(doc,'details','gw5-damage-options');damageOptions.append(element(doc,'summary','',t('damageType')));const damageContext=automation.damageControls(damageOptions);
    tools.append(button(t('damage'),()=>{damage(draft,amount.value,damageContext.options());draft=derive(draft,type,schema,edition);mark();render();},!view.canEdit),button(t('heal'),()=>{heal(draft,amount.value);draft=derive(draft,type,schema,edition);mark();render();},!view.canEdit));
    box.append(main,side,tools,damageOptions,automation.health());return box;
  }
  async function editEmbedded(entry,commit,onClose=render) {
    const d=managedModal(entry.name),form=element(doc,'form','gw5-modal-body');d.classList.add('gw5-embedded-editor');d.append(form);
    let copy=defaults(system.schemas.item,entry.data),copyName=entry.name;
    if(entry.data?.trained===undefined)delete copy.trained;
    if(entry.type==='effect'&&!copy.duration)copy.duration={type:'permanent',value:0};
    const embeddedChanged=(path,value)=>{if(!view.canEdit)return;if(path==='core.name')copyName=String(value);else {set(copy,path,value);if(['sheet.damage','sheet.healingFormula'].includes(path))delete copy.formulaProfile;if(path.startsWith('sheet.duration.')&&copy.duration)delete copy.duration.remaining;}commit({...entry,...(path.startsWith('sheet.duration.')?{duration:undefined}:{}),name:copyName,data:structuredClone(copy)},path,value);};
    const embeddedLayout=system.layouts[`items/${entry.type}`];
    if(embeddedLayout){const editor=itemEditor({doc,t,layout:embeddedLayout,type:entry.type,field,button,modifiers,resource:node=>resource(node,copy,embeddedChanged),changed:embeddedChanged,data:()=>copy,name:()=>copyName,edition:()=>copy.rulesEdition||edition});editor.classList.add('gw5-sheet');form.append(editor);}else form.append(field({type:'textArea',path:'sheet.description',labelKey:'description'},copy,embeddedChanged));
    const footer=element(doc,'footer','gw5-footer');footer.append(saveIndicator(),button(t('done'),async()=>{await flush();d.close();}));form.append(footer);
    d.addEventListener('close',()=>onClose(),{once:true});
    form.onsubmit=event=>event.preventDefault();
  }
  function collection(node) {
    const div=element(doc,'div','gw5-list'), entries=get(draft,node.path,[]);
    const latest=()=>get(draft,node.path,[]);
    const updateEntry=(id,change)=>{const list=structuredClone(latest()),index=list.findIndex(item=>item.id===id);if(index<0)return;change(list[index]);changed(node.path,list);};
    const weapons=['sheet.weapons','sheet.attacks'].includes(node.path);
    if(weapons){
      div.classList.add('gw5-weapons');const heading=element(doc,'div','gw5-collection-head');
      for(const key of ['weapon','attackBonus','damage','range','actions'])heading.append(element(doc,'span','',t(key)));div.append(heading);
    }
    const canEdit=view.canEdit && (node.path!=='sheet.effects'||context.role==='gm');
    if(!entries.length)div.append(element(doc,'p','gw5-empty',t(node.emptyTextKey||'empty')));
    for(const [index,entry] of entries.entries()) {
      const row=element(doc,'article','gw5-item'),title=element(doc,'strong','',entry.name);row.dataset.entryId=entry.id;row.append(title);
      if(weapons){row.classList.add('gw5-weapon-row');title.prepend(icon(doc,'swords'));}
      if(entry.data?.description)title.title=entry.data.description;
      const controls=element(doc,'div','gw5-row gw5-item-actions');
      if(node.path==='sheet.spells'){
        const prep=element(doc,'label','gw5-checkbox',t('prepared')),input=element(doc,'input');input.type='checkbox';input.checked=!!entry.prepared;input.disabled=!view.canEdit;
        input.onchange=()=>updateEntry(entry.id,item=>item.prepared=input.checked);prep.append(input);row.append(prep);
      }
      if(weapons){const bonus=weaponBonuses(draft,entry),attack=element(doc,'span','gw5-item-detail',signed(bonus.attackBonus)),dmg=element(doc,'span','gw5-item-detail',(entry.data?.damage||'—')+(bonus.damageBonus?' '+signed(bonus.damageBonus):''));attack.dataset.gw5WeaponStat='attack';dmg.dataset.gw5WeaponStat='damage';attack.dataset.entryId=dmg.dataset.entryId=entry.id;row.append(attack,dmg,element(doc,'span','gw5-item-detail gw5-weapon-range',entry.data?.range||'—'));}
      else for(const column of (node.columns||[]).slice(1)) {if(node.path==='sheet.features'&&column.path==='type')continue;const value=get(entry,column.path,'');if(value!=='')row.append(element(doc,'span','gw5-item-detail',`${t(column.labelKey)}: ${value}`));}
      for(const action of node.row?.actions||[]) {
        if(action.type==='removeAction')controls.append(iconButton(t(action.labelKey),'trash',()=>removeEntry(node.path,entry.id),!canEdit));
        else if(action.type==='itemAction')controls.append(iconButton(t(action.labelKey),action.action.includes('damage')?'dice':'target',()=>roll(action.action,entry),!view.canEdit));
      }
      controls.prepend(iconButton(t('edit'),'pencil',()=>editEmbedded(latest().find(item=>item.id===entry.id),(updated,path,value)=>updateEntry(entry.id,item=>{if(path==='core.name')item.name=String(value);else {item.data=structuredClone(updated.data);if(path.startsWith('sheet.duration.'))delete item.duration;}})),!canEdit));
      if(node.path==='sheet.effects'&&context.tokenId)controls.append(button(t('applyCondition'),async()=>{
        await flush();await api.tokens.addCondition({sceneId:context.sceneId,tokenIds:[context.tokenId],label:entry.name,description:entry.data?.description||'',kind:entry.data?.category==='buff'?'positive':'negative',visibility:'everyone'});
      },!canEdit));
      row.append(controls);div.append(row);
      if(!weapons&&typeof entry.data?.description==='string'&&entry.data.description){const description=element(doc,'p','gw5-item-description',entry.data.description.slice(0,180));row.append(description);}
    }
    return div;
  }
  function modifiers(node,owner=()=>draft,callback=changed) {
    const box=element(doc,'div','gw5-list');let rows=get(owner(),node.path,[]);if(!Array.isArray(rows))rows=[];
    const targets=(node.targets||[]).filter(x=>x.id!=='damage.self');
    rows.forEach((entry,index)=>{
      const row=element(doc,'div','gw5-row');
      const operations=targets.find(x=>x.id===entry.target)?.operations||targets[0]?.operations||[];
      for(const [key,choices] of [['target',targets.map(x=>[x.id,t(x.labelKey)])],['operation',operations.map(x=>[x.id,t(x.labelKey)])]]){
        const input=element(doc,'select');input.setAttribute('aria-label',t(key==='target'?'modifierTarget':'modifierOperation'));for(const [value,label] of choices){const option=element(doc,'option','',label);option.value=value;input.append(option);}input.value=entry[key]||choices[0]?.[0];input.disabled=!view.canEdit;input.onchange=()=>{entry[key]=input.value;if(key==='target'){entry.operation=targets.find(x=>x.id===entry.target)?.operations[0]?.id||'add';}callback(node.path,structuredClone(rows));if(key==='target')box.replaceChildren(...modifiers(node,owner,callback).childNodes);};row.append(input);
      }
      const value=element(doc,'input');value.setAttribute('aria-label',t('modifierValue'));value.value=entry.value??0;value.maxLength=100;value.disabled=!view.canEdit;value.oninput=()=>{entry.value=value.value;callback(node.path,structuredClone(rows));};row.append(value,button(t('remove'),()=>{rows.splice(index,1);callback(node.path,structuredClone(rows));box.replaceChildren(...modifiers(node,owner,callback).childNodes);},!view.canEdit));box.append(row);
    });
    box.append(button(t('add'),()=>{rows.push({target:node.targets?.[0]?.id||'roll.attack',operation:'add',value:0});callback(node.path,structuredClone(rows));box.replaceChildren(...modifiers(node,owner,callback).childNodes);},!view.canEdit));return box;
  }
  function node(n) {
    if(['textField','numberField','textArea','selectField','checkboxField','readonlyField'].includes(n.type))return field(n);
    if(n.type==='resourceBox'||n.type==='resourceField')return resource(n);
    if(n.type==='itemList')return collection(n);
    if(n.type==='modifierBuilder')return modifiers(n);
    if(n.type==='checkboxTrack')return field({...n,type:'numberField'});
    if(n.type==='dropZone')return element(doc,'p','gw5-empty',t('effectsHint'));
    if(n.type==='abilityCard'){
      const ability=n.scorePath.split('.')[2],proficient=get(draft,`saves.${ability}.prof`,false);
      const box=element(doc,'div','gw5-ability'),out=element(doc,'output','gw5-mod',signed(get(draft,`${proficient?'saves':'abilities'}.${ability}.mod`,0)));out.dataset.gw5AbilityBonus=ability;out.title=t(proficient?'dnd5e.ui.salvaguarda':'abilityCheck');
      const heading=element(doc,'div','gw5-ability-heading'),label=button(t(n.abbrKey),()=>roll(get(draft,`saves.${ability}.prof`,false)?`roll.save.${ability}`:n.interaction.action,null,ability),!view.canEdit);label.setAttribute('aria-label',t(n.labelKey));label.title=t(n.labelKey);
      const proficiency=field({type:'checkboxField',path:`sheet.saves.${ability}.prof`,labelKey:'proficient'}),saveLabel=t('saveProficiency',{ability:t(n.labelKey)});proficiency.classList.add('gw5-save-prof');proficiency.title=saveLabel;proficiency.querySelector('input').setAttribute('aria-label',saveLabel);proficiency.querySelector('input').title=saveLabel;
      heading.append(proficiency,label);const score=field({type:'numberField',path:n.scorePath,labelKey:n.abbrKey}),effective=element(doc,'output','gw5-effective-score',String(get(draft,`abilities.${ability}.effectiveScore`,get(draft,n.scorePath))));effective.dataset.gw5Computed=`abilities.${ability}.effectiveScore`;effective.dataset.gw5EffectiveAbility=ability;effective.hidden=get(draft,n.scorePath)===get(draft,`abilities.${ability}.effectiveScore`,get(draft,n.scorePath));effective.title=t('effectiveAbility');score.classList.toggle('gw5-ability-base',!effective.hidden);score.append(effective);box.append(heading,out,score);return box;
    }
    if(n.type==='rollableStat') {
      const row=element(doc,'div','gw5-skill');
      for(const [path,label] of [[n.profPath,'proficient'],[n.expertPath,'expert']])if(path){const proficiency=field({type:'checkboxField',path,labelKey:label});if(label==='expert')proficiency.classList.add('gw5-expertise');row.append(proficiency);}
      row.append(button(t(n.labelKey),()=>roll(n.interaction?.action||n.rollAction),!view.canEdit));
      const skill=n.modPath?.match(/^sheet\.skills\.([^.]+)\.mod$/)?.[1];
      const ability=SKILLS[skill];
      if(ability){const labels={str:'for',dex:'des',con:'con',int:'int',wis:'sab',cha:'car'};row.append(element(doc,'span','gw5-skill-ability',t(`dnd5e.abbr.${labels[ability]}`)));}
      if(n.modPath){const out=element(doc,'output','',signed(get(draft,n.modPath,0)));out.dataset.gw5Computed=n.modPath;out.dataset.gw5Signed='true';row.append(out);}return row;
    }
    if(n.type==='combatStat') {
      const box=element(doc,'div','gw5-stat');
      box.dataset.gw5Stat=n.valuePath;
      const glyph={'sheet.ac':'shield','sheet.init':'swords','sheet.speed':'boot','sheet.prof':'star','sheet.spell.dc':'sun','sheet.spell.attack':'target'}[n.valuePath];if(glyph)box.append(icon(doc,glyph));
      if(n.interaction)box.append(button(t(n.labelKey),()=>roll(n.interaction.action),!view.canEdit));
      const automaticAC=n.valuePath==='sheet.ac'&&draft.acMode==='equipment';
      const automaticSpeed=type==='character'&&n.valuePath==='sheet.speed';
      const readonly=automaticAC||automaticSpeed||['sheet.init','sheet.prof','sheet.spell.dc','sheet.spell.attack'].includes(n.valuePath);
      const value=field({path:automaticAC?'sheet.effective_ac':automaticSpeed?'sheet.effectiveMovement.walk':n.valuePath,labelKey:n.labelKey,type:readonly?'readonlyField':n.kind==='text'?'textField':'numberField'});
      if(n.interaction)value.classList.add('gw5-field--stat-action');
      if(['sheet.init','sheet.prof','sheet.spell.attack'].includes(n.valuePath)){
        const out=value.querySelector('output');out.dataset.gw5Signed='true';out.textContent=signed(get(draft,n.valuePath,0));
      }
      box.append(value);
      if(n.valuePath==='sheet.ac'&&!automaticAC){const out=element(doc,'output','',String(draft.effective_ac));out.dataset.gw5Computed='effective_ac';out.dataset.gw5EffectiveAcExtra='true';out.title=t('effectiveAC');out.setAttribute('aria-label',t('effectiveAC'));out.hidden=draft.effective_ac===draft.ac;box.append(out);}return box;
    }
    const box=element(doc,'section',n.type==='row'||n.type==='grid'?'gw5-row':`gw5-section gw5-${n.variant||'section'}`);
    if(n.labelKey)box.append(element(doc,'h3','',t(n.labelKey)));
    for(const child of n.children||[])box.append(node(child));
    return box;
  }
  function header() {
    const h=element(doc,'header','gw5-header');
    if(view.portraitUrl||view.tokenUrl){const image=element(doc,'img','gw5-portrait');image.src=view.portraitUrl||view.tokenUrl;image.alt='';image.style.objectPosition=portraitPosition();h.append(image);h.classList.add('gw5-header--portrait');}
    const identity=element(doc,'div','gw5-identity'),nameField=field({type:'textField',path:'core.name',labelKey:'name'});nameField.classList.add('gw5-name');identity.append(nameField);
    const details=element(doc,'div','gw5-identity-line');
    const parts=type==='monster'?[sizeLabel(draft.size),draft.type,draft.alignment,draft.cr?`${t('cr')} ${draft.cr}`:'']:[draft.class,`${t('level')} ${draft.level}`,draft.race,draft.background];
    for(const part of parts.filter(value=>typeof value==='string'&&value.trim()))details.append(element(doc,'span','',part));
    identity.append(details);
    const personality=get(draft,'sheet.traits.personality','');
    if(typeof personality==='string'&&personality.trim())identity.append(element(doc,'p','gw5-header-quote',personality.split('\n')[0].slice(0,140)));
    const editIdentity=iconButton(t('editIdentity'),'pencil',()=>{
      const modal=managedModal(t('editIdentity')),body=element(doc,'div','gw5-modal-body');modal.append(body);
      for(const [path,label,kind] of type==='monster'?[['sheet.size','size','selectField'],['sheet.type','creatureType','textField'],['sheet.alignment','alignment','textField'],['sheet.cr','cr','textField'],['sheet.prof','proficiency','numberField']]:[['sheet.class','class','textField'],['sheet.level','level','numberField'],['sheet.race',edition==='2024'?'species':'race','textField'],['sheet.background','background','textField'],['sheet.alignment','alignment','textField'],['sheet.traits.personality','personality','textArea']])body.append(field({path,labelKey:label,type:kind,...(path==='sheet.size'?{options:Object.entries(SIZE_KEYS).map(([value,labelKey])=>({value,labelKey}))}:{})}));
      const settings=button(t('settings'),openRules);settings.prepend(icon(doc,'settings'));settings.dataset.gw5Options='rules';
      body.append(settings,saveIndicator(),button(t('done'),async()=>{await flush();modal.close();}));modal.addEventListener('close',()=>render(),{once:true});
    },!view.canEdit);editIdentity.classList.add('gw5-identity-edit');h.append(identity,editIdentity);return h;
  }
  function openRules(){
    const modal=managedModal(t('settings')),body=element(doc,'div','gw5-modal-body');modal.append(body);
    body.append(field({path:'sheet.rulesEdition',type:'selectField',labelKey:'documentEdition',options:[{value:'2014',labelKey:'edition2014'},{value:'2024',labelKey:'edition2024'}]}),field({path:'sheet.exhaustion',type:'numberField',labelKey:'exhaustion'}));
    const inspiration=field({path:'sheet.inspiration',type:'checkboxField',labelKey:edition==='2024'?'heroicInspiration':'inspiration'});inspiration.title=t(edition==='2024'?'heroicInspirationHelp':'inspirationHelp');body.append(inspiration);
    const speed=element(doc,'p','gw5-speed',`${t('speed')}: ${effectiveSpeed(draft,edition)}`);
    body.querySelector('select').addEventListener('change',()=>{const label=t(edition==='2024'?'heroicInspiration':'inspiration');inspiration.firstChild.nodeValue=label;inspiration.querySelector('input').setAttribute('aria-label',label);inspiration.title=t(edition==='2024'?'heroicInspirationHelp':'inspirationHelp');},{signal});
    for(const event of ['input','change'])body.addEventListener(event,()=>{speed.textContent=`${t('speed')}: ${effectiveSpeed(draft,edition)}`;},{signal});
    body.append(speed);
    automation.settings(body);
    body.append(saveIndicator(),button(t('done'),async()=>{await flush();modal.close();}));modal.addEventListener('close',()=>render(),{once:true});
  }
  function slotSummary(){
    const box=element(doc,'div','gw5-slots-summary');box.append(element(doc,'span','gw5-slots-title',t('dnd5e.ui.espacos.de.magia')));
    let visible=0;
    for(let level=1;level<=9;level++){
      const value=numeric(get(draft,`sheet.slots.l${level}.value`,0)),max=Math.max(0,Math.trunc(numeric(get(draft,`sheet.slots.l${level}.max`,0))));if(!max)continue;
      visible++;const row=element(doc,'div','gw5-slot-line');row.append(element(doc,'span','',`${t('level')} ${level}`));
      const pips=element(doc,'div','gw5-slot-pips');pips.setAttribute('role','group');pips.setAttribute('aria-label',`${t('dnd5e.ui.espacos.de.magia')} · ${t('level')} ${level}`);
      for(let index=0;index<Math.min(max,10);index++){
        const target=index<value?index:index+1,b=button('',()=>{changed(`sheet.slots.l${level}.value`,target);render();},!view.canEdit);
        b.setAttribute('aria-label',t('setSlots',{level,count:target}));b.setAttribute('aria-pressed',String(index<value));pips.append(b);
      }
      row.append(pips,element(doc,'span','gw5-slot-count',`${value} / ${max}`));box.append(row);
    }
    if(!visible)box.append(element(doc,'p','gw5-empty',t('noSlots')));
    box.append(button(t('manageSpells'),async()=>{await flush();tab='spells';render();}));return box;
  }
  function tokenOptions() {
    const details=element(doc,'details','gw5-section gw5-token-options');details.append(element(doc,'summary','',t('tokenOptions')));
    const fields=element(doc,'div','gw5-row');
    for(const [path,label] of [['token.display.name','showName'],['token.display.bar_1','showBar1'],['token.display.bar_2','showBar2']])fields.append(field({type:'checkboxField',path,labelKey:label}));
    const size=field({type:'numberField',path:'token.size',labelKey:'tokenSize'});size.querySelector('input').min='1';size.querySelector('input').max='100';size.querySelector('input').disabled=!view.canEdit||context.role!=='gm';fields.append(size);
    details.append(fields);
    for(const kind of ['portrait','token']) {
      const wrap=element(doc,'label','gw5-field',t(kind==='portrait'?'uploadPortrait':'uploadToken')),input=element(doc,'input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.disabled=!view.canEdit;wrap.append(input);details.append(wrap);
      input.onchange=()=>{
        if(uploading){input.value='';return;}
        const file=input.files?.[0];if(!file)return;
        if(file.size>10000000){error(Error('Too large'));return;}
        uploadPromise=(async()=>{
        const controls=[...shell.querySelectorAll('button,input,select,textarea'),...details.querySelectorAll('button,input,select,textarea')].map(control=>[control,control.disabled]);
        uploading=true;for(const [control] of controls)control.disabled=true;
        try {
          await flush();await block.host.call('actor.image.upload',{id:context.actorId,kind,file});
          view=await api.actors.sheet(context.actorId,context.tokenId?{tokenId:context.tokenId}:{});
          if(!signal.aborted){draft=derive(view.data,type,schema,edition);name=view.name;}
        }catch(e){error(e);throw e;}finally{uploading=false;for(const [control,disabled] of controls)if(control.isConnected)control.disabled=disabled||!view.canEdit;render();if(details.isConnected&&(view.portraitUrl||view.tokenUrl)){details.querySelector('.gw5-portrait-framing')?.remove();details.append(portraitFraming());}}
        })().finally(()=>{uploadPromise=undefined;});
        uploadPromise.catch(()=>{});
      };
    }
    if(view.portraitUrl||view.tokenUrl)details.append(portraitFraming());
    return details;
  }
  function portraitFraming(){
    const box=element(doc,'section','gw5-portrait-framing');box.append(element(doc,'h3','',t('portraitFraming')));
    const frame=element(doc,'div','gw5-portrait-preview'),image=element(doc,'img','gw5-portrait-preview-image');image.src=view.portraitUrl||view.tokenUrl;image.alt='';image.style.objectPosition=portraitPosition();frame.append(image);
    const original=shell.querySelector('.gw5-portrait')?.getBoundingClientRect();frame.style.aspectRatio=original?.width&&original.height?String(original.width/original.height):'8 / 3';
    box.append(frame,element(doc,'p','gw5-empty',t('portraitFocusHint')));
    const sliders=[];
    for(const [index,axis] of ['x','y'].entries()){
      const path=`sheet.portraitFocus.${axis}`,label=t(axis==='x'?'portraitPositionX':'portraitPositionY'),wrap=element(doc,'label','gw5-focus-control',label),input=element(doc,'input'),value=element(doc,'output');
      input.type='range';input.min='0';input.max='100';input.step='1';input.value=String(portraitFocus()[index]);input.dataset.gw5Path=path;input.setAttribute('aria-label',label);input.disabled=!view.canEdit;value.textContent=`${input.value}%`;wrap.append(input,value);box.append(wrap);sliders.push([input,value]);
      input.addEventListener('input',()=>{changed(path,Number(input.value));image.style.objectPosition=portraitPosition();value.textContent=`${input.value}%`;},{signal});
    }
    box.append(button(t('portraitReset'),()=>{changed('sheet.portraitFocus.x',50);changed('sheet.portraitFocus.y',0);for(const [index,[input,value]] of sliders.entries()){input.value=String(portraitFocus()[index]);value.textContent=`${input.value}%`;}image.style.objectPosition=portraitPosition();},!view.canEdit));
    return box;
  }
  function render() {
    if(signal.aborted)return;
    shell.replaceChildren();shell.append(notice);
    if(!isItem)shell.append(header());
    if(layout.body.tabs){
      const navline=element(doc,'div','gw5-navline'),nav=element(doc,'nav','gw5-tabs');nav.setAttribute('aria-label',t('sheetTabs'));
      for(const entry of layout.body.tabs){const b=button(t(entry.labelKey),async()=>{await flush();tab=entry.id;render();});b.setAttribute('aria-current',String(tab===entry.id));b.dataset.gw5Tab=entry.id;nav.append(b);}
      navline.append(nav);
      if(!isItem){
        const actions=element(doc,'div','gw5-nav-actions');
        const token=button(t('token'),()=>{});token.prepend(icon(doc,'token'));token.dataset.gw5Options='token';
        token.onclick=()=>{const modal=managedModal(t('tokenOptions')),body=element(doc,'div','gw5-modal-body');modal.append(body);const options=tokenOptions();options.open=true;body.append(options,saveIndicator());};
        actions.append(token);
        for(const kind of ['short','long']){
          const rest=button(t(kind==='short'?'shortRest':'longRest'),async()=>{
            await refreshEdition();await flush();
            const prior=actionSource;try{actionSource=rest;automation.rest(kind);}finally{actionSource=prior;}
          },!view.canEdit);
          rest.prepend(icon(doc,kind==='short'?'sun':'moon'));rest.classList.add('gw5-rest-action');rest.dataset.gw5Rest=kind;actions.append(rest);
        }
        navline.append(actions);
      }
      shell.append(navline);const content=element(doc,'div','gw5-body');content.dataset.gw5Panel=tab;
      const entries=layout.body.tabs.find(x=>x.id===tab).children;
      if(tab==='main' && type==='character'){
        const skills=node(entries.find(n=>n.variant==='skills'));
        const tableHead=element(doc,'div','gw5-skill-head');tableHead.append(element(doc,'span','gw5-skill-head-name',t('skill')),element(doc,'span','gw5-skill-head-ability',t('ability')),element(doc,'span','gw5-skill-head-bonus',t('bonus')));skills.querySelector('h3').after(tableHead);const flourish=icon(doc,'leaf');flourish.classList.add('gw5-skills-flourish');skills.append(flourish);content.append(skills);
        const play=element(doc,'div','gw5-play');play.append(node(entries.find(n=>n.variant==='abilities')));
        const combat=element(doc,'section','gw5-section gw5-combat'),combatContent=element(doc,'div','gw5-combat-content'),stats=element(doc,'div','gw5-combat-stats');
        combat.append(element(doc,'h3','',t('combatResources')));
        for(const n of [{type:'combatStat',valuePath:'sheet.ac',labelKey:'armorClass'},{type:'combatStat',valuePath:'sheet.init',labelKey:'initiative',interaction:{action:'roll.initiative'}},{type:'combatStat',valuePath:'sheet.speed',labelKey:'movement'},{type:'combatStat',valuePath:'sheet.prof',labelKey:'proficiencyShort'}])stats.append(node(n));
        combatContent.append(stats);combat.append(combatContent);play.append(combat);
        const middle=element(doc,'div','gw5-middle'),health=element(doc,'section','gw5-section gw5-health');health.append(element(doc,'h3','',t('dnd5e.ui.pontos.de.vida')),resource({valuePath:'sheet.hp.value',maxPath:'sheet.hp.max',labelKey:'dnd5e.ui.pontos.de.vida'}));
        const magic=element(doc,'section','gw5-section gw5-magic');magic.append(element(doc,'h3','',t('dnd5e.ui.magias')));
        const magicContent=element(doc,'div','gw5-magic-content'),summary=element(doc,'div','gw5-magic-stats');
        summary.append(node({type:'combatStat',valuePath:'sheet.spell.dc',labelKey:'dnd5e.ui.cd.de.magia'}),node({type:'combatStat',valuePath:'sheet.spell.attack',labelKey:'spellAttack',interaction:{action:'roll.spell_attack'}}));
        magicContent.append(summary,slotSummary());magic.append(magicContent);middle.append(health,magic);play.append(middle);
        play.append(node(entries.find(n=>n.variant==='attacks')));
        const bottom=element(doc,'div','gw5-bottom');bottom.append(node(entries.find(n=>n.variant==='traits')));
        const notes=element(doc,'section','gw5-section gw5-quick-notes');notes.append(element(doc,'h3','',t('quickNotes')),field({type:'textArea',path:'sheet.notes',labelKey:'quickNotes'}));bottom.append(notes);play.append(bottom);
        const additional=element(doc,'details','gw5-additional');additional.append(element(doc,'summary','',t('moreResources')));
        for(const variant of ['vitals','equipment'])additional.append(node(entries.find(n=>n.variant===variant)));play.append(additional);content.append(play);
      }else if(tab==='main'&&type==='monster'){content.classList.add('gw5-monster-body');content.append(renderMonster({doc,t,node,field,button,iconButton,resource,layout,draft:()=>draft,view:()=>view,edition:()=>edition,roll,changed,flush,openModal:managedModal,saveIndicator,onUpdate:render,sizeLabel}));}
      else content.append(...renderTab(tab,entries));
      shell.append(content);
    }else {draft.rulesEdition??=edition;shell.append(itemEditor({doc,t,layout,type,field,button,modifiers,resource,changed,data:()=>draft,name:()=>name,edition:()=>draft.rulesEdition||edition,state:itemState}));}
    const footer=element(doc,'footer','gw5-footer');for(const indicator of indicators)if(!indicator.isConnected)indicators.delete(indicator);retry=button(t('retrySave'),flush,!view.canEdit);retry.classList.add('gw5-save-retry');footer.append(element(doc,'small','','DnD 5e SRD · 0.1.0'),saveIndicator(),retry);status();shell.append(footer);
  }
  const automation=createAutomationUI({doc,t,field,button,api,context,modal:managedModal,data:()=>draft,edition:()=>edition,canEdit:()=>view.canEdit,changed,roll,commit:async next=>{draft=derive(next===undefined?draft:structuredClone(next),type,schema,edition);mark();await flush();render();}});
  function advancementParent(id){return Object.values(draft.advancementLedger?.parents||{}).find(parent=>parent.owned?.[0]===id);}
  async function removeEntry(path,id){
    if(!view.canEdit)return;
    const parent=advancementParent(id);
    if(parent){const catalog=await system.catalog({draft,item:parent.item,operation:'remove'});if(signal.aborted)return;draft=derive(removeAdvancement(draft,parent.id,catalog).data,type,schema,edition);mark();}
    else changed(path,get(draft,path,[]).filter(item=>item.id!==id));
    render();
  }
  function advanceClass(id){
    const parent=advancementParent(id);if(!view.canEdit||parent?.type!=='class')return;
    // The choice modal owns a private draft; do not put its lifetime in the modal save queue.
    void (async()=>{
      const catalog=await system.catalog({draft,item:parent.item,operation:'sync'}),plan=await chooseAdvancement({doc,t,modal:managedModal,draft:structuredClone(draft),item:parent.item,catalog,signal,options:{classLevel:parent.classLevel,type,edition,update:true,onOpen:registerAdvancement},planner:(data,item,catalog,answers,options)=>syncAdvancementLevel(data,parent.id,options.classLevel,catalog,answers)});
      if(!plan||signal.aborted)return;draft=derive(plan.data,type,schema,edition);mark();render();
    })().catch(error);
  }
  const renderTab=createTabs({doc,t,field,node,button,iconButton,signal,api,context,roll,cast:automation.cast,editEmbedded,flush,changed,error,dropError,removeEntry,advanceClass,advancementParent,openModal:managedModal,layout,itemLayouts:system.layouts,draft:()=>draft,view:()=>view,edition:()=>edition});
  if(!isItem){
    const destination=item=>itemDestination(layout,item,{edition,role:context.role,canEdit:view.canEdit});
    const surface=root.closest('.gw-window')||root;
    surface.addEventListener('dragover',event=>{
      if(!view.canEdit||!acceptsItemDrop(event.dataTransfer,context))return;
      event.preventDefault();event.dataTransfer.dropEffect='copy';
    },{signal});
    surface.addEventListener('drop',event=>{
      if(!view.canEdit||!acceptsItemDrop(event.dataTransfer,context))return;
      event.preventDefault();event.stopPropagation();
      // Read the payload while the browser's drag data store is still available.
      const payloads=new Map([...event.dataTransfer.types].map(type=>[type,event.dataTransfer.getData(type)]));
      const transfer={types:[...payloads.keys()],getData:type=>payloads.get(type)};
      dropQueue=dropQueue.then(async()=>{
        if(signal.aborted)return;
        await refreshEdition();
        if(signal.aborted)return;
        const item=await droppedItem(transfer,{api,context,accepts:item=>!signal.aborted&&!!destination(item),t});
        if(signal.aborted)return;
        const target=destination(item);
        if(!target||!item.canOpen)throw Object.assign(Error(t('itemDropUnsupported')),{code:'unsupported_item'});
        let entry;
        if(type==='character'&&(['race','background','class'].includes(item.type)||item.data?.advancement?.length)){
          notice.textContent=t('advancementLoading');notice.hidden=false;
          const catalog=await system.catalog({draft,item,operation:'drop'}),plan=await chooseAdvancement({doc,t,modal:managedModal,draft:structuredClone(draft),item,catalog,options:{type,edition,role:context.role,onOpen:registerAdvancement},signal});
          notice.hidden=true;
          if(!plan||signal.aborted)return;
          draft=derive(plan.data,type,schema,edition);mark();const parent=draft.advancementLedger?.parents?.[plan.parentId];entry=['features','spells','weapons','inventory','equipment','effects'].flatMap(key=>draft[key]||[]).find(entry=>entry.id===parent?.owned?.[0]);
          if(plan.warnings?.length){notice.textContent=t('advancementManualNotice');notice.hidden=false;}
        }else {entry=ownedItem(item,draft);changed(target.path,[...get(draft,target.path,[]),entry]);}
        tab=target.tab;renderTab.revealItem?.(target.path);render();
        const row=entry&&shell.querySelector(`[data-entry-id="${entry.id}"]`);
        row?.classList.add('gw5-item--added');row?.scrollIntoView({block:'nearest'});
        setTimeout(()=>row?.classList.remove('gw5-item--added'),1600);
      }).catch(dropError);
    },{signal});
  }
  render();
  const unsubscribe=api.i18n.onChange(()=>render());signal.addEventListener('abort',unsubscribe,{once:true});
  const changedEdition=()=>void refreshEdition().catch(error);system.listeners.add(changedEdition);signal.addEventListener('abort',()=>system.listeners.delete(changedEdition),{once:true});
  if(!isItem)api.events.on('actors.changed',async()=>{
    if(pending||uploading||editing||changes!==saved)return;
    try {const current=await api.actors.sheet(context.actorId,context.tokenId?{tokenId:context.tokenId}:{});if(signal.aborted||pending||uploading||editing||changes!==saved)return;if(current.sheetVersion!==view.sheetVersion||current.version!==view.version){view=current;draft=derive(view.data,type,schema,edition);name=view.name;render();}}catch(e){error(e);}
  });
}
