/** Keep sheet-owned actions attached to the host's existing chat messages. */
export function createChatRolls() {
  const entries=new Map(),mounts=new Set();
  let stopped=false;

  function disable(entry) {
    const controls=entry.node.querySelectorAll('button,input,select,textarea,fieldset');
    if(entry.node.matches('button,input,select,textarea,fieldset')&&!entry.node.disabled)entry.node.disabled=true;
    for(const control of controls)if(!control.disabled)control.disabled=true;
    entry.node.setAttribute('aria-disabled','true');
  }

  function retire(entry) {
    entry.signal?.removeEventListener('abort',entry.abort);
    entry.disabledObserver?.disconnect();
    entry.node.remove();
  }

  function reconcile() {
    if(stopped)return;
    const destinations=new Map();
    for(const mount of mounts) {
      let messages=destinations.get(mount.surface.ownerDocument);
      if(!messages)destinations.set(mount.surface.ownerDocument,messages=new Map());
      for(const article of mount.surface.querySelectorAll('article[data-message-id]')) {
        if(!messages.has(article.dataset.messageId))messages.set(article.dataset.messageId,article);
      }
    }
    for(const [id,entry] of entries) {
      const article=destinations.get(entry.node.ownerDocument)?.get(id);
      // Moving this same node retains its callbacks across ACK/history renders.
      // The parent check also makes our own observer notifications idempotent.
      if(article&&entry.node.parentElement!==article)article.append(entry.node);
    }
  }

  function mount(block) {
    if(stopped||block.signal?.aborted)return;
    const parent=block.root.parentElement;
    // Signed modules have an extra .gw-module-surface wrapper; public mounts do not.
    const surface=parent?.closest('#chat-panel')??parent;
    if(!surface)return;
    const Observer=surface.ownerDocument.defaultView.MutationObserver;
    const binding={surface,observer:new Observer(reconcile)};
    mounts.add(binding);
    binding.observer.observe(surface,{childList:true,subtree:true});
    let released=false;
    const release=()=>{
      if(released)return;
      released=true;
      binding.observer.disconnect();mounts.delete(binding);
      block.signal?.removeEventListener('abort',release);
      for(const entry of entries.values())if(surface.contains(entry.node))entry.node.remove();
      reconcile();
    };
    binding.release=release;
    block.signal?.addEventListener('abort',release,{once:true});
    block.onDispose?.(release);
    reconcile();
    return release;
  }

  function add(messageId,node,signal) {
    if(stopped){node?.remove();return;}
    if(messageId==null||!node||node.nodeType!==1)return;
    const id=String(messageId);
    if(!id)return;
    const old=entries.get(id);
    if(old?.node===node&&old.signal===signal){reconcile();return;}
    if(old)retire(old);
    const entry={node,signal};
    node.setAttribute('translate','no');
    node.dataset.gw5ChatRoll=id;
    entry.abort=()=>{
      disable(entry);
      // Late callback cleanup must not reactivate actions on a closed sheet.
      if(!entry.disabledObserver) {
        const Observer=node.ownerDocument.defaultView.MutationObserver;
        entry.disabledObserver=new Observer(()=>disable(entry));
        entry.disabledObserver.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
      }
    };
    entries.set(id,entry);
    if(signal?.aborted)entry.abort();
    else signal?.addEventListener('abort',entry.abort,{once:true});
    reconcile();
  }

  function stop() {
    if(stopped)return;
    stopped=true;
    for(const binding of [...mounts])binding.release();
    for(const entry of entries.values())retire(entry);
    entries.clear();
  }

  return {mount,add,stop};
}
