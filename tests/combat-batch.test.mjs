import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,error} from './combat-fixture.mjs';
import {createCombatController} from '../combat-controller.js';

const batches=value=>value.calls.filter(call=>call.method==='rollInitiativeBatch');

test('native batch freezes DnD preparation, source revisions and hidden audiences in one command',async()=>{
  const entries=[{id:'linked',actor_id:'hero',token_id:'linked'},
    {id:'twin',actor_id:'hero',token_id:'twin'},
    {id:'snapshot',actor_id:'hero',token_id:'snapshot'},
    {id:'enemy',actor_id:'monster',token_id:'enemy'}];
  const value=fixture({batch:true,entries,data:{monster:{rulesEdition:'2024',exhaustion:2}}});
  value.tokens.push({id:'twin',actorId:'hero',conditions:[],version:8,linkMode:'linked'});
  value.tokens[0].conditions=[{code:'poisoned'}];value.tokens[0].version=5;
  value.tokens[2].conditions=[{code:'invisible'}];value.tokens[2].hidden=true;
  value.docs.get('snapshot').data.init_misc=4;
  await value.controller().rollInitiative();
  const [call]=batches(value);assert.equal(batches(value).length,1);
  assert.equal(call.payload.selectFirst,true);assert.equal(call.payload.version,1);
  assert.deepEqual(call.payload.entries.map(entry=>entry.tokenId),entries.map(entry=>entry.token_id));
  assert.match(call.payload.entries[0].expression,/2d20kl1/);
  assert.match(call.payload.entries[1].expression,/1d20/);
  assert.match(call.payload.entries[2].expression,/\(7\)/);
  assert.match(call.payload.entries[3].expression,/2d20kh1.*- 4/);
  assert.deepEqual(call.payload.entries.map(entry=>entry.visibility),['public','public','public','gm']);
  assert.deepEqual(call.payload.entries[0].source,{actorVersion:1,sheetVersion:1,tokenVersion:5});
  assert.deepEqual(call.payload.entries[1].source,{actorVersion:1,sheetVersion:1,tokenVersion:8});
  assert.equal(value.sheetReads.length,3,'Two linked tokens share one fresh actor read; the independent snapshot stays separate.');
  assert.equal(value.count('dice','roll'),0);assert.equal(value.count('combat','setInitiative'),0);
  assert.equal(value.count('combat','setTurn'),0);assert.equal(value.native.version,2);
  assert.equal(value.public().operation,null);
});

test('batch scopes keep their selected targets and only all selects the first participant',async()=>{
  for(const scope of ['all','missing','npcs','one']) {
    const value=fixture({batch:true});value.native.combatants[1].initiative=null;
    const expected=scope==='all'?['linked','enemy']:['enemy'];
    await value.controller().rollInitiative(scope,value.native.combatants[1]);
    assert.deepEqual(batches(value)[0].payload.entries.map(entry=>entry.tokenId),expected);
    assert.equal(batches(value)[0].payload.selectFirst,scope==='all');
  }
});

test('batch recovery reuses one durable UUID after lost writes, replies and completion',async()=>{
  for(const boundary of ['prepared','response','checkpoint-before','checkpoint-after','completion-before','completion-after']) {
    const value=fixture({batch:true});let once=true,draws=0,frozen;
    value.hooks.diceResult=()=>++draws;
    value.hooks.afterNative=call=>{
      if(once&&boundary==='response'&&call.method==='rollInitiativeBatch'){
        once=false;throw error('network');
      }
    };
    value.hooks.storage=call=>{
      if(call.method!=='set')return;
      if(call.key.endsWith('.initiative-batch')&&!call.value.done)frozen=structuredClone(call.value);
      const selected=boundary==='prepared'&&call.key.endsWith('.initiative-batch')&&!call.value.done&&call.when==='after'
        ||boundary.startsWith('checkpoint-')&&call.key.endsWith('.initiative-batch')&&call.value.done&&call.when===boundary.slice(11)
        ||boundary.startsWith('completion-')&&call.scope==='table'&&call.value.completed?.length&&call.when===boundary.slice(11);
      if(once&&selected){once=false;throw error('network');}
    };
    await assert.rejects(value.controller().rollInitiative(),{code:'network'},boundary);
    await value.controller().resumePending();
    assert.equal(value.count('combat','rollInitiativeBatch'),1,boundary);
    assert.equal(draws,2,boundary);
    for(const call of batches(value)) {
      assert.equal(call.requestId,frozen.requestId,boundary);
      assert.deepEqual(call.payload,frozen.payload,boundary);
    }
    assert.equal(value.public().operation,null,boundary);
    assert.equal(value.count('dice','roll'),0,boundary);
  }
});

test('a batch source conflict reloads all preparation before allocating a new command UUID',async()=>{
  const value=fixture({batch:true});let once=true,draws=0;
  value.hooks.diceResult=()=>++draws;
  value.hooks.beforeNative=call=>{if(once&&call.method==='rollInitiativeBatch'){
    once=false;value.edit('hero',data=>{data.abilities.dex.score=20;});
    value.tokens[0].version++;value.native.version++;
  }};
  await value.controller().rollInitiative();
  const calls=batches(value);assert.equal(calls.length,2);
  assert.notEqual(calls[0].requestId,calls[1].requestId);
  assert.match(calls[0].payload.entries[0].expression,/\(3\)/);
  assert.match(calls[1].payload.entries[0].expression,/\(5\)/);
  assert.deepEqual(calls[1].payload.entries[0].source,{actorVersion:2,sheetVersion:2,tokenVersion:2});
  assert.equal(calls[1].payload.version,2);assert.equal(draws,2);
  assert.equal(value.count('combat','rollInitiativeBatch'),1);
});

test('an old pending initiative journal finishes through legacy APIs even when batch becomes available',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.domain==='dice'){once=false;throw error('network');}};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  for(const [key,record]of value.maps.users.get('gm'))if(key.includes('.operation.'))delete record.value.initiativeTransport;
  await value.controller({batch:true}).resumePending();
  assert.equal(batches(value).length,0);assert.equal(value.count('dice','roll'),2);
  assert.equal(value.count('combat','setInitiative'),2);assert.equal(value.public().operation,null);
});

test('an accepted batch never falls back to legacy after a host downgrade',async()=>{
  const value=fixture({batch:true});let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='rollInitiativeBatch'){once=false;throw error('network');}};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  await assert.rejects(value.controller({batch:false}).resumePending(),{code:'unavailable'});
  assert.equal(value.count('combat','rollInitiativeBatch'),1);assert.equal(value.count('dice','roll'),0);
  assert.ok(value.public().operation);
  await value.controller().resumePending();assert.equal(value.public().operation,null);
});

test('batch keeps pause, GM authorization and Stop cancellation gates',async()=>{
  const paused=fixture({batch:true}),controller=paused.controller();await controller.pause();
  await assert.rejects(controller.rollInitiative(),{code:'combat.pausedError'});
  assert.equal(batches(paused).length,0);
  const player=fixture({batch:true});
  await assert.rejects(player.controller({gm:false,user:'player'}).rollInitiative(),{code:'permission_denied'});
  assert.equal(batches(player).length,0);
  const stopped=fixture({batch:true});let once=true;
  stopped.hooks.storage=async call=>{
    if(once&&call.when==='after'&&call.key.endsWith('.initiative-batch')&&!call.value.done){
      once=false;await stopped.controller({user:'other-gm'}).stop();
    }
  };
  await assert.rejects(stopped.controller().rollInitiative(),{code:'combat.operationBusy'});
  assert.equal(batches(stopped).length,0);assert.equal(stopped.native.active,false);
  assert.equal(stopped.public().operation,null);
});

test('an empty batch scope completes without issuing an invalid native batch',async()=>{
  for(const scope of ['all','missing']) {
    const value=fixture({batch:true,...(scope==='all'?{entries:[]}:{})});
    await value.controller().rollInitiative(scope);
    assert.equal(batches(value).length,0);assert.equal(value.public().operation,null);
  }
});

test('a later batch reads current sheets instead of reusing the previous preparation',async()=>{
  const value=fixture({batch:true});await value.controller().rollInitiative();
  value.edit('hero',data=>{data.abilities.dex.score=20;});value.tokens[0].version++;
  await value.controller().rollInitiative();
  assert.equal(value.sheetReads.length,4);
  assert.match(batches(value)[1].payload.entries[0].expression,/\(5\)/);
});

test('the accepted batch projection releases controls without a redundant combat read',async()=>{
  const value=fixture({batch:true}),client=value.client();let reads=0;
  const read=client.api.combat.state;client.api.combat.state=async(...args)=>{reads++;return read(...args);};
  const result=await createCombatController({...client,sceneId:'scene'}).rollInitiative();
  assert.equal(reads,1);assert.equal(result.state.version,value.native.version);
  assert.equal(result.tracker.operation,null);
  assert.equal(value.maps.users.get('gm').get('combat.scene.scene.intent').value.confirmed,true);
});

test('a stored batch checkpoint cannot replace a fresher combat projection during recovery',async()=>{
  const value=fixture({batch:true});let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key.endsWith('.initiative-batch')&&call.value.done){
    once=false;throw error('network');
  }};
  await assert.rejects(value.controller().rollInitiative(),{code:'network'});
  value.native.version+=5;value.native.round=9;
  const result=await value.controller().resumePending();
  assert.equal(result.state.version,value.native.version);assert.equal(result.state.round,9);
  assert.equal(batches(value).length,1,'The completed checkpoint does not call the batch again.');
});

test('a stale batch completion CAS cannot clear a concurrent Stop reservation',async()=>{
  const value=fixture({batch:true});let once=true;
  value.hooks.storage=call=>{if(once&&call.scope==='table'&&call.when==='before'&&call.value.completed?.length){
    once=false;
    const record=value.maps.table.get('combat.scene.scene');
    record.value.stopping={id:'another-stop',owner:'another-owner'};record.revision='concurrent-stop';
  }};
  await assert.rejects(value.controller().rollInitiative(),{code:'combat.operationBusy'});
  assert.equal(value.count('combat','rollInitiativeBatch'),1);
  assert.equal(value.public().stopping.id,'another-stop');
  assert.ok(value.public().operation);
});
