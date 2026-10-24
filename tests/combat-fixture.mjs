import assert from 'node:assert/strict';
import {createCombatController} from '../combat-controller.js';

const clone=value=>structuredClone(value);
export const error=code=>Object.assign(new Error(code),{code});
export const sheet=(extra={})=>({rulesEdition:'2014',abilities:{dex:{score:16}},
  bars:{bar_1:{value:20,max:20},bar_2:{value:0,max:0}},effects:[],inventory:[],...extra});
export const duration=(value=3,extra={})=>({data:{duration:{type:'turns',value,expires:'start',...extra}}});
export const periodic=(value='1d6')=>({data:{modifiers:[{operation:'damage_over_time',target:'damage.self',value}]}});

/** Strict native-CAS/receipt simulator: it never applies system effects itself. */
export function fixture({entries,data={}}={}) {
  const maps={table:new Map(),users:new Map()},receipts=new Map(),calls=[],accepted=[],sheetReads=[];
  const docs=new Map(['hero','monster'].map(id=>[id,{id,tokenId:null,name:id,actorType:id==='monster'?'monster':'character',
    version:1,sheetVersion:1,canEdit:true,data:sheet(data[id])}]));
  const tokens=[{id:'linked',actorId:'hero',conditions:[]},{id:'snapshot',actorId:'hero',conditions:[],independent:true},
    {id:'enemy',actorId:'monster',conditions:[]}];
  docs.set('snapshot',{...clone(docs.get('hero')),tokenId:'snapshot',name:'Independent Hero'});
  const native={sceneId:'scene',encounterId:'encounter-1',active:true,round:1,turn:0,version:1,history:[],
    config:{formula:'1d20 + @init',input:'roll',can_roll:true},combatants:entries||[
      {id:'linked',actor_id:'hero',token_id:'linked',name:'Hero',initiative:20},
      {id:'enemy',actor_id:'monster',token_id:'enemy',name:'Monster',initiative:10}]};
  const hooks={storage:null,beforeNative:null,afterNative:null,diceResult:null,canEdit:true};
  let revision=0;
  const mapFor=(scope,user)=>scope==='table'?maps.table:(maps.users.get(user)||maps.users.set(user,new Map()).get(user));
  const storage=(scope,user)=>({
    async get(key){await hooks.storage?.({method:'get',scope,user,key});return clone(mapFor(scope,user).get(key)||null);},
    async set(key,value,{expectedRevision}={}) {
      await hooks.storage?.({method:'set',scope,user,key,value,when:'before'});
      const map=mapFor(scope,user),old=map.get(key);
      if((old?.revision??null)!==expectedRevision)throw error('conflict');
      const record={value:clone(value),revision:String(++revision)};map.set(key,record);
      await hooks.storage?.({method:'set',scope,user,key,value,when:'after'});return clone(record);
    },
    async delete(key,{expectedRevision}={}) {
      const map=mapFor(scope,user),old=map.get(key);
      if((old?.revision??null)!==expectedRevision)throw error('conflict');map.delete(key);
    },
  });
  const resolve=(actorId,tokenId)=>docs.get(tokens.find(token=>token.id===tokenId)?.independent?tokenId:actorId);
  async function command(domain,method,payload,options={}) {
    const requestId=options.requestId;assert.match(requestId,/^[a-f\d-]{36}$/);
    const call={domain,method,payload:clone(payload),requestId};calls.push(call);
    if(receipts.has(requestId)) {
      const receipt=receipts.get(requestId);assert.equal(receipt.domain,domain);assert.equal(receipt.method,method);
      // saveSheet retries may re-read data/name, but receipt identity/revisions
      // remain immutable and the native receipt precedes revision validation.
      if(domain!=='actors')assert.deepEqual(receipt.payload,payload);
      return clone(receipt.result);
    }
    await hooks.beforeNative?.(call);
    let result;
    if(domain==='dice') {
      const sides=Number(payload.expression.match(/d(\d+)/)?.[1]||6);
      const total=hooks.diceResult?await hooks.diceResult(call):sides===20?12:Math.min(sides,4);
      result={roll:{result:{value:{value:total}}}};
    } else if(domain==='actors') {
      const doc=resolve(payload.actorId,payload.tokenId);
      if(payload.version!==doc.version||payload.sheetVersion!==doc.sheetVersion)throw error('conflict');
      if(!hooks.canEdit)throw error('permission_denied');
      doc.data=clone(payload.data);doc.version++;doc.sheetVersion++;
      result={version:doc.version,sheetVersion:doc.sheetVersion};
    } else {
      if(payload.version!==native.version)throw error('conflict');
      if(method==='nextTurn') {
        if(!native.active)throw error('not_started');
        for(let n=0;n<native.combatants.length;n++) {
          if(++native.turn===native.combatants.length){native.turn=0;native.round++;}
          if(!native.combatants[native.turn].defeated)break;
        }
      } else if(method==='nextRound'){native.round++;native.turn=0;}
      else if(method==='previousTurn')native.turn=Math.max(0,native.turn-1);
      else if(method==='previousRound'){native.round=Math.max(1,native.round-1);native.turn=0;}
      else if(method==='start'){native.active=true;native.round=1;native.turn=0;native.encounterId='encounter-'+native.version;}
      else if(method==='stop'){native.active=false;native.round=0;native.turn=0;}
      else if(method==='setInitiative') {
        const entry=native.combatants.find(entry=>payload.tokenId?entry.token_id===payload.tokenId:entry.actor_id===payload.actorId&&!entry.token_id);
        if(!entry)throw error('not_found');
        const current=native.combatants[native.turn]?.id;
        entry.initiative=payload.value;
        const score=entry=>Number.isFinite(entry.initiative)?entry.initiative:-Infinity;
        native.combatants.sort((left,right)=>score(right)-score(left));
        native.turn=native.active?Math.max(0,native.combatants.findIndex(entry=>entry.id===current)):0;
      } else if(method==='setTurn') {
        const index=native.combatants.findIndex(entry=>payload.tokenId?entry.token_id===payload.tokenId:entry.actor_id===payload.actorId&&!entry.token_id);
        if(index<0)throw error('not_found');native.turn=index;
      } else if(method==='configure')native.config.formula=payload.formula;
      native.version++;result={nativeAction:method,...clone(native)};
    }
    receipts.set(requestId,{...call,result:clone(result)});accepted.push(call);
    await hooks.afterNative?.(call);return clone(result);
  }
  const managers=[];
  function client({user='gm',gm=true,compatibility={assertReady:async()=>{}}}={}) {
    const api={combat:{state:async()=>clone(native)},
      actors:{state:async()=>({is_gm:gm,players:[{id:'player'}],actors:[
        {id:'hero',permissions:{player:'owner'}},{id:'monster',permissions:{}}]}),
      sheet:async(actorId,{tokenId}={})=>{sheetReads.push({actorId,tokenId});return {...clone(resolve(actorId,tokenId)),canEdit:hooks.canEdit};},
      saveSheet:(payload,options)=>command('actors','saveSheet',payload,options)},
      tokens:{state:async()=>({tokens:clone(tokens)})},
      dice:{roll:(expression,options,receipt)=>command('dice','roll',{expression,...options},receipt)}};
    for(const method of ['nextTurn','nextRound','previousTurn','previousRound','start','stop','setInitiative','configure','toggle','remove','add','moveUp','moveDown','setTurn'])
      api.combat[method]=(payload,options)=>command('combat',method,payload,options);
    return {api,storage:{user:storage('user',user),table:storage('table',user)},compatibility};
  }
  function controller(options={}) {
    const value=createCombatController({...client(options),sceneId:'scene'});
    managers.push(value);return value;
  }
  return {controller,client,native,docs,tokens,hooks,maps,calls,accepted,receipts,managers,sheetReads,
    count:(domain,method)=>accepted.filter(call=>call.domain===domain&&call.method===method).length,
    public:()=>maps.table.get('combat.scene.scene')?.value,
    edit(id,change){const doc=docs.get(id);change(doc.data);doc.version++;doc.sheetVersion++;}};
}
