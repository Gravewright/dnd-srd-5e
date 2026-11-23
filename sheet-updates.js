/** One authorized actor index subscription per active system/table instance. */
export function createActorUpdates(api,signal) {
  const listeners=new Set();let unsubscribe,disposed=false,latest,sequence=0;
  function release(){unsubscribe?.();unsubscribe=undefined;latest=undefined;sequence++;}
  function dispose(){disposed=true;release();listeners.clear();}
  signal?.addEventListener('abort',dispose,{once:true});
  return {dispose,subscribe(listener){
    if(disposed||signal?.aborted)return ()=>{};
    let active=true;const observed=sequence,replay=latest;
    listeners.add(listener);
    unsubscribe??=api.events.on('actors.changed',value=>{latest=value;sequence++;for(const handler of [...listeners])handler(value);});
    // A sheet may finish loading after the shared index has already advanced.
    // Replay only if no newer event reached it in the meantime.
    if(replay!==undefined)queueMicrotask(()=>{if(active&&!disposed&&sequence===observed)listener(replay);});
    return ()=>{active=false;listeners.delete(listener);if(!listeners.size)release();};
  }};
}

/** Coalesce invalidations without replacing edits or racing sheet responses. */
export function createSheetRefresh({context,signal,current,busy,read,apply,error}) {
  let pending,dirty=false;
  function relevant(event) {
    if(context.tableId&&event?.tableId&&context.tableId!==event.tableId)return false;
    // A token's control permissions and independent revision are not represented
    // by its actor index row. Keep its authorized sheet read on invalidation.
    if(context.tokenId||!Array.isArray(event?.actors))return true;
    const row=event.actors.find(actor=>actor.id===context.actorId),view=current();
    return !row||row.canOpen===false||!Number.isFinite(row.version)||!Number.isFinite(row.sheetVersion)
      ||row.version!==view.version||row.sheetVersion!==view.sheetVersion||row.canEdit!==view.canEdit;
  }
  function resume() {
    if(signal.aborted||busy()||!dirty)return pending;
    if(pending)return pending;
    pending=(async()=>{
      while(dirty&&!signal.aborted&&!busy()){
        dirty=false;
        try {
          const value=await read();
          if(signal.aborted)return;
          if(busy()){dirty=true;return;}
          const view=current();
          if(value.version<view.version||value.sheetVersion<view.sheetVersion){dirty=true;continue;}
          apply(value);
        }catch(failure){if(!signal.aborted)error(failure);return;}
      }
    })().finally(()=>{pending=undefined;if(dirty&&!busy()&&!signal.aborted)void resume();});
    return pending;
  }
  return {resume,invalidate(event){if(signal.aborted||!relevant(event))return pending;dirty=true;return resume();}};
}
