import {createCombatController} from './combat-controller.js';
import {mountSheet,openModal} from './sheet.js';
import {openLegacyMigration} from './legacy-ui.js';

const identity=entry=>entry.token_id?{tokenId:entry.token_id}:{actorId:entry.actor_id};
const paths={play:'m8 4 12 8-12 8Z',stop:'M5 5h14v14H5Z',pause:'M8 5v14M16 5v14',previous:'m15 5-7 7 7 7',next:'m9 5 7 7-7 7',
  previousRound:'M4 10a8 8 0 1 1 1 8M4 3v7h7',nextRound:'M20 10a8 8 0 1 0-1 8M20 3v7h-7',
  dice:'M4 4h16v16H4ZM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01',npcs:'M7 18v-3a7 7 0 1 1 10 0v3H7ZM10 18v4M14 18v4M8 10h1M15 10h1',
  missing:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01',plus:'M12 4v16M4 12h16',settings:'M4 7h16M4 17h16M8 3v8M16 13v8',
  actions:'M12 5h.01M12 12h.01M12 19h.01'};

/** The package owns controls and automation; the native tracker supplies its layout. */
export async function mountTracker(block,system) {
  const {root,api,storage,context,signal}=block,doc=root.ownerDocument,t=(key,args)=>api.i18n.t(key,args);
  const controller=createCombatController({api,storage,sceneId:context.sceneId,compatibility:system.compatibility,t});
  const shell=doc.createElement('section');shell.className='gw-combat-panel gw5-combat';shell.setAttribute('translate','no');
  // Replacing the native surface hides its DOM, but the host's delegated
  // handlers remain on the containing panel. Package controls own these events.
  shell.addEventListener('click',event=>event.stopPropagation(),{signal});
  shell.addEventListener('change',event=>event.stopPropagation(),{signal});
  const target=doc.createElement('div');target.className='gw-combat-panel__state';shell.append(target);root.append(shell);
  let current,busy=false,disposed=false,errorKey='',lastTask,reloading,dirty=false,lastPublic='',poll;
  const subscriptions=[],modals=new Set();
  const el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
  function glyph(name) {
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
    svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.dice);svg.append(path);return svg;
  }
  function button(action,key,task,{icon,disabled=false,primary=false,danger=false}={}) {
    const node=el('button',icon?'gw-combat-icon':'gw5-button');node.type='button';node.dataset.gw5CombatAction=action;
    node.title=t(key);node.setAttribute('aria-label',t(key));node.disabled=disabled||busy;
    if(primary)node.classList.add('gw-combat-icon--primary');if(danger)node.classList.add('gw-combat-icon--danger');
    node.append(icon?glyph(icon):doc.createTextNode(t(key)));node.onclick=event=>{event.stopPropagation();void run(task);};return node;
  }
  function errorMessage(error) {
    if(error.code==='legacy-server-active')return 'legacy.active';
    if(error.code==='legacy-status-unavailable')return 'legacy.unknown';
    if(error.code==='permission_denied')return 'readOnly';
    if(error.code==='conflict')return 'conflict';
    if(error.code==='combat-formula-invalid')return 'combat.invalidFormula';
    return String(error.code||'').startsWith('combat.')?error.code:'combat.error';
  }
  async function refresh() {
    if(disposed)return;
    if(reloading){dirty=true;return reloading;}
    reloading=(async()=>{
      do {dirty=false;current=await controller.refresh();lastPublic=JSON.stringify(current.tracker);if(!disposed)render();}while(dirty&&!disposed);
    })().catch(error=>{if(!disposed){errorKey=errorMessage(error);render();}}).finally(()=>{reloading=null;});
    return reloading;
  }
  async function run(task) {
    if(busy||disposed)return;
    busy=true;errorKey='';lastTask=task;render();
    // Controller commands already finish with an authenticated refresh. Avoid a
    // second network wait after opening a modal: its submit must be usable now.
    try {await task();if(!disposed){current=controller.snapshot();lastPublic=JSON.stringify(current.tracker);}lastTask=null;}
    catch(error){if(!disposed){errorKey=errorMessage(error);current=controller.snapshot();}}
    finally {busy=false;if(!disposed)render();}
  }
  function modal(title) {
    const window=openModal(api,doc,t(title),signal,t('close'));window.classList.add('gw5-combat-modal');modals.add(window);
    window.addEventListener('close',()=>modals.delete(window),{once:true});return window;
  }
  async function formModal(title,fieldKey,initial,submit,{type='text',minimum,maximum}={}) {
    const window=modal(title),form=el('form','gw5-modal-body'),label=el('label','gw5-field',t(fieldKey));
    const input=el('input');input.type=type;input.value=initial??'';input.name='value';
    if(minimum!==undefined)input.min=String(minimum);if(maximum!==undefined)input.max=String(maximum);
    if(type==='number')input.step='any';else input.maxLength=120;label.append(input);
    const notice=el('p','gw5-notice');notice.role='alert';notice.hidden=true;
    const save=el('button','gw5-button',t('save'));save.type='submit';form.append(label,notice,save);window.append(form);
    form.onsubmit=event=>{
      event.preventDefault();save.disabled=true;
      void run(async()=>{
        try {await submit(input.value);window.close();}
        catch(error){notice.hidden=false;notice.textContent=t(errorMessage(error));throw error;}
        finally {save.disabled=false;}
      });
    };
    queueMicrotask(()=>input.focus());
  }
  async function addCombatant() {
    const [actors,tokens]=await Promise.all([api.actors.state(),api.tokens.state({mapId:context.sceneId})]);
    const window=modal('combat.add'),form=el('form','gw5-modal-body');window.append(form);
    const label=el('label','gw5-field',t('combat.add')),select=el('select');select.name='combatant';
    const present=new Set(current.state.combatants.map(entry=>entry.id)),choices=[];
    for(const [key,rows] of [['combat.addToken',tokens.tokens||[]],['combat.addActor',actors.actors||[]]]) {
      const group=el('optgroup');group.label=t(key);
      for(const row of rows)if(!present.has(row.id)) {
        const index=choices.push(key==='combat.addToken'?{tokenId:row.id}:{actorId:row.id})-1;
        const option=el('option','',row.name||row.id);option.value=String(index);group.append(option);
      }
      if(group.children.length)select.append(group);
    }
    label.append(select);form.append(label);
    const notice=el('p','gw5-notice');notice.role='alert';notice.hidden=true;form.append(notice);
    const add=el('button','gw5-button',t('combat.add'));add.type='submit';add.disabled=!choices.length;form.append(add);
    form.onsubmit=event=>{event.preventDefault();void run(async()=>{
      try {await controller.execute('add',choices[Number(select.value)]);window.close();}
      catch(error){notice.hidden=false;notice.textContent=t(errorMessage(error));throw error;}
    });};
  }
  async function openSheet(entry) {
    const view=await api.actors.sheet(entry.actor_id,entry.token_id?{tokenId:entry.token_id}:{});
    if(disposed)return;
    const window=modal('combat.openSheet');window.classList.add('gw5-combat-sheet');
    const body=el('div','gw5-combat-sheet__body');window.append(body);
    const child=new AbortController(),cleanups=[],abort=()=>child.abort();signal.addEventListener('abort',abort,{once:true});
    child.signal.addEventListener('abort',()=>{for(const cleanup of cleanups)cleanup();},{once:true});
    window.addEventListener('close',()=>{child.abort();signal.removeEventListener('abort',abort);},{once:true});
    const childApi={...api,events:{...api.events,on:(...args)=>{const release=api.events.on(...args);cleanups.push(release);return release;}}};
    try {await mountSheet({...block,api:childApi,root:body,signal:child.signal,onDispose:cleanup=>cleanups.push(cleanup),context:{...context,actorId:entry.actor_id,
      actorType:view.actorType||view.type||'character',canEdit:view.canEdit,...entry.token_id?{tokenId:entry.token_id}:{}}},system);}
    catch(error){window.close(true);throw error;}
  }
  function actions(entry,locked) {
    const wrap=el('div','gw-combat-combatant__actions'),menu=el('details','gw-combat-menu'),trigger=el('summary','gw-combat-menu__trigger');
    trigger.title=t('combat.actions');trigger.setAttribute('aria-label',t('combat.actions'));trigger.append(glyph('actions'));menu.append(trigger);
    const list=el('div','gw-combat-menu__list');
    const item=(action,key,task,disabled=false)=>{
      const node=button(action,key,task,{disabled});node.className='gw-combat-menu-item';node.dataset.gw5CombatantId=entry.id;
      node.addEventListener('click',()=>{menu.open=false;});list.append(node);
    };
    item('token/sheet','combat.openSheet',()=>openSheet(entry));
    if(current.isGM) {
      const command=(method,payload={})=>()=>controller.execute(method,{...identity(entry),...payload});
      item('initiative/roll-one','combat.rollOne',()=>controller.rollInitiative('one',entry),locked||!current.state.config?.formula);
      item('order/up','combat.moveUp',command('moveUp'),locked||!entry.can_move_up);
      item('order/down','combat.moveDown',command('moveDown'),locked||!entry.can_move_down);
      item('turn/set','combat.setTurn',command('setTurn'),locked||!current.state.active);
      item('flags/hidden',entry.hidden?'combat.reveal':'combat.hide',command('toggle',{hidden:!entry.hidden}),locked);
      item('flags/defeated',entry.defeated?'combat.restore':'combat.defeat',command('toggle',{defeated:!entry.defeated}),locked);
      item('combatants/remove','combat.remove',command('remove'),locked);
    }
    menu.append(list);wrap.append(menu);return wrap;
  }
  function combatant(entry,locked) {
    const row=el('article','gw-combat-combatant');row.dataset.gw5CombatantId=entry.id;row.dataset.gw5TokenId=entry.token_id||'';
    for(const [value,cls] of [[entry.is_current,'is-current'],[entry.is_next,'is-next'],[entry.has_acted,'has-acted'],[entry.defeated,'is-defeated'],[entry.hidden,'is-hidden-combatant']])if(value)row.classList.add(cls);
    row.append(el('span','gw-combat-combatant__position'+(entry.is_current?' gw-combat-combatant__turn-star':''),entry.is_current?'★':entry.position));
    const portrait=el('span','gw-combat-combatant__portrait');
    if(entry.portrait_url){const image=el('img');image.src=entry.portrait_url;image.alt='';image.loading='lazy';portrait.append(image);}
    else portrait.append(el('span','gw-combat-combatant__initial',String(entry.name||'?').trim().charAt(0).toUpperCase()));
    row.append(portrait);
    const main=el('div','gw-combat-combatant__main');main.append(el('span','gw-combat-combatant__name',entry.name));
    const meta=[];if(entry.conditions_count)meta.push(`${entry.conditions_count} ⊘`);if(entry.effects_count)meta.push(`${entry.effects_count} ✦`);
    if(meta.length)main.append(el('span','gw-combat-combatant__meta',meta.join(' · ')));
    for(const resource of entry.bars||(entry.bar?[entry.bar]:[])) {
      const slot=resource.slot||'bar_1',percent=Math.max(0,Math.min(100,Number(resource.percent)||0));
      const bar=el('button',`gw-combat-bar ${percent<=25?'is-critical':percent<=50?'is-wounded':'is-healthy'}${slot==='bar_2'?' gw-combat-bar--secondary':''}`);
      bar.type='button';bar.dataset.gw5CombatAction='resource/edit';bar.dataset.gw5ResourceSlot=slot;bar.disabled=busy||!entry.canControl;
      bar.setAttribute('aria-label',`${t('combat.resource')}: ${entry.name}, ${resource.value}/${resource.max}`);
      const track=el('span','gw-combat-bar__track'),fill=el('span','gw-combat-bar__fill');fill.style.width=`${percent}%`;track.append(fill);
      bar.append(track,el('span','gw-combat-bar__value',`${resource.value}/${resource.max}`));
      bar.onclick=event=>{event.stopPropagation();void run(()=>formModal('combat.resource','combat.value',resource.value,value=>controller.setResource(entry,slot,value)));};
      main.append(bar);
    }
    row.append(main);
    if(current.isGM) {
      const input=el('input','gw-combat-combatant__score gw-combat-combatant__score--editable');input.type='number';input.step='any';input.min='-1000000';input.max='1000000';
      input.value=entry.initiative??'';input.placeholder='—';input.disabled=locked||busy;input.dataset.gw5CombatInitiative=entry.id;
      input.setAttribute('aria-label',`${t('combat.initiative')}: ${entry.name}`);
      input.onchange=event=>{event.stopPropagation();void run(async()=>{
        if(!input.value.trim()||!input.checkValidity())throw Object.assign(new Error('combat.invalidResource'),{code:'combat.invalidResource'});
        await controller.execute('setInitiative',{...identity(entry),value:Number(input.value)});
      });};row.append(input);
    } else row.append(el('span','gw-combat-combatant__score',entry.initiative??'—'));
    row.append(actions(entry,locked));return row;
  }
  function render() {
    if(disposed)return;
    const focused=doc.activeElement,focusKey=focused?.closest?.('.gw5-combat')===shell?focused.dataset.gw5CombatAction:null;
    target.replaceChildren();target.setAttribute('aria-busy',String(busy));
    if(!current) {target.append(el('p','gw5-notice',t(errorKey||'combat.loading')));if(errorKey)target.append(button('retry','combat.retry',refresh));return;}
    const {state,isGM,paused,tracker}=current,pending=!!(tracker.operation||tracker.stopping),locked=paused||pending,canStop=state.active||pending;
    target.classList.toggle('is-active',!!state.active);
    const header=el('header','gw-combat-header');header.append(el('strong','gw-combat-header__title',state.active?t('combat.round',{round:state.round}):t('combat.inactive')));
    if(state.active)header.append(el('span','gw-combat-header__current',state.current_name||'—'));
    if(state.next_name)header.append(el('span','gw-combat-header__next',t('combat.nextUp',{name:state.next_name})));target.append(header);
    if(isGM) {
      const toolbar=el('div','gw-combat-toolbar');
      toolbar.append(button(canStop?'end':'start',canStop?'combat.stop':'combat.start',canStop?()=>controller.stop():()=>controller.start(),
        {icon:canStop?'stop':'play',disabled:!canStop&&(locked||!state.combatants.length),danger:canStop}),
      button('turn/previous','combat.previous',()=>controller.previous(),{icon:'previous',disabled:locked||!state.active}),
      button('turn/next','combat.next',()=>controller.next(),{icon:'next',primary:true,disabled:locked||!state.active}),
      button('round/previous','combat.previousRound',()=>controller.previousRound(),{icon:'previousRound',disabled:locked||!state.active||state.round<=1}),
      button('round/next','combat.nextRound',()=>controller.nextRound(),{icon:'nextRound',disabled:locked||!state.active}),
      button(paused?'resume':'pause',paused?'combat.resume':'combat.pause',paused?()=>controller.resume():()=>controller.pause(),{icon:paused?'play':'pause',disabled:pending||!state.active}));target.append(toolbar);
      const rollbar=el('div','gw-combat-rollbar');
      for(const [scope,key,icon] of [['all','combat.rollAll','dice'],['npcs','combat.rollNpcs','npcs'],['missing','combat.rollMissing','missing']])
        rollbar.append(button(`initiative/roll-${scope}`,key,()=>controller.rollInitiative(scope),{icon,primary:scope==='all',disabled:locked||!state.combatants.length||!state.config?.formula}));
      rollbar.append(button('combatants/add','combat.add',addCombatant,{icon:'plus',disabled:locked}),
        button('initiative/configure','combat.configure',()=>formModal('combat.configure','combat.formula',state.config?.formula||'',formula=>controller.execute('configure',{formula})),{icon:'settings',disabled:locked}));target.append(rollbar);
    }
    if(paused)target.append(el('p','gw5-combat-status',t('combat.paused')));
    if(!isGM)target.append(el('p','gw5-combat-status',t('combat.gmControls')));
    if(errorKey||pending) {
      const notice=el('div','gw5-combat-status');notice.role=errorKey?'alert':'status';notice.append(el('p','',t(errorKey||'combat.pending')));
      if(isGM)notice.append(button('retry','combat.retry',()=>pending?controller.retry():lastTask?lastTask():controller.retry()));target.append(notice);
    }
    const legacy=system.compatibility?.current;
    if(legacy&&legacy.state!=='absent')target.append(button('legacy','legacy.title',()=>openLegacyMigration(block,system)));
    const list=el('div','gw-combat-list');if(!state.combatants.length)list.append(el('p','tool-empty gw-combat-empty',t('combat.empty')));
    for(const entry of state.combatants)list.append(combatant(entry,locked));target.append(list);
    if(focusKey)target.querySelector(`[data-gw5-combat-action="${focusKey}"]:not(:disabled)`)?.focus();
  }
  for(const event of ['combat.changed','actors.changed','tokens.changed'])subscriptions.push(api.events.on(event,()=>{void refresh();}));
  subscriptions.push(api.i18n.onChange(()=>render()));
  if(system.compatibility)subscriptions.push(system.compatibility.subscribe(()=>render()));
  function dispose(){if(disposed)return;disposed=true;clearInterval(poll);for(const unsubscribe of subscriptions)unsubscribe?.();for(const window of modals)window.close(true);shell.remove();}
  signal.addEventListener('abort',dispose,{once:true});
  await refresh();
  if(disposed)return dispose;
  poll=setInterval(()=>{
    if(disposed||busy||!root.isConnected||!root.getClientRects().length)return;
    void controller.syncPublic().then(snapshot=>{if(disposed)return;const value=JSON.stringify(snapshot.tracker);if(value!==lastPublic){lastPublic=value;current=snapshot;render();}})
      .catch(error=>{if(!disposed){errorKey=errorMessage(error);render();}});
  },2000);
  return dispose;
}
