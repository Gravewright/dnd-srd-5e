import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatController} from '../combat-controller.js';
import {fixture,error} from './combat-fixture.mjs';

test('initiative uses returned combat revisions and refreshes a rejected CAS without rerolling',async()=>{
  const value=fixture(),client=value.client();let reads=0,actorReads=0,once=true;
  const read=client.api.combat.state,readActors=client.api.actors.state;
  client.api.combat.state=async(...args)=>{reads++;return read(...args);};
  client.api.actors.state=async(...args)=>{actorReads++;return readActors(...args);};
  value.hooks.beforeNative=call=>{if(once&&call.method==='setInitiative'){
    once=false;value.native.version++;
  }};
  await createCombatController({...client,sceneId:'scene'}).rollInitiative();
  const saves=value.calls.filter(call=>call.method==='setInitiative');
  assert.deepEqual(saves.map(call=>call.payload.version),[1,2,3]);
  assert.equal(new Set(saves.map(call=>call.requestId)).size,3);
  assert.equal(value.count('dice','roll'),2);
  assert.equal(value.count('combat','setInitiative'),2);
  assert.equal(reads,4,'Initial, rejected CAS, final selection, and final projection.');
  assert.equal(actorReads,1,'One authorization/library projection per initiative operation.');
  assert.equal(value.public().operation,null);
});

test('a recovered earlier initiative receipt cannot replace a newer encounter revision',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='setInitiative'){
    once=false;throw error('network');
  }};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  value.native.version+=5;
  await value.controller().resumePending();
  const saves=value.calls.filter(call=>call.method==='setInitiative');
  assert.deepEqual(saves.map(call=>call.payload.version),[1,1,7]);
  assert.equal(saves[0].requestId,saves[1].requestId);
  assert.equal(value.count('dice','roll'),2);
  assert.equal(value.count('combat','setInitiative'),2);
});

test('tracker projections reuse authorized event data, ignore older revisions and reject another scene',async()=>{
  const value=fixture(),client=value.client();let combatReads=0,actorReads=0;
  const read=client.api.combat.state,readActors=client.api.actors.state;
  client.api.combat.state=async(...args)=>{combatReads++;return read(...args);};
  client.api.actors.state=async(...args)=>{actorReads++;return readActors(...args);};
  const controller=createCombatController({...client,sceneId:'scene'});
  await controller.refresh();
  const projected=structuredClone(value.native);projected.version=3;projected.round=4;
  const actors=await readActors();
  assert.equal((await controller.refresh({state:projected,actors})).state.round,4);
  const stale=structuredClone(projected);stale.version=2;stale.round=2;
  assert.equal((await controller.refresh({state:stale,actors})).state.round,4);
  stale.encounterId='a-prior-encounter';
  assert.equal((await controller.refresh({state:stale,actors})).state.encounterId,projected.encounterId);
  assert.equal(combatReads,1);assert.equal(actorReads,1);
  await controller.refresh({state:{...projected,sceneId:'other'},actors});
  assert.equal(combatReads,2);
  assert.equal(value.calls.length,0,'Projection reuse does not execute commands.');
});

test('initiative bounds concurrent sheet reads and retains token-specific formulas in combat order',async()=>{
  const entries=Array.from({length:11},(_,index)=>({id:`participant-${index}`,actor_id:'hero',
    token_id:`participant-${index}`,initiative:null}));
  const value=fixture({entries}),client=value.client();let active=0,peak=0;
  value.native.config.formula='@init';
  value.tokens.push(...entries.map(entry=>({id:entry.token_id,actorId:'hero',independent:true,conditions:[]})));
  for(const [index,entry]of entries.entries())value.docs.set(entry.token_id,{...structuredClone(value.docs.get('hero')),
    tokenId:entry.token_id,data:{...structuredClone(value.docs.get('hero').data),init_misc:index}});
  const read=client.api.actors.sheet;
  client.api.actors.sheet=async(...args)=>{
    active++;peak=Math.max(peak,active);
    try {await new Promise(resolve=>setTimeout(resolve,args[1]?.tokenId.endsWith('0')?5:1));return await read(...args);}
    finally {active--;}
  };
  await createCombatController({...client,sceneId:'scene'}).rollInitiative();
  assert.equal(peak,4);assert.equal(active,0);
  assert.deepEqual(value.accepted.filter(call=>call.domain==='dice').map(call=>call.payload.expression),
    entries.map((entry,index)=>`(${index+3})`));
  assert.deepEqual(value.accepted.filter(call=>call.method==='setInitiative').map(call=>call.payload.tokenId),entries.map(entry=>entry.token_id));
  assert.equal(value.public().operation,null);
});

test('initiative recovers a lost newly created checkpoint using its stored UUID',async()=>{
  const value=fixture();let once=true,savedId;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key.includes('.step.')&&call.key.includes('.roll-')&&!call.value.done){
    once=false;savedId=call.value.requestId;throw error('network');
  }};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  assert.equal(value.count('dice','roll'),0);
  await value.controller().resumePending();
  assert.equal(value.accepted.find(call=>call.domain==='dice').requestId,savedId);
  assert.equal(value.count('dice','roll'),2);assert.equal(value.count('combat','setInitiative'),2);
  assert.equal(value.public().operation,null);
});

test('a lost initiative-plan response resumes the persisted plan without reloading sheets',async()=>{
  const value=fixture();let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key.includes('.operation.')&&call.value.initiative){
    once=false;throw error('network');
  }};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  assert.equal(value.count('dice','roll'),0);
  const reads=value.sheetReads.length;
  await value.controller().resumePending();
  assert.equal(value.sheetReads.length,reads);
  assert.equal(value.count('dice','roll'),2);assert.equal(value.count('combat','setInitiative'),2);
});

test('recovery accepts an older initiative journal with only individually registered checkpoints',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.domain==='dice'){once=false;throw error('network');}};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  const user=value.maps.users.get('gm'),journal=[...user].find(([key])=>key.includes('.operation.'))[1];
  journal.value.steps=journal.value.steps.filter(key=>user.has(key));
  assert.equal(journal.value.steps.length,1);
  await value.controller().resumePending();
  assert.equal(value.count('dice','roll'),2);assert.equal(value.count('combat','setInitiative'),2);
  assert.equal(value.count('combat','setTurn'),1);assert.equal(value.public().operation,null);
});

test('a next-turn CAS rejection rebuilds the effect plan from the freshly read encounter',async()=>{
  const value=fixture(),client=value.client();let reads=0,once=true;
  const read=client.api.combat.state;
  client.api.combat.state=async(...args)=>{reads++;return read(...args);};
  value.hooks.beforeNative=call=>{if(once&&call.method==='nextTurn'){
    once=false;value.native.turn=1;value.native.version++;
  }};
  await createCombatController({...client,sceneId:'scene'}).next();
  const attempts=value.calls.filter(call=>call.method==='nextTurn');
  assert.deepEqual(attempts.map(call=>call.payload.version),[1,2]);
  assert.equal(new Set(attempts.map(call=>call.requestId)).size,2);
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.native.turn,0);
  assert.equal(value.native.round,2);assert.equal(reads,3);
  assert.equal(value.sheetReads.length,4,'Both initial and rebased phases have their own frozen plan.');
});
