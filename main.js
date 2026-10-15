import {mountSheet,openModal} from './sheet.js';
import {createChatRolls} from './chat-rolls.js';
import {createCatalog} from './catalog.js';
import {mountTracker} from './tracker.js';
import {createLegacyCompatibility} from './legacy.js';
import {openLegacyMigration} from './legacy-ui.js';

let host, system, settingsModal,releaseCatalog;
export default {
  async start(context) {
    if(!context.i18n?.register||!context.api?.i18n?.t)throw new Error('DnD 5e SRD requires Gravewright VTT 0.2.3 or newer with the official Translator i18n API.');
    if(context.signal.aborted)throw Object.assign(new Error('cancelled'),{code:'cancelled'});
    host=context;
    const {schemas,layouts,locales,actions}=await context.assets.json('system.json');
    if(context.signal.aborted)throw Object.assign(new Error('cancelled'),{code:'cancelled'});
    context.i18n.register(locales);context.styles.use('styles.css');context.styles.use('monster.css');context.styles.use('tracker.css');
    system={schemas,layouts,actions,listeners:new Set(),chatRolls:createChatRolls(),t:(key,args)=>context.i18n.t(key,args)};
    system.compatibility=createLegacyCompatibility(context);
    await system.compatibility.refresh().catch(error=>{if(context.signal.aborted||error.code==='cancelled')throw error;});
    if(context.signal.aborted)throw Object.assign(new Error('cancelled'),{code:'cancelled'});
    const catalog=createCatalog(context.api);
    system.catalog=options=>catalog.load(options);
    releaseCatalog=context.api.events.on('compendiums.changed',({state})=>catalog.update(state));
  },
  register({register}) {
    register('actor.sheet',{mode:'replace',types:['character','monster'],mount:block=>mountSheet(block,system)});
    register('item.sheet',{mode:'replace',mount:block=>mountSheet(block,system,true)});
    register('chat.log',{mode:'augment',mount:block=>system.chatRolls.mount(block)});
    register('combat.tracker',{mode:'replace',mount:block=>mountTracker(block,system)});
  },
  async customize() {
    if(settingsModal?.isConnected){settingsModal.focus();return;}
    await system.compatibility.refresh().catch(error=>{if(host.signal.aborted||error.code==='cancelled')throw error;});
    if(host.signal.aborted)throw Object.assign(new Error('cancelled'),{code:'cancelled'});
    const t=(key,params)=>host.i18n.t(key,params),state=await host.api.actors.state();
    let current=await host.storage.table.get('rules');
    const d=openModal(host.api,document,t('settings'),host.signal,t('close'));settingsModal=d;
    d.querySelector('button').setAttribute('aria-label',t('close'));
    const form=document.createElement('form');form.className='gw5-modal-body';d.append(form);
    const label=document.createElement('label');label.className='gw5-field';label.textContent=t('edition');
    const select=document.createElement('select');select.name='edition';
    for(const edition of ['2014','2024']){const option=document.createElement('option');option.value=edition;option.textContent=t('edition'+edition);select.append(option);}
    select.value=current?.value?.edition||'2014';select.disabled=!state.is_gm;label.append(select);form.append(label);
    const help=document.createElement('p');help.textContent=t('editionHelp');form.append(help);
    if(system.compatibility.current.state!=='absent') {
      const migration=document.createElement('button');migration.type='button';migration.className='gw5-button';migration.textContent=t('legacy.title');
      migration.onclick=()=>void openLegacyMigration(host,system);form.append(migration);
    }
    const notice=document.createElement('p');notice.role='alert';form.append(notice);
    const submit=document.createElement('button');submit.type='submit';submit.className='gw5-button';submit.textContent=t('save');submit.disabled=!state.is_gm;form.append(submit);
    form.onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;
      try {
        current=await host.storage.table.set('rules',{edition:select.value},{expectedRevision:current?.revision??null});
        for(const listener of system.listeners)listener();d.close();
      }catch(error){notice.textContent=t(error.code==='conflict'?'conflict':'saveError');if(error.code==='conflict')current=await host.storage.table.get('rules');}
      finally{submit.disabled=!state.is_gm;}
    };
  },
  stop() {settingsModal?.close(true);settingsModal=null;releaseCatalog?.();releaseCatalog=null;system?.compatibility.dispose();system?.chatRolls.stop();system?.listeners.clear();system=null;host=null;},
};
