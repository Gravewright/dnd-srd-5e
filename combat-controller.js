/** D&D combat automation through the unchanged public VTT 0.2.3 APIs.
 * Native commands own permissions, condition timers and receipts. This journal
 * keeps the system's multi-document work recoverable across lost responses.
 */
import {prepareInitiative, advanceCombatEffects, hasCombatEffects} from './combat-rules.js';
import {rollResult} from './automation.js';

const copy = value => structuredClone(value);
const fail = code => Object.assign(new Error(code), {code});
const identity = entry => entry.token_id ? {tokenId:entry.token_id} : {actorId:entry.actor_id};
const sheetContext = entry => entry.token_id ? {tokenId:entry.token_id} : {};
const statusCodes = new Set(['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible',
  'paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','surprised']);
const conditionIds = values => [...new Set((Array.isArray(values) ? values : []).map(value =>
  typeof value === 'string' ? value : value?.status || value?.conditionId || value?.code).filter(value => statusCodes.has(value)))];
const part = value => {
  const encoded = encodeURIComponent(String(value));
  if (!encoded || encoded.length > 130) throw fail('combat.invalidCommand');
  return encoded;
};
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const text = [...bytes].map(value => value.toString(16).padStart(2,'0')).join('');
  return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;
}

/** The exact forward phases of a native next-turn/next-round command. */
export function combatPhases(state, method) {
  if (!['nextTurn','nextRound'].includes(method) || !state.active || !state.combatants.length) return [];
  const entries = state.combatants.slice(0,64), previous = entries[state.turn];
  if (!previous) return [];
  const skipped = [];
  let index = state.turn, boundary = method === 'nextRound';
  if (method === 'nextRound') {skipped.push(...entries.slice(index+1)); index = 0;}
  else {
    if (entries.every(entry => entry.defeated)) return [];
    for (let count=0;count<entries.length;count++) {
      if (++index >= entries.length) {index=0; boundary=true;}
      if (!entries[index].defeated) break;
      skipped.push(entries[index]);
    }
  }
  const phase = (name, entry, roundBoundary=false, periodic=false) => ({phase:name, entry, roundBoundary, periodic});
  return [phase('end',previous,boundary), ...skipped.flatMap(entry => [phase('start',entry),phase('end',entry)]),
    phase('start',entries[index],boundary,method==='nextTurn')];
}

export function createCombatController({api, storage, sceneId, compatibility, t=key=>key}) {
  const key = `combat.scene.${part(sceneId)}`, intentKey = `${key}.intent`;
  let state, actors, publicRecord, intent, operation, journal, owner, recovery, recoveryKey;
  const acknowledged = new Set();
  const acknowledgedResources = new Set();
  const currentReceipt = pending => publicRecord?.value.completed?.find(value => value.id===pending.value.id && value.owner===pending.value.owner);
  const isPaused = value => state?.active && value?.paused===true && value.pausedEncounterId===state.encounterId;
  function canResume() {
    const stopping=publicRecord?.value.stopping, pending=stopping||publicRecord?.value.operation;
    if(!actors?.is_gm||!pending||acknowledged.has(pending.id))return false;
    const own=stopping?recovery:(!intent?.value.confirmed&&intent?.value.id===pending.id?intent.value:recovery);
    return !!own && own.id===pending.id && own.owner===pending.owner && own.owner===owner;
  }
  const snapshot = () => ({state:copy(state), isGM:actors?.is_gm===true, paused:isPaused(publicRecord?.value),canResume:canResume(),
    tracker:copy(publicRecord?.value || {schemaVersion:1,paused:false,operation:null})});
  async function refreshRecovery() {
    const stopping=publicRecord?.value.stopping, pending=stopping||publicRecord?.value.operation;
    if(!actors?.is_gm||!pending){recovery=null;recoveryKey=null;return;}
    const marker=`${stopping?'stop':'operation'}:${pending.id}:${pending.owner}`;
    if(recoveryKey===marker)return;
    recovery=null;
    owner??=(await storage.user.get('combat.owner'))?.value;
    if(owner===pending.owner) {
      const saved=await storage.user.get(stopping?`${key}.stop`:intentKey);
      if(saved&&!saved.value.confirmed&&saved.value.id===pending.id&&saved.value.owner===owner)recovery=saved.value;
    }
    // Public polling does not repeatedly read another GM's private namespace.
    recoveryKey=marker;
  }
  async function refresh() {
    [state, actors, publicRecord] = await Promise.all([api.combat.state({sceneId}),api.actors.state(),storage.table.get(key)]);
    await refreshRecovery();
    return snapshot();
  }
  async function syncPublic() {publicRecord=await storage.table.get(key);await refreshRecovery();return snapshot();}
  function running() {if(isPaused(publicRecord?.value)) throw fail('combat.pausedError');}
  async function writePublic(change,{claim=false,stopId=null}={}) {
    for(let attempt=0;attempt<4;attempt++) {
      const previous=await storage.table.get(key), value=copy(previous?.value || {schemaVersion:1,paused:false,operation:null,completed:[]});
      if(stopId ? value.stopping?.id!==stopId : value.stopping || operation &&
        (value.operation?.id!==operation.id && !(claim&&!value.operation))) throw fail('combat.operationBusy');
      change(value);
      try {publicRecord=await storage.table.set(key,value,{expectedRevision:previous?.revision??null});return;}
      catch(error) {if(error.code!=='conflict'||attempt===3)throw error;}
    }
  }
  async function ownerId() {
    if(owner)return owner;
    let record=await storage.user.get('combat.owner');
    if(!record) {
      try {record=await storage.user.set('combat.owner',uuid(),{expectedRevision:null});}
      catch(error) {if(error.code!=='conflict')throw error;record=await storage.user.get('combat.owner');}
    }
    return owner=record.value;
  }
  function complete(value, pending, cancelled=false) {
    value.completed=[...(value.completed||[]).filter(receipt=>receipt.id!==pending.id),
      {id:pending.id,owner:pending.owner,kind:pending.kind,...(cancelled?{cancelled:true}:{})}].slice(-32);
  }
  async function acknowledge(pending) {
    // A freshly read/written public completion is already authoritative. Avoid
    // re-reading actors, encounter and storage a second time on every command.
    if(!currentReceipt(pending))await refresh();
    if(!currentReceipt(pending))throw fail('combat.operationBusy');
    acknowledged.add(pending.value.id);
    try {
      let record=await storage.user.get(intentKey);
      if(record?.value.id===pending.value.id) {
        record=await storage.user.set(intentKey,{...record.value,confirmed:true},{expectedRevision:record.revision});
        try {await storage.user.delete(intentKey,{expectedRevision:record.revision});}catch{/* Confirmed receipts remain safe to clean later. */}
      }
    } catch {/* Public completion remains the authoritative confirmation. */}
    return snapshot();
  }
  async function begin(kind, details={}) {
    await refresh();
    if(!actors.is_gm)throw fail('permission_denied');
    running();await compatibility?.assertReady();
    const publicKind=details.method?`native-${details.method}`:details.scope?`initiative-${details.scope}`:'operation';
    const owned=await ownerId(), previous=await storage.user.get(intentKey);
    if(previous && !previous.value.confirmed && !acknowledged.has(previous.value.id)) {
      if(previous.value.kind!==kind || previous.value.owner!==owned)throw fail('combat.operationBusy');
      if(currentReceipt(previous))return {completed:true,intent:previous};
      if(previous.value.stage==='running' && publicRecord?.value.operation?.id!==previous.value.id)throw fail('combat.operationBusy');
      intent=previous;
    } else {
      if(publicRecord?.value.operation)throw fail('combat.operationBusy');
      intent=await storage.user.set(intentKey,{id:uuid(),owner:owned,kind,details:copy(details),
        encounterId:state.encounterId,stage:'prepared',confirmed:false},{expectedRevision:previous?.revision??null});
    }
    const pending=publicRecord?.value.operation;
    if(pending && (pending.id!==intent.value.id || pending.owner!==owned || pending.kind!==publicKind))throw fail('combat.operationBusy');
    // Shared table storage contains command labels only. Target IDs, formulas
    // and other GM-only arguments stay in the private user intent/journal.
    operation=pending || {id:intent.value.id,owner:owned,kind:publicKind};
    if(!pending)await writePublic(value=>{
      if(value.operation)throw fail('combat.operationBusy');
      if(isPaused(value))throw fail('combat.pausedError');
      value.operation=operation;
    },{claim:true});
    if(intent.value.stage!=='running')intent=await storage.user.set(intentKey,{...intent.value,stage:'running'},{expectedRevision:intent.revision});
    const journalKey=`${key}.operation.${operation.id}`;
    journal=await storage.user.get(journalKey);
    if(!journal)journal=await storage.user.set(journalKey,{steps:[],plans:{}},{expectedRevision:null});
    return {completed:false,intent};
  }
  async function saveJournal(value) {
    journal=await storage.user.set(`${key}.operation.${operation.id}`,value,{expectedRevision:journal.revision});
  }
  async function invoke(domain,method,payload,requestId) {
    if(domain==='dice')return api.dice.roll(payload.expression,{label:payload.label,visibility:payload.visibility},{requestId});
    return api[domain][method](payload,{requestId});
  }
  async function assertOperation() {
    const record=await storage.table.get(key);
    if(record?.value.operation?.id!==operation?.id || record?.value.stopping)throw fail('combat.operationBusy');
  }
  async function step(name,domain,method,build,{reconcile,perform}={}) {
    const stepKey=`${key}.step.${operation.id}.${part(name)}`;
    let saved=await storage.user.get(stepKey);
    for(let attempt=0;attempt<4;attempt++) {
      if(!saved) {
        const requestId=uuid(),payload=await build(requestId);
        saved=await storage.user.set(stepKey,{requestId,payload,done:false},{expectedRevision:null});
      }
      // Register existing steps too: a lost creation response must not leave
      // untracked private checkpoints after a successful recovery.
      if(!journal.value.steps.includes(stepKey)) {
        const next=copy(journal.value);next.steps.push(stepKey);await saveJournal(next);
      }
      if(saved.value.done)return copy(saved.value.result);
      const confirmed=reconcile && await reconcile(saved.value.requestId);
      if(confirmed) {
        saved=await storage.user.set(stepKey,{...saved.value,done:true,result:confirmed},{expectedRevision:saved.revision});
        return confirmed;
      }
      let result;
      await assertOperation();
      try {
        result=perform ? await perform(saved.value.payload,saved.value.requestId)
          : await invoke(domain,method,saved.value.payload,saved.value.requestId);
      } catch(error) {
        if(error.code!=='conflict'||attempt===3) {
          if(domain==='combat'&&['invalid','invalid_input','invalid_data','forbidden','not_found','permission_denied'].includes(error.code))error.combatRejectedStep=stepKey;
          throw error;
        }
        const confirmed=reconcile && await reconcile(saved.value.requestId);
        if(confirmed) {
          saved=await storage.user.set(stepKey,{...saved.value,done:true,result:confirmed},{expectedRevision:saved.revision});return confirmed;
        }
        await storage.user.delete(stepKey,{expectedRevision:saved.revision});saved=null;continue;
      }
      // A failed checkpoint is a storage failure, not a rejected native CAS.
      // Preserve the accepted command's UUID and replay its receipt on retry.
      saved=await storage.user.set(stepKey,{...saved.value,done:true,result},{expectedRevision:saved.revision});
      return result;
    }
  }
  async function actorStep(name,entry,change) {
    const read=()=>api.actors.sheet(entry.actor_id,sheetContext(entry));
    return step(name,'actors','saveSheet',async()=>{
      const view=await read();if(!view.canEdit)throw fail('permission_denied');
      // Store only revisions/identity, never a full sheet in the bounded journal.
      return {actorId:entry.actor_id,tokenId:entry.token_id??null,version:view.version,sheetVersion:view.sheetVersion};
    },{reconcile:async requestId=>{
      const view=await read();return view.data?.combatAutomation?.receipts?.includes(requestId)
        ? {version:view.version,sheetVersion:view.sheetVersion,reconciled:true} : null;
    },perform:async(payload,requestId)=>{
      const view=await read();if(!view.canEdit)throw fail('permission_denied');
      let data=copy(view.data);
      if(view.version===payload.version && view.sheetVersion===payload.sheetVersion) {
        const changed=await change(data);
        if(changed?.changed===false)return {changed:false};
        data=changed?.data || changed || data;
        data.combatAutomation??={};
        data.combatAutomation.receipts=[...(Array.isArray(data.combatAutomation.receipts)?data.combatAutomation.receipts:[]),requestId].slice(-32);
      }
      // If revisions moved, the unchanged old UUID first checks the native
      // receipt. An unaccepted command then rejects CAS before any sheet write.
      return api.actors.saveSheet({...payload,name:view.name,data},{requestId});
    }});
  }
  const nativeStep=(name,method,payload={})=>step(name,'combat',method,async()=>({...payload,sceneId,version:(await api.combat.state({sceneId})).version}));
  async function rollStep(name,expression,{visibility='gm',label=t('combat.periodicRoll')}={}) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${name}\0${expression}`));
    const suffix=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
    const message=await step(`roll-${suffix}`,'dice','roll',()=>({expression,visibility,label:String(label).slice(0,48)}));
    return rollResult(message).total;
  }
  async function planEffects(before,phases) {
    const documents=new Map(), sources=new Map(),views=new Map();
    const entries=before.combatants.slice(0,64),loaded=[];
    for(let index=0;index<entries.length;index+=4)loaded.push(...await Promise.all(entries.slice(index,index+4)
      .map(entry=>api.actors.sheet(entry.actor_id,sheetContext(entry)))));
    for(const [index,entry]of entries.entries()) {
      const view=loaded[index],independent=!!view.tokenId;
      const documentKey=independent?['token',view.tokenId]:['actor',entry.actor_id];
      sources.set(entry.id,{actorId:entry.actor_id,tokenId:entry.token_id||'',independent});
      documents.set(JSON.stringify(documentKey),{documentKey,actorType:view.actorType||'character',
        entry:{actor_id:entry.actor_id,token_id:independent?view.tokenId:null}});
      views.set(JSON.stringify(documentKey),view.data);
    }
    const events=phases.map(phase=>({phase:phase.phase,roundBoundary:phase.roundBoundary,
      periodic:phase.periodic,...sources.get(phase.entry.id)}));
    const eligible=[...documents.values()].filter(document=>hasCombatEffects(views.get(JSON.stringify(document.documentKey)),events.map(event=>({...event,
      documentKey:document.documentKey,isCurrent:document.documentKey[0]==='token'?document.entry.token_id===event.tokenId
        : !event.independent && document.entry.actor_id===event.actorId}))));
    return {documents:eligible,events};
  }
  async function applyEffects(name,plan) {
    if(!plan.documents.length)return;
    if(!plan.conditionsPinned) {
      const tokens=await api.tokens.state({mapId:sceneId}),next=copy(journal.value);
      const pinned=next.plans[name];
      for(const event of pinned.events)event.conditions=conditionIds(tokens.tokens?.find(token=>token.id===event.tokenId)?.conditions);
      pinned.conditionsPinned=true;await saveJournal(next);plan=pinned;
    }
    for(const [index,document]of plan.documents.entries())await actorStep(`effects-${index}`,document.entry,async data=>{
      let value=data,changed=false;
      const clockKeys=new Set();
      for(const [phaseIndex,event]of plan.events.entries()) {
        const isCurrent=document.documentKey[0]==='token'?document.entry.token_id===event.tokenId
          : !event.independent && document.entry.actor_id===event.actorId;
        const result=await advanceCombatEffects(value,{...event,isCurrent,actorType:document.actorType,
          documentKey:document.documentKey,clockKeys},{prefix:`d${index}p${phaseIndex}`,
          roll:(expression,nodeId)=>rollStep(`periodic-${index}-${phaseIndex}-${nodeId}`,expression)});
        value=result.data;changed ||= result.changed;
      }
      return {data:value,changed};
    });
  }
  async function clockedStep(name,method,payload={}) {
    if(!['nextTurn','nextRound'].includes(method))return nativeStep(name,method,payload);
    const result=await step(name,'combat',method,async()=>{
      const before=await api.combat.state({sceneId}),next=copy(journal.value);
      next.plans[name]=await planEffects(before,combatPhases(before,method));await saveJournal(next);
      return {...payload,sceneId,version:before.version};
    });
    const plan=journal.value.plans?.[name];if(!plan)throw fail('combat.missingPlan');
    await applyEffects(name,plan);return result;
  }
  async function finish({cancelled=false}={}) {
    const old=operation,metadata=journal;
    await writePublic(value=>{complete(value,old,cancelled);value.operation=null;});
    // One fresh encounter includes resource bars after every sheet write.
    state=await api.combat.state({sceneId});operation=null;journal=null;
    const result=await acknowledge(intent);
    // Completion has committed and the intent is acknowledged. Private cleanup
    // is optional, bounded to four requests and never holds the combat controls.
    void (async()=>{
      const steps=[...new Set(metadata.value.steps)];
      for(let index=0;index<steps.length;index+=4)await Promise.all(steps.slice(index,index+4).map(async stepKey=>{
        try {const row=await storage.user.get(stepKey);if(row)await storage.user.delete(stepKey,{expectedRevision:row.revision});}catch{/* Only cleanup remains after completion. */}
      }));
      try {await storage.user.delete(`${key}.operation.${old.id}`,{expectedRevision:metadata.revision});}catch{/* A completed journal never repeats its work. */}
    })();
    return result;
  }
  async function execute(method,payload={}) {
    const begun=await begin(`native-${method}-${JSON.stringify(payload)}`,{method,payload});
    if(begun.completed)return acknowledge(begun.intent);
    try {await clockedStep('command',method,intent.value.details.payload);}
    catch(error) {
      // A native validation/permission rejection is an explicit non-acceptance,
      // e.g. Previous before any turn history. No phase has started. Transport,
      // storage, formula and post-acceptance failures remain recoverable locks.
      if(error.combatRejectedStep && journal.value.steps.every(key=>key===error.combatRejectedStep)) {
        const rejected=await storage.user.get(error.combatRejectedStep);
        if(rejected && rejected.value.done===false)await finish({cancelled:true});
      }
      throw error;
    }
    return finish();
  }
  function initiativeExpression(formula,data) {
    return formula.replace(/@([a-zA-Z_][a-zA-Z0-9_.]*)/g,(_,path)=>{
      let value=data;
      for(const segment of path.split('.')) {
        if(['__proto__','constructor','prototype'].includes(segment))throw fail('combat.invalidFormula');
        value=value && Object.hasOwn(value,segment)?value[segment]:0;
      }
      if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)throw fail('combat.invalidFormula');
      return `(${value})`;
    });
  }
  async function rollInitiative(scope='all',selected) {
    if(!['all','npcs','missing','one'].includes(scope))throw fail('combat.invalidCommand');
    await refresh();
    if(!actors.is_gm)throw fail('permission_denied');
    if(!state.config?.formula)throw fail('combat.manualInitiative');
    const begun=await begin(`initiative-${scope}-${selected?.id||''}`,{scope,selected:selected?.id||''});
    if(begun.completed)return acknowledge(begun.intent);
    if(!journal.value.initiative) {
      const tokens=await api.tokens.state({mapId:sceneId}),targets=[];
      const players=actors.players?.map(player=>player.id)||[];
      for(const entry of state.combatants.slice(0,64)) {
        if(scope==='one'&&entry.id!==selected?.id||scope==='missing'&&entry.initiative!==null&&entry.initiative!==undefined)continue;
        const actor=actors.actors.find(actor=>actor.id===entry.actor_id);
        if(scope==='npcs'&&players.some(id=>(actor?.permissions?.[id]??actor?.permissions?.default)==='owner'))continue;
        const view=await api.actors.sheet(entry.actor_id,sheetContext(entry));
        const prepared=prepareInitiative(state.config?.formula||'',view.data,
          {conditions:conditionIds(tokens.tokens?.find(token=>token.id===entry.token_id)?.conditions)});
        if(!prepared.formula)throw fail('combat.manualInitiative');
        const expression=initiativeExpression(prepared.formula,prepared.data);
        if(expression.length>512)throw fail('combat.invalidFormula');
        const hidden=entry.hidden||tokens.tokens?.find(token=>token.id===entry.token_id)?.hidden;
        targets.push({entry:copy(entry),expression,visibility:hidden?'gm':'public'});
      }
      if(scope==='one'&&!targets.length)throw fail('not_found');
      const next=copy(journal.value);next.initiative=targets;await saveJournal(next);
    }
    for(const [index,target]of journal.value.initiative.entries()) {
      const total=await rollStep(`initiative-roll-${index}`,target.expression,{visibility:target.visibility,label:t('combat.initiativeRoll')});
      await nativeStep(`initiative-save-${index}`,'setInitiative',{...identity(target.entry),value:total});
    }
    if(scope==='all')await step('initiative-set-first','combat','setTurn',async()=>{
      // Select from the final native order, with identity and revision from one
      // snapshot. A retry replays this checkpoint instead of rolling again.
      const combat=await api.combat.state({sceneId}),first=combat.combatants[0];
      return combat.active&&first?{sceneId,version:combat.version,...identity(first)}:{skip:true};
    },{perform:(payload,requestId)=>payload.skip?{skipped:true}:api.combat.setTurn(payload,{requestId})});
    return finish();
  }
  async function paused(value) {
    await refresh();if(!actors.is_gm)throw fail('permission_denied');
    if(!state.active)throw fail('combat.notStarted');
    await writePublic(record=>{
      if(record.operation)throw fail('combat.operationBusy');
      record.paused=value;record.pausedEncounterId=value?state.encounterId:'';
    });return snapshot();
  }
  async function stop() {
    await refresh();if(!actors.is_gm)throw fail('permission_denied');
    const stopKey=`${key}.stop`,owned=await ownerId();
    let saved=await storage.user.get(stopKey);
    if(!saved || saved.value.confirmed) {
      saved=await storage.user.set(stopKey,{id:uuid(),owner:owned,encounterId:state.encounterId,
        operation:copy(publicRecord?.value.operation||null),requestId:uuid(),payload:{sceneId,version:state.version},confirmed:false},
        {expectedRevision:saved?.revision??null});
    }
    let pending=saved.value;
    recovery=pending;
    async function confirmStop() {
      saved=await storage.user.set(stopKey,{...pending,confirmed:true},{expectedRevision:saved.revision});
      operation=null;journal=null;
      await refresh();
      const previous=await storage.user.get(intentKey);
      return previous && previous.value.id===pending.operation?.id ? acknowledge(previous) : refresh();
    }
    if(publicRecord?.value.completed?.some(receipt=>receipt.id===pending.id&&receipt.owner===owned))return confirmStop();
    const isObserved=value=>(value.operation?.id??null)===(pending.operation?.id??null);
    // Stop has a separate durable reservation, so another GM cannot start a new
    // operation between its native receipt and cancellation of the observed one.
    for(let attempt=0;attempt<4;attempt++) {
      const record=await storage.table.get(key),value=copy(record?.value||{schemaVersion:1,completed:[]});
      if(value.stopping && value.stopping.id!==pending.id)throw fail('combat.operationBusy');
      if(!value.stopping) {
        if(!isObserved(value))throw fail('combat.operationBusy');
        const current=await api.combat.state({sceneId});
        if(current.encounterId!==pending.encounterId)throw fail('combat.operationBusy');
        value.stopping={id:pending.id,owner:owned};
        try {publicRecord=await storage.table.set(key,value,{expectedRevision:record?.revision??null});}
        catch(error) {if(error.code==='conflict'&&attempt<3)continue;throw error;}
      }
      break;
    }
    // Only a rejected native CAS may acquire a fresh version and native UUID.
    // Lost responses and storage failures keep the original native receipt.
    for(let attempt=0;attempt<4;attempt++) {
      try {await api.combat.stop(pending.payload,{requestId:pending.requestId});break;}
      catch(error) {
        if(error.code!=='conflict'||attempt===3)throw error;
        const [record,current]=await Promise.all([storage.table.get(key),api.combat.state({sceneId})]);
        if(record?.value.stopping?.id!==pending.id || !isObserved(record.value) || current.encounterId!==pending.encounterId)throw fail('combat.operationBusy');
        saved=await storage.user.set(stopKey,{...pending,requestId:uuid(),payload:{sceneId,version:current.version}},
          {expectedRevision:saved.revision});pending=saved.value;
      }
    }
    await writePublic(value=>{
      if(!isObserved(value))throw fail('combat.operationBusy');
      if(pending.operation)complete(value,pending.operation,true);
      value.operation=null;value.stopping=null;value.paused=false;value.pausedEncounterId='';
      complete(value,{id:pending.id,owner:owned,kind:'stop'});
    },{stopId:pending.id});
    return confirmStop();
  }
  async function setResource(entry,slot,raw) {
    if(!['bar_1','bar_2'].includes(slot)||typeof raw!=='string'||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()))throw fail('combat.invalidResource');
    const resourceKey=`${key}.resource`,kind=`${entry.actor_id}:${entry.token_id||''}:${slot}:${raw.trim()}`;
    let saved=await storage.user.get(resourceKey);
    if(saved&&!saved.value.confirmed&&saved.value.kind!==kind)throw fail('combat.operationBusy');
    async function confirm(record) {
      record=await storage.user.set(resourceKey,{...record.value,confirmed:true},{expectedRevision:record.revision});
      acknowledgedResources.add(record.value.id);
      try {await storage.user.delete(resourceKey,{expectedRevision:record.revision});}catch{/* Completed cleanup never repeats a relative adjustment. */}
      return refresh();
    }
    if(saved?.value.confirmed&&saved.value.kind===kind&&!acknowledgedResources.has(saved.value.id))return confirm(saved);
    const read=()=>api.actors.sheet(entry.actor_id,sheetContext(entry));
    for(let attempt=0;attempt<4;attempt++) {
      const view=await read();if(!view.canEdit)throw fail('permission_denied');
      if(saved&&!saved.value.confirmed&&view.data?.combatAutomation?.receipts?.includes(saved.value.id))break;
      if(!saved||saved.value.confirmed) {
        saved=await storage.user.set(resourceKey,{id:uuid(),kind,confirmed:false,version:view.version,sheetVersion:view.sheetVersion},
          {expectedRevision:saved?.revision??null});
      }
      const data=copy(view.data),bar=data.bars?.[slot];
      if(!bar||typeof bar.value!=='number'||!Number.isFinite(bar.value))throw fail('combat.invalidResource');
      bar.value=/^[+-]/.test(raw.trim())?bar.value+Number(raw):Number(raw);
      if(!Number.isFinite(bar.value))throw fail('combat.invalidResource');
      if(slot==='bar_1')data.hp={...data.hp,value:bar.value,max:bar.max,temp:data.bars?.bar_2?.value??0};
      else if(data.hp)data.hp.temp=bar.value;
      data.combatAutomation??={};data.combatAutomation.receipts=[...(data.combatAutomation.receipts||[]),saved.value.id].slice(-32);
      try {
        await api.actors.saveSheet({actorId:entry.actor_id,tokenId:entry.token_id??null,name:view.name,
          version:saved.value.version,sheetVersion:saved.value.sheetVersion,data},{requestId:saved.value.id});break;
      } catch(error) {
        if(error.code!=='conflict'||attempt===3)throw error;
        const latest=await read();if(latest.data?.combatAutomation?.receipts?.includes(saved.value.id))break;
        saved=await storage.user.set(resourceKey,{id:uuid(),kind,confirmed:false,version:latest.version,sheetVersion:latest.sheetVersion},
          {expectedRevision:saved.revision});
      }
    }
    return confirm(saved);
  }
  async function resumePending() {
    const stopped=await storage.user.get(`${key}.stop`);
    if(stopped&&!stopped.value.confirmed)return stop();
    const pending=await storage.user.get(intentKey);
    if(!pending||pending.value.confirmed)throw fail('combat.operationBusy');
    if(pending.value.owner!==await ownerId())throw fail('combat.operationBusy');
    await refresh();if(currentReceipt(pending))return acknowledge(pending);
    const details=pending.value.details;
    if(pending.value.kind.startsWith('initiative-'))return rollInitiative(details.scope,{id:details.selected});
    return execute(details.method,details.payload);
  }
  return {refresh,syncPublic,snapshot,execute,rollInitiative,setResource,stop,resumePending,retry:resumePending,
    start:()=>execute('start'),next:()=>execute('nextTurn'),previous:()=>execute('previousTurn'),
    nextRound:()=>execute('nextRound'),previousRound:()=>execute('previousRound'),pause:()=>paused(true),resume:()=>paused(false)};
}
