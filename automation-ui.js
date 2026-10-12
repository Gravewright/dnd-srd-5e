import {numeric,damage,heal,grantTemporaryHP,stabilize,endConcentration,hitDicePools,restEligibility,spendHitDie,finishShortRest,longRest,spellCast} from './rules.js';
import {rollResult} from './automation.js';

export const CONDITION_IDS=['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','surprised'];
const create=(doc,tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const DAMAGE_TYPES=['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];

// All actions use the existing document save queue and shared movable modal.
export function createAutomationUI(env) {
  const {doc,t,field,button,api,context,modal,data,edition,commit,canEdit}=env;
  let restWindow;
  const select=(parent,label,choices,value='')=>{
    const wrap=create(doc,'label','gw5-field',t(label)),input=create(doc,'select');input.setAttribute('aria-label',t(label));
    for(const [id,key] of choices){const option=create(doc,'option','',t(key));option.value=String(id);input.append(option);}
    input.value=String(value);input.disabled=!canEdit();wrap.append(input);parent.append(wrap);return input;
  };
  const check=(parent,label)=>{const wrap=create(doc,'label','gw5-checkbox',t(label)),input=create(doc,'input');input.type='checkbox';input.disabled=!canEdit();wrap.append(input);parent.append(wrap);return input;};
  function body(title){const window=modal(t(title)),body=create(doc,'div','gw5-modal-body');window.append(body);return {window,body};}
  const failure=(parent,error)=>{parent.querySelector('.gw5-notice')?.remove();const key=typeof error?.code==='string'&&api.i18n.has(error.code)?error.code:'rollError',notice=create(doc,'p','gw5-notice',t(key));notice.role='alert';parent.append(notice);};
  const run=async(parent,action)=>{try{await action();}catch(error){failure(parent,error);}};

  function hitDiceSettings(){
    const {window,body:content}=body('configureHitDice'),pools=data().hitDicePools?.length?data().hitDicePools:[data().hitDice];
    for(const [index,pool] of pools.entries()){
      if(!pool)continue;const row=create(doc,'div','gw5-row');
      const path=data().hitDicePools?.length?`sheet.hitDicePools.${index}`:'sheet.hitDice';
      row.append(field({type:'selectField',path:path+'.die',labelKey:'hitDiceDie',options:[6,8,10,12].map(die=>({value:'d'+die,labelKey:'dieD'+die}))}),field({type:'numberField',path:path+'.value',labelKey:'available'}),field({type:'numberField',path:path+'.max',labelKey:'maximum'}));content.append(row);
    }
    content.append(button(t('addHitDicePool'),()=>{const pools=structuredClone(data().hitDicePools?.length?data().hitDicePools:[{...data().hitDice,id:'primary'}]);pools.push({id:crypto.randomUUID(),die:'d8',value:0,max:0});env.changed('sheet.hitDicePools',pools);window.close();hitDiceSettings();},!canEdit()));
    content.append(button(t('done'),async()=>{await commit();window.close();}));
  }

  function rest(kind){
    if(!canEdit()||!['short','long'].includes(kind))return;
    if(restWindow?.isConnected){restWindow.focus();return;}
    const {window,body:content}=body(kind==='long'?'longRest':'shortRest');restWindow=window;
    window.classList.add('gw5-rest-modal');window.dataset.gw5RestModal=kind;
    const original=structuredClone(data()),baseline=JSON.stringify(original),restEdition=edition();
    const staged=structuredClone(original),rolls=[];
    let busy=false,closed=false,completed=false,confirmed,operationError,foodAndDrink=true;
    let priority=hitDicePools(original)[0]?.id;
    const nativeClose=window.close.bind(window);
    // X, Escape and callers share the same guard. Forced lifetime disposal must
    // still close immediately; an unconfirmed roll only affects this draft.
    window.close=force=>force===true||!busy?nativeClose(force):false;
    window.addEventListener('close',()=>{closed=true;if(restWindow===window)restWindow=undefined;},{once:true});
    const allowed=()=>{if(!canEdit())throw Object.assign(Error('readOnly'),{code:'readOnly'});};
    const eligibility=()=>restEligibility(structuredClone(staged),restEdition,{},kind==='short');
    const finished=()=>{
      const next=structuredClone(staged);
      if(kind==='long')longRest(next,restEdition,{foodAndDrink,...(priority?{hitDiceOrder:[priority]}:{})});
      else finishShortRest(next,restEdition);
      return next;
    };
    const setBusy=value=>{
      busy=value;window.setAttribute('aria-busy',String(value));
      if(value)window.querySelectorAll('button,input,select').forEach(control=>control.disabled=true);
    };
    const slotTotal=value=>Object.values(value.slots||{}).reduce((sum,slot)=>sum+numeric(slot?.value),0)+numeric(value.pactSlots?.value);
    const resourceTotal=value=>['features','inventory','weapons','equipment','spells'].flatMap(key=>value[key]||[]).reduce((sum,item)=>sum+numeric(item.data?.uses?.value),0)+Object.values(value.resources||{}).reduce((sum,resource)=>sum+numeric(resource?.value),0);
    function draw(focusPool){
      if(closed)return;
      content.replaceChildren();window.setAttribute('aria-busy',String(busy));
      window.querySelector('.gw5-close').disabled=busy;
      content.append(create(doc,'p','gw5-empty',t(kind==='long'?'restConfirm':'shortRestHelp')));
      const note=create(doc,'p','gw5-rest-note',t(confirmed?'rest.confirmedHelp':kind==='short'?'rest.previewHelp':'rest.confirmHelp'));content.append(note);
      const pools=hitDicePools(staged);
      if(kind==='long'){
        const food=check(content,'foodAndDrink');food.dataset.gw5RestFood='';food.checked=foodAndDrink;food.disabled=!!confirmed||busy||!canEdit();
        food.onchange=()=>{foodAndDrink=food.checked;refreshPreview();};
        if(restEdition==='2014'&&pools.length>1){
          const wrap=create(doc,'label','gw5-field',t('hitDiceRecoveryPriority')),input=create(doc,'select');input.dataset.gw5RestPriority='';input.setAttribute('aria-label',t('hitDiceRecoveryPriority'));
          for(const pool of pools){const option=create(doc,'option','',`${pool.className?pool.className+' · ':''}${pool.die}: ${pool.value} / ${pool.max}`);option.value=pool.id;input.append(option);}
          input.value=priority;input.disabled=!!confirmed||busy||!canEdit();input.onchange=()=>{priority=input.value;refreshPreview();};wrap.append(input);content.append(wrap);
        }
      }else{
        const list=create(doc,'div','gw5-rest-pools');let eligible=true;
        try{eligibility();}catch{eligible=false;}
        if(!pools.length)list.append(create(doc,'p','gw5-empty',t('noHitDice')));
        for(const pool of pools){
          const row=create(doc,'div','gw5-rest-pool');row.dataset.gw5HitDiePool=pool.id;
          const identity=create(doc,'div','gw5-rest-pool-name');identity.append(create(doc,'strong','',pool.className||t('hitDice')),create(doc,'span','',`${pool.die}: ${pool.value} / ${pool.max}`));
          const spend=button(t('spendHitDie'),async()=>{
            if(busy||confirmed||completed||closed)return;
            setBusy(true);operationError=undefined;
            try{
              allowed();eligibility();
              const current=hitDicePools(staged).find(candidate=>candidate.id===pool.id);
              if(!current||current.value<1)throw Object.assign(Error('hit_die_unavailable'),{code:'hit_die_unavailable'});
              const result=await api.dice.roll(`1${current.die}`,{label:`${t('hitDice')}${current.className?' · '+current.className:''}`,requestId:crypto.randomUUID()});
              if(closed)return;allowed();
              const parsed=rollResult(result),before=numeric(staged.bars?.bar_1?.value);
              spendHitDie(staged,current.id,parsed.total,{edition:restEdition});
              rolls.push({pool:current.className||current.die,die:current.die,roll:parsed.total,healing:numeric(staged.bars?.bar_1?.value)-before});
            }catch(error){operationError=error;}
            finally{setBusy(false);draw(pool.id);}
          },!!confirmed||busy||!eligible||!canEdit()||pool.value<1);
          spend.dataset.gw5HitDie=pool.id;row.append(identity,spend);list.append(row);
        }
        content.append(list);
      }
      if(rolls.length){
        const history=create(doc,'ol','gw5-rest-rolls');
        for(const [index,roll] of rolls.entries()){const row=create(doc,'li','',`${roll.pool} · ${roll.die}: ${roll.roll} · ${t('rest.healing',{value:roll.healing})}`);row.dataset.gw5RestRoll=String(index);history.append(row);}
        content.append(history);
      }
      const preview=create(doc,'div','gw5-rest-preview');preview.dataset.gw5RestPreview='';preview.setAttribute('role','status');preview.setAttribute('aria-live','polite');content.append(preview);
      const footer=create(doc,'footer','gw5-rest-footer');
      const cancel=button(t(confirmed?'close':'cancel'),()=>{window.close();},busy);cancel.dataset.gw5RestCancel='';
      const confirm=button(t(confirmed?'retrySave':'confirm'),async()=>{
        if(busy||completed||closed)return;
        setBusy(true);operationError=undefined;
        try{
          allowed();
          if(!confirmed){
            if(edition()!==restEdition||JSON.stringify(data())!==baseline)throw Object.assign(Error('rest.changed'),{code:'rest.changed'});
            confirmed=finished();
          }
          // A save retry uses the same confirmed result. It cannot spend a die
          // or recover resources a second time after an uncertain response.
          await commit(structuredClone(confirmed));
          completed=true;setBusy(false);window.close();
        }catch(error){operationError=error;setBusy(false);draw();}
      },busy||completed||!canEdit());confirm.dataset.gw5RestConfirm='';footer.append(cancel,confirm);content.append(footer);
      function refreshPreview(){
        preview.replaceChildren(create(doc,'h3','',t('rest.previewTitle')));
        try{
          const next=confirmed||finished(),grid=create(doc,'div','gw5-rest-summary');
          const metric=(label,before,after,suffix='')=>{const cell=create(doc,'div','gw5-rest-metric');cell.append(create(doc,'span','',t(label)),create(doc,'strong','',`${before} → ${after}${suffix}`));grid.append(cell);};
          metric('rest.hitPoints',numeric(original.bars?.bar_1?.value),numeric(next.bars?.bar_1?.value),` / ${numeric(next.bars?.bar_1?.max)}`);
          metric('hitDice',hitDicePools(original).reduce((sum,pool)=>sum+pool.value,0),hitDicePools(next).reduce((sum,pool)=>sum+pool.value,0));
          if(slotTotal(original)!==slotTotal(next))metric('spellSlots',slotTotal(original),slotTotal(next));
          if(resourceTotal(original)!==resourceTotal(next))metric('rest.resources',resourceTotal(original),resourceTotal(next));
          if(numeric(original.exhaustion)!==numeric(next.exhaustion))metric('exhaustion',numeric(original.exhaustion),numeric(next.exhaustion));
          preview.append(grid);confirm.disabled=busy||completed||!canEdit();
        }catch(error){failure(preview,error);confirm.disabled=true;}
      }
      refreshPreview();if(operationError)failure(content,operationError);
      if(focusPool!==undefined){const replacement=[...content.querySelectorAll('[data-gw5-hit-die]')].find(input=>input.dataset.gw5HitDie===focusPool&&!input.disabled);(replacement||confirm).focus();}
    }
    draw();
  }

  async function turnKey(){
    let sceneId=context.sceneId;
    if(!sceneId){const maps=await api.maps.state();sceneId=maps.navigatingMapId||maps.activeMapId;}
    if(!sceneId)return undefined;
    const state=await api.combat.state({sceneId});
    const current=state.combatants?.find(entry=>entry.is_current||entry.isCurrent||entry.current);
    return state.active&&state.encounterId?`${sceneId}:${state.encounterId}:${state.round}:${current?.id??state.turn}`:undefined;
  }
  function cast(item){
    const {window,body:content}=body('castSpell'),level=Math.max(0,numeric(item.data?.level));
    content.append(create(doc,'strong','',item.name));
    const mode=select(content,'castingMode',[['normal','castNormal'],...(item.data?.ritual?[['ritual','castRitual']]:[]),...(numeric(item.data?.uses?.max)>0?[['innate','castInnate']]:[]),['free','castFree']],'normal');
    const action=select(content,'castingAction',[['action','action'],['bonus','bonusAction'],['reaction','reaction'],['long','longCastingTime']],item.data?.actionType||'action');
    const slot=select(content,'slotLevel',Array.from({length:Math.max(1,10-Math.max(1,level))},(_,i)=>[Math.max(1,level)+i,'spellLevel'+(Math.max(1,level)+i)]),Math.max(1,level));
    const pool=select(content,'spellSlotPool',[['spell','spellSlots'],['pact','pactMagic']],'spell');
    const info=create(doc,'p','gw5-empty');content.append(info);
    function refresh(){slot.disabled=!canEdit()||mode.value!=='normal'||level===0||pool.value==='pact';pool.disabled=!canEdit()||mode.value!=='normal'||level===0;info.textContent=mode.value==='innate'?`${t('castInnateHelp')} ${numeric(item.data?.uses?.value)} / ${numeric(item.data?.uses?.max)}`:t(level===0?'cantripNoSlot':mode.value==='ritual'?'ritualCastHelp':mode.value==='free'?'freeCastHelp':'castHelp');}
    for(const input of [mode,pool])input.onchange=refresh;refresh();
    content.append(button(t('castSpell'),()=>run(content,async()=>{
      const slotLevel=mode.value!=='normal'?level:level===0?0:pool.value==='pact'?numeric(data().pactSlots?.level):numeric(slot.value);
      spellCast(data(),item,{slotLevel,castMode:mode.value==='innate'?'innate':'normal',ritual:mode.value==='ritual',free:mode.value==='free',pool:pool.value,actionType:action.value,turnKey:mode.value==='ritual'||action.value==='long'?undefined:await turnKey()});
      data().lastCast={sourceId:item.id,slotLevel};
      await commit();window.close();
    }),!canEdit()));
  }

  function health(){
    const box=create(doc,'div','gw5-health-state'),state=data().death||{};
    if(data().deathSavesEnabled!==false&&numeric(data().bars?.bar_1?.value)<=0){
      for(const [path,label] of [['success','deathSuccesses'],['fail','deathFailures']])box.append(field({type:'numberField',path:`sheet.death.${path}`,labelKey:label}));
      box.append(create(doc,'span','gw5-health-label',t(state.dead?'deathDead':state.stable?'deathStable':'deathUnconscious')));
      box.append(button(t('deathSave'),()=>env.roll('roll.death_save'),!canEdit()||state.dead||state.stable),button(t('stabilize'),async()=>{stabilize(data());await commit();},!canEdit()||state.dead));
    }
    if(data().concentration?.active){
      const concentration=create(doc,'div','gw5-concentration');concentration.append(create(doc,'span','',t('concentration')));
      if(data().concentration.pendingDC)concentration.append(button(`${t('concentrationCheck')} · ${data().concentration.pendingDC}`,()=>env.roll('roll.save.con',null,'con',{concentration:true}),!canEdit()));
      concentration.append(button(t('endConcentration'),async()=>{endConcentration(data());await commit();},!canEdit()));box.append(concentration);
    }
    return box;
  }

  function settings(content){
    content.append(field({type:'selectField',path:'sheet.acMode',labelKey:'acMode',options:[{value:'manual',labelKey:'acManual'},{value:'equipment',labelKey:'acEquipment'}]}));
    const training=create(doc,'div','gw5-row');for(const type of ['light','medium','heavy','shield'])training.append(field({type:'checkboxField',path:`sheet.armorTraining.${type}`,labelKey:'training'+type[0].toUpperCase()+type.slice(1)}));content.append(training);
    const conditions=create(doc,'details','gw5-condition-settings');conditions.append(create(doc,'summary','',t('manageConditions')));
    const grid=create(doc,'div','gw5-condition-grid');for(const id of CONDITION_IDS){const input=check(grid,'condition'+id[0].toUpperCase()+id.slice(1));input.checked=(data().conditions||[]).includes(id);input.onchange=()=>{const current=new Set(data().conditions||[]);if(input.checked)current.add(id);else current.delete(id);env.changed('sheet.conditions',[...current]);};}conditions.append(grid);content.append(conditions);
    const actions=create(doc,'div','gw5-row');actions.append(button(t('configureHitDice'),hitDiceSettings,!canEdit()),button(t('shortRest'),()=>rest('short'),!canEdit()),button(t('longRest'),()=>rest('long'),!canEdit()));content.append(actions);
  }

  function damageControls(parent){
    const selectType=select(parent,'damageType',[['','damageUntyped'],...DAMAGE_TYPES.map(id=>[id,'damageType'+id[0].toUpperCase()+id.slice(1)])]);
    const critical=check(parent,'damageCritical');
    const knockout=check(parent,'knockoutDamage');
    return {options:()=>({damageType:selectType.value,critical:critical.checked,nonlethal:knockout.checked,melee:knockout.checked,edition:edition()})};
  }
  function applyResult(parent,{kind,total,damageType='',critical=false,beforeApply=async()=>{}}){
    if(!['healing','temporary','damage'].includes(kind))return;
    let temporaryChoice;
    if(kind==='temporary'&&numeric(data().bars?.bar_2?.value)>0)temporaryChoice=select(parent,'temporaryChoice',[['keep','keepTemporaryHP'],['replace','replaceTemporaryHP']],'keep');
    const apply=button(t(kind==='damage'?'applyDamageToSheet':kind==='temporary'?'applyTemporaryToSheet':'applyHealingToSheet'),()=>run(parent,async()=>{
      await beforeApply();
      if(kind==='damage')damage(data(),total,{damageType,critical,edition:edition()});else if(kind==='temporary')grantTemporaryHP(data(),total,{replace:!temporaryChoice||temporaryChoice.value==='replace'});else heal(data(),total);
      await commit();apply.remove();
    }),!canEdit());parent.append(apply);
  }
  return {settings,health,cast,rest,hitDiceSettings,damageControls,applyResult};
}
