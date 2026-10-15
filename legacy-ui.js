import {openModal} from './sheet.js';
const el=(doc,tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=typeof text==='function'?text():text;return node;};
const bindTranslation=(node,key,value)=>{node[key]=value();};

/** Owner choices use the host's native modal and the package's public-API manager. */
export async function openLegacyMigration(context, system) {
  if (system.legacyMigration?.isConnected) {system.legacyMigration.querySelector('button')?.focus(); return system.legacyMigration;}
  const manager = system.compatibility;
  if (!manager) return null;
  const doc = context.root?.ownerDocument ?? globalThis.document, t = system.t ?? context.api?.i18n?.t ?? context.i18n?.t;
  const modal = openModal(context.api,doc,t('legacy.title'),context.signal,t('close'));
  modal.classList.add('gw5-legacy-migration');system.legacyMigration = modal;
  const body = el(doc,'div','gw5-modal-body'), status = el(doc,'p','gw5-field-hint'),
    notice = el(doc,'p','gw5-notice'), controls = el(doc,'div','gw5-actions');
  status.setAttribute('role','status');notice.setAttribute('role','alert');notice.hidden = true;
  body.append(status,notice,controls);modal.append(body);
  let phase = 'review', busy = false, work, preview, errorKey = '';

  function updateStatus() {
    const key = busy && manager.current.state === 'restarting' ? 'legacy.waiting' : manager.current.state === 'absent' ? 'legacy.absent'
      : manager.current.active === true ? 'legacy.active' : manager.current.active === false ? 'legacy.inactive' : 'legacy.unknown';
    bindTranslation(status,'textContent',()=>t(key));
  }
  function button(key, task) {
    const node = el(doc,'button','gw5-button',()=>t(key));node.type = 'button';node.disabled = busy;
    node.onclick = () => {void run(task);};controls.append(node);return node;
  }
  function render() {
    if (!modal.isConnected) return;
    updateStatus();controls.replaceChildren();notice.hidden = !errorKey;
    if (errorKey) bindTranslation(notice,'textContent',()=>t(errorKey));
    modal.setAttribute('aria-busy',String(busy));
    if (busy) return;
    const current = manager.current;
    if (!current.isOwner && current.state !== 'absent') {
      controls.append(el(doc,'p','gw5-readonly',()=>t('legacy.ownerRequired')));
      button('legacy.retry',()=>manager.refresh());return;
    }
    if (phase === 'disable-confirm') {
      controls.append(el(doc,'p','',()=>t('legacy.restartNotice')));
      button('legacy.confirmDisable',async () => {await manager.deactivate({confirmed:true});phase = 'review';});
    } else if (phase === 'remove-confirm') {
      controls.append(el(doc,'p','',()=>t('legacy.removeNotice')));
      const names = [...new Set(preview.packages.flatMap(row => row.tables.map(table => table.name)))].join(', ');
      if (names) controls.append(el(doc,'p','',()=>t('legacy.affectedTables',{names})));
      button('legacy.confirmRemove',async () => {await manager.remove({confirmed:true,preview});phase = 'review';preview = null;});
    } else if (current.active) {
      button('legacy.disable',()=>{phase = 'disable-confirm';});
      if (current.migration?.phase === 'waiting') button('legacy.resume',()=>manager.resume());
    } else if (current.state === 'inactive') {
      button('legacy.remove',async () => {preview = await manager.previewRemoval();phase = 'remove-confirm';});
    } else if (current.state === 'unknown') button('legacy.retry',()=>manager.refresh());
  }
  async function run(task) {
    if (busy || context.signal?.aborted) return;
    busy = true;errorKey = '';render();
    work = Promise.resolve().then(task);
    try {await work;} catch (error) {
      phase = 'review';
      errorKey = error.code === 'owner_required' || error.code === 'permission_denied' ? 'legacy.ownerRequired'
        : error.code === 'legacy-status-unavailable' ? 'legacy.unknown' : 'legacy.error';
    } finally {work = null;busy = false;render();}
  }
  const unsubscribe = manager.subscribe(()=>{if (busy) updateStatus();else render();});
  const language = context.api?.i18n?.onChange?.(()=>{modal.setAttribute('aria-label',t('legacy.title'));modal.querySelector('.gw5-modal-title').firstChild.nodeValue=t('legacy.title');render();});
  const cleanup = () => {unsubscribe();language?.();if (system.legacyMigration === modal) system.legacyMigration = null;};
  modal.addEventListener('gravewright:sheet-flush',event=>event.detail?.waitUntil?.(work ?? Promise.resolve()));
  modal.addEventListener('close',cleanup,{once:true});
  context.onDispose?.(()=>{cleanup();modal.close(true);});
  render();await run(()=>manager.refresh());
  return modal;
}
