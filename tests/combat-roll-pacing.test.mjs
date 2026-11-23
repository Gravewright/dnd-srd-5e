import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatRollPacing} from '../combat-roll-pacing.js';
import {createCombatController} from '../combat-controller.js';
import {fixture,error} from './combat-fixture.mjs';

const NOW=1700000000000;
const flush=()=>new Promise(setImmediate);
async function until(predicate) {
  const deadline=performance.now()+5000;
  while(performance.now()<deadline){if(predicate())return;await flush();}
  assert.fail('Expected the pending operation to reach its wait.');
}
function session(date=NOW) {
  return {ok:true,headers:{get:()=>new Date(date).toUTCString()},
    json:async()=>({authenticated:true,account:{name:'Game Master',role:'owner'}})};
}
function harness(t,{history=[],signal,serverDate=NOW}={}) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  const value={history,reads:0,fetches:0,checks:0,calls:[],messages:new Map(),authorize:async()=>{value.checks++;}};
  value.api={context:{tableId:'table'},chat:{history:async()=>{value.reads++;return structuredClone(value.history);}}};
  value.pacing=createCombatRollPacing({api:value.api,signal,fetcher:async(path,options)=>{
    value.fetches++;assert.equal(path,'/api/auth/session');assert.equal(options.cache,'no-store');
    assert.equal(options.credentials,'same-origin');return session(serverDate);
  }});
  value.run=id=>value.pacing.run(id,async()=>{
    value.calls.push(id);
    if(value.messages.has(id))return value.messages.get(id);
    const message={id:`message-${id}`,from:{id:'gm'},at:Date.now()};
    value.messages.set(id,message);value.history.push(message);return message;
  },()=>value.authorize());
  value.tick=async milliseconds=>{for(let remaining=milliseconds;remaining>0;remaining-=Math.min(2000,remaining)){
    t.mock.timers.tick(Math.min(2000,remaining));await flush();
  }};
  return value;
}

test('twenty cold rolls proceed immediately; forty rolls respect the host window',async t=>{
  const value=harness(t);
  for(let index=0;index<20;index++)await value.run(`roll-${index}`);
  assert.equal(Date.now(),NOW);assert.equal(value.calls.length,20);
  let done=false;
  const rest=(async()=>{for(let index=20;index<40;index++)await value.run(`roll-${index}`);done=true;})();
  await flush();assert.equal(done,false);assert.equal(value.calls.length,20);
  await value.tick(8000);assert.equal(value.calls.length,20);
  await value.tick(2000);await rest;
  assert.equal(value.calls.length,40);assert.equal(Date.now(),NOW+10000);
  assert.equal(value.reads,1);assert.equal(value.fetches,1);
});

test('a second rapid batch retains its own allowance after visible chat was cleared',async t=>{
  const value=harness(t);
  for(let index=0;index<20;index++)await value.run(`first-${index}`);
  value.history=[];value.pacing.start();
  const pending=value.run('second');await flush();
  assert.equal(value.calls.length,20);assert.equal(value.reads,2);assert.equal(value.fetches,1);
  await value.tick(10000);await pending;
  assert.equal(value.calls.length,21);
});

test('a new controller seeds visible history until its first own roll, with a bounded clock-skew wait',async t=>{
  const history=Array.from({length:20},(_,index)=>({id:`old-${index}`,from:{id:'gm'},at:NOW+60000}));
  const value=harness(t,{history,serverDate:NOW+60000});
  value.history.push(...Array.from({length:20},(_,index)=>({id:`other-${index}`,from:{id:'other'},at:NOW+1000000})));
  const pending=value.run('next');await flush();assert.equal(value.calls.length,0);
  await value.tick(10000);await pending;assert.equal(value.calls.length,1);
  assert.equal(Date.now(),NOW+10000,'Skewed/future timestamps cannot cause an indefinite wait.');
});

test('the first own roll identifies the author and later history ignores other participants',async t=>{
  const history=Array.from({length:19},(_,index)=>({id:`other-${index}`,from:{id:'other'},at:NOW}));
  const value=harness(t,{history});
  await value.run('first');assert.equal(Date.now(),NOW);
  value.history.push({id:'other-20',from:{id:'other'},at:NOW});value.pacing.start();
  for(let index=1;index<20;index++)await value.run(`own-${index}`);
  assert.equal(Date.now(),NOW);assert.equal(value.calls.length,20);
  assert.equal(value.fetches,1);assert.equal(value.reads,2);
});

test('replaying an accepted UUID neither waits for another slot nor consumes a new slot',async t=>{
  const value=harness(t);
  for(let index=0;index<20;index++)await value.run(`roll-${index}`);
  await value.run('roll-0');assert.equal(value.messages.size,20);assert.equal(Date.now(),NOW);
  const pending=value.run('new');await flush();assert.equal(value.messages.size,20);
  await value.tick(10000);await pending;assert.equal(value.messages.size,21);
});

test('cancellation and reservation revocation stop a pending allowance wait before another roll',async t=>{
  const abort=new AbortController(),value=harness(t,{signal:abort.signal});
  for(let index=0;index<20;index++)await value.run(`roll-${index}`);
  const pending=value.run('cancelled'),rejected=assert.rejects(pending,{code:'cancelled'});
  await flush();abort.abort();await rejected;
  await value.tick(10000);assert.equal(value.calls.length,20);
});

test('the public reservation is rechecked while a long allowance wait is pending',async t=>{
  const value=harness(t);
  for(let index=0;index<20;index++)await value.run(`roll-${index}`);
  const pending=value.run('stopped'),rejected=assert.rejects(pending,{code:'combat.operationBusy'});
  await flush();value.authorize=async()=>{throw error('combat.operationBusy');};
  await value.tick(2000);await rejected;assert.equal(value.calls.length,20);
});

test('quota retries retain one persisted UUID and generic validation failures are never retried',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  const value=fixture(),client=value.client();let failures=2;
  value.hooks.beforeNative=call=>{if(call.domain==='dice'&&failures-->0)throw Object.assign(error('invalid_data'),{message:'too_many_messages'});};
  const controller=createCombatController({...client,sceneId:'scene'}),pending=controller.rollInitiative('one',value.native.combatants[0]);
  await until(()=>value.calls.filter(call=>call.domain==='dice').length===1);
  for(let index=0;index<2;index++){t.mock.timers.tick(2000);await flush();}
  await pending;
  const attempts=value.calls.filter(call=>call.domain==='dice');
  assert.equal(attempts.length,3);assert.equal(new Set(attempts.map(call=>call.requestId)).size,1);
  assert.equal(value.count('dice','roll'),1);assert.equal(value.count('combat','setInitiative'),1);
  const invalid=fixture();invalid.hooks.beforeNative=call=>{if(call.domain==='dice')throw error('invalid_data');};
  await assert.rejects(invalid.controller().rollInitiative(),{code:'invalid_data'});
  assert.equal(invalid.calls.filter(call=>call.domain==='dice').length,1);
});

test('quota waiting keeps checkpoints recoverable after abort and stops after a foreign GM Stop',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  const value=fixture(),client=value.client(),abort=new AbortController();let once=true;
  value.hooks.beforeNative=call=>{if(once&&call.domain==='dice'){once=false;throw error('too_many_messages');}};
  const controller=createCombatController({...client,sceneId:'scene',signal:abort.signal});
  const pending=controller.rollInitiative('one',value.native.combatants[0]),rejected=assert.rejects(pending,{code:'cancelled'});
  await until(()=>value.calls.some(call=>call.domain==='dice'));abort.abort();await rejected;
  const requestId=value.calls.find(call=>call.domain==='dice').requestId;
  assert.ok(value.public().operation);
  await value.controller().resumePending();
  assert.equal(value.calls.filter(call=>call.domain==='dice').every(call=>call.requestId===requestId),true);
  assert.equal(value.count('dice','roll'),1);

  const stopped=fixture();stopped.hooks.beforeNative=call=>{if(call.domain==='dice')throw error('too_many_messages');};
  const running=stopped.controller().rollInitiative(),failed=assert.rejects(running,{code:'combat.operationBusy'});
  await until(()=>stopped.calls.some(call=>call.domain==='dice'));
  await stopped.controller({user:'other-gm'}).stop();
  t.mock.timers.tick(2000);await failed;
  assert.equal(stopped.calls.filter(call=>call.domain==='dice').length,1);
  assert.equal(stopped.count('dice','roll'),0);assert.equal(stopped.count('combat','stop'),1);
});

test('persistent explicit quota responses stop after ten seconds without replacing the UUID',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  const value=fixture();value.hooks.beforeNative=call=>{if(call.domain==='dice')throw error('too_many_messages');};
  const pending=value.controller().rollInitiative(),rejected=assert.rejects(pending,{code:'too_many_messages'});
  await until(()=>value.calls.some(call=>call.domain==='dice'));
  for(let index=0;index<5;index++){t.mock.timers.tick(2000);await flush();}
  await rejected;
  const attempts=value.calls.filter(call=>call.domain==='dice');
  assert.equal(attempts.length,6);assert.equal(new Set(attempts.map(call=>call.requestId)).size,1);
  assert.equal(value.count('dice','roll'),0);assert.ok(value.public().operation);
});

test('a quota wait revalidates GM status and campaign membership before another dice request',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  for(const reason of ['demoted','membership-removed']) {
    const value=fixture(),client=value.client();let revoked=false,reads=0;
    const read=client.api.actors.state;
    client.api.actors.state=async()=>{reads++;return {...await read(),is_gm:!revoked};};
    value.hooks.beforeNative=call=>{if(call.domain==='dice')throw error('too_many_messages');};
    value.hooks.storage=call=>{if(revoked&&reason==='membership-removed'&&call.scope==='table'&&call.method==='get')throw error('permission_denied');};
    const controller=createCombatController({...client,sceneId:'scene'});
    const pending=controller.rollInitiative(),rejected=assert.rejects(pending,{code:'permission_denied'});
    await until(()=>value.calls.some(call=>call.domain==='dice'));
    assert.equal(reads,1,'Cold execution does not add a permission/library read per die.');
    revoked=true;t.mock.timers.tick(2000);await rejected;
    assert.equal(reads,2,'Waiting revalidates authorization before resuming.');
    assert.equal(value.calls.filter(call=>call.domain==='dice').length,1);
    assert.equal(value.count('dice','roll'),0);assert.ok(value.public().operation);
    if(reason==='demoted')assert.equal(controller.snapshot().isGM,false);
  }
});
