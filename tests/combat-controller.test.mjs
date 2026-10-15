import test from 'node:test';
import assert from 'node:assert/strict';
import {combatPhases} from '../combat-controller.js';
import {fixture,error,duration,periodic} from './combat-fixture.mjs';

test('forward phases include defeated skips, boundary clocks and no periodic round skips',()=>{
  const value=fixture();value.native.combatants.splice(1,0,{id:'skipped',defeated:true});
  const next=combatPhases(value.native,'nextTurn');
  assert.deepEqual(next.map(row=>[row.phase,row.entry.id,row.periodic]),
    [['end','linked',false],['start','skipped',false],['end','skipped',false],['start','enemy',true]]);
  assert.equal(combatPhases(value.native,'previousTurn').length,0);
  assert.equal(combatPhases(value.native,'nextRound').every(row=>!row.periodic),true);
  value.native.turn=2;assert.equal(combatPhases(value.native,'nextTurn').at(-1).roundBoundary,true);
});

test('documents without eligible effects avoid actor saves and private effect checkpoints',async()=>{
  const value=fixture(),keys=[],plans=[];
  value.hooks.storage=call=>{if(call.when==='before'&&call.method==='set'&&call.scope==='user'){
    keys.push(call.key);if(call.value.plans?.command)plans.push(structuredClone(call.value.plans.command));
  }};
  await value.controller().next();
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('actors','saveSheet'),0);
  assert.equal(value.count('dice','roll'),0);assert.equal(keys.some(key=>key.includes('effects-')),false);
  assert.equal(value.sheetReads.length,2,'Only the two frozen-plan reads are needed.');
  assert.ok(plans.length);assert.equal(plans.every(plan=>plan.documents.length===0),true);
});

test('public journal kinds never reveal private targets, payloads or initiative formulas',async()=>{
  for(const initiative of [false,true]){
    const secret='hidden-combatant-private-id',value=fixture({entries:[{id:secret,actor_id:'monster',token_id:'enemy',hidden:true}]}),controller=value.controller();
    let once=true;
    value.hooks.afterNative=()=>{if(once){once=false;throw error('network');}};
    const action=()=>initiative?controller.rollInitiative('one',value.native.combatants[0]):controller.execute('toggle',{tokenId:secret,hidden:true,note:'Private authored payload'});
    await assert.rejects(action(),{code:'network'});
    assert.equal(value.public().operation.kind,initiative?'initiative-one':'native-toggle');
    assert.deepEqual(Object.keys(value.public().operation).sort(),['id','kind','owner']);
    const publicText=JSON.stringify(value.public());
    assert.equal(publicText.includes(secret),false);assert.equal(publicText.includes('Private authored payload'),false);
    assert.equal(publicText.includes('1d20'),false);
    const intent=value.maps.users.get('gm').get('combat.scene.scene.intent').value;
    assert.ok(JSON.stringify(intent).includes(secret),'Private recovery intent retains the selected target.');
    await value.controller().resumePending();
    assert.equal(JSON.stringify(value.public()).includes(secret),false);
  }
});

test('a rejected native Previous releases its own reservation so a valid Next can proceed',async()=>{
  for(const code of ['invalid_data','invalid_input','invalid','forbidden','not_found','permission_denied']){
    const value=fixture(),controller=value.controller();let once=true;
    value.hooks.beforeNative=call=>{if(once&&call.method==='previousTurn'){once=false;throw error(code);}};
    await assert.rejects(controller.previous(),{code});
    assert.equal(value.count('combat','previousTurn'),0);assert.equal(value.public().operation,null);
    assert.equal(value.public().completed.at(-1).cancelled,true);
    await controller.next();assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.native.turn,1);
  }
});

test('post-acceptance storage validation or quota failures retain recovery instead of cancelling the turn',async()=>{
  for(const code of ['invalid_input','invalid','invalid_data','quota']){
    const value=fixture();let once=true;
    value.hooks.storage=call=>{if(once&&call.when==='before'&&call.value?.done&&call.value.result?.nativeAction==='nextTurn'){
      once=false;throw error(code);
    }};
    await assert.rejects(value.controller().next(),{code});
    assert.equal(value.count('combat','nextTurn'),1);assert.ok(value.public().operation);
    assert.equal(value.public().completed?.length||0,0);
    await value.controller().resumePending();
    assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.public().operation,null);
    assert.equal(new Set(value.calls.filter(call=>call.method==='nextTurn').map(call=>call.requestId)).size,1);
  }
});

test('invalid actor or dice steps after an accepted turn retain the pending phases for explicit retry',async()=>{
  for(const domain of ['actors','dice']){
    const value=fixture({data:{monster:{effects:[periodic()]}}});let once=true;
    value.hooks.beforeNative=call=>{if(once&&call.domain===domain){once=false;throw error('invalid');}};
    await assert.rejects(value.controller().next(),{code:'invalid'});
    assert.equal(value.count('combat','nextTurn'),1);assert.ok(value.public().operation);
    assert.equal(value.docs.get('monster').data.bars.bar_1.value,20);
    await value.controller().resumePending();
    assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('dice','roll'),1);
    assert.equal(value.count('actors','saveSheet'),1);assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);
  }
});

test('a lost native turn response replays its UUID and applies clocks once',async()=>{
  const value=fixture({data:{monster:{effects:[duration(),periodic()]}}}),controller=value.controller();
  let lost=true;value.hooks.afterNative=call=>{if(call.method==='nextTurn'&&lost){lost=false;throw error('network');}};
  await assert.rejects(controller.next(),{code:'network'});assert.equal(value.native.turn,1);
  await controller.next();assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('dice','roll'),1);
  assert.equal(value.docs.get('monster').data.effects[0].data.duration.remaining,2);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);assert.equal(value.public().operation,null);
});

test('native accepted plus checkpoint CAS failure keeps the same native UUID',async()=>{
  for(const method of ['nextTurn','roll']) {
    const value=fixture(),controller=value.controller();let once=true;
    value.hooks.storage=call=>{
      if(once&&call.when==='before'&&call.value?.done&&
        (method==='roll'?call.value.result?.roll:call.value.result?.nativeAction==='nextTurn')) {
        once=false;throw error('conflict');
      }
    };
    const action=()=>method==='roll'?controller.rollInitiative('one',value.native.combatants[0]):controller.next();
    await assert.rejects(action(),{code:'conflict'});await action();
    assert.equal(value.count(method==='roll'?'dice':'combat',method),1);
    const calls=value.calls.filter(call=>call.method===method);assert.equal(new Set(calls.map(call=>call.requestId)).size,1);
  }
});

test('a lost sheet response never repeats periodic damage or a frozen roll',async()=>{
  const value=fixture({data:{monster:{effects:[duration(),periodic()]}}}),controller=value.controller();let lost=true;
  value.hooks.afterNative=call=>{if(call.domain==='actors'&&lost){lost=false;throw error('network');}};
  await assert.rejects(controller.next(),{code:'network'});
  await value.controller().resumePending();assert.equal(value.count('combat','nextTurn'),1);
  assert.equal(value.count('actors','saveSheet'),1);assert.equal(value.count('dice','roll'),1);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);
});

test('actor CAS rebases note edits with frozen dice but binds changed formulas to new facts',async()=>{
  for(const changedFormula of [false,true]) {
    const value=fixture({data:{monster:{effects:[periodic()]}}}),controller=value.controller();let once=true;
    value.hooks.beforeNative=call=>{
      if(call.domain==='actors'&&once){once=false;value.edit('monster',data=>{
        data.notes='Preserved concurrent edit';if(changedFormula)data.effects[0].data.modifiers[0].value='1d20';
      });}
    };
    await controller.next();
    assert.equal(value.count('dice','roll'),changedFormula?2:1);
    const rolls=value.accepted.filter(call=>call.domain==='dice');
    assert.deepEqual(rolls.map(call=>call.payload.expression),changedFormula?['1d6','1d20']:['1d6']);
    assert.equal(new Set(rolls.map(call=>call.requestId)).size,rolls.length);
    assert.equal(value.docs.get('monster').data.notes,'Preserved concurrent edit');
    assert.equal(value.docs.get('monster').data.bars.bar_1.value,changedFormula?8:16);
  }
});

test('a native dice 503 after acceptance resumes the same random fact after remount',async()=>{
  const value=fixture({data:{monster:{effects:[duration(),periodic()]}}});let once=true;
  value.hooks.afterNative=call=>{if(call.domain==='dice'&&once){once=false;throw error('unavailable');}};
  await assert.rejects(value.controller().next(),{code:'unavailable'});
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,20);
  await value.controller().resumePending();
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('dice','roll'),1);
  assert.equal(new Set(value.calls.filter(call=>call.domain==='dice').map(call=>call.requestId)).size,1);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);
  assert.equal(value.docs.get('monster').data.effects[0].data.duration.remaining,2);
});

test('a lost newly stored native step is recovered before issuing any native command',async()=>{
  const value=fixture({data:{monster:{effects:[periodic(3)]}}});let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key.includes('.step.')&&call.key.endsWith('.command')&&!call.value.done){
    once=false;throw error('network');
  }};
  await assert.rejects(value.controller().next(),{code:'network'});assert.equal(value.count('combat','nextTurn'),0);
  const stored=[...value.maps.users.get('gm')].find(([key])=>key.includes('.step.'))[1].value.requestId;
  await value.controller().resumePending();
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.accepted.find(call=>call.method==='nextTurn').requestId,stored);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,17);
});

test('an accepted sheet plus lost checkpoint confirmation cannot apply periodic damage twice',async()=>{
  for(const when of ['before','after']){
    const value=fixture({data:{monster:{effects:[duration(),periodic()]}}});let once=true;
    value.hooks.storage=call=>{if(once&&call.when===when&&call.value?.done&&call.value.result?.sheetVersion){
      once=false;throw error('conflict');
    }};
    await assert.rejects(value.controller().next(),{code:'conflict'});
    assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);
    await value.controller().resumePending();
    assert.equal(value.count('actors','saveSheet'),1);assert.equal(value.count('dice','roll'),1);
    assert.equal(value.docs.get('monster').data.effects[0].data.duration.remaining,2);
    assert.equal(value.docs.get('monster').data.bars.bar_1.value,16);
  }
});

test('lost public completion acknowledgment does not replay work or clear a later GM operation',async()=>{
  const value=fixture(),one=value.controller(),two=value.controller({user:'other-gm'});let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.scope==='table'&&call.value.operation===null&&call.value.completed?.length){
    once=false;throw error('network');
  }};
  await assert.rejects(one.next(),{code:'network'});assert.equal(value.count('combat','nextTurn'),1);
  let leavePending=true;
  value.hooks.afterNative=call=>{if(call.method==='nextTurn'&&leavePending){leavePending=false;throw error('network');}};
  await assert.rejects(two.next(),{code:'network'});
  const pending=structuredClone(value.public().operation);
  await one.resumePending();
  assert.deepEqual(value.public().operation,pending);assert.equal(value.count('combat','nextTurn'),2);
  await two.resumePending();assert.equal(value.count('combat','nextTurn'),2);
});

test('a recovered command with no durable effect plan fails closed without guessing clocks',async()=>{
  const value=fixture({data:{monster:{effects:[periodic()]}}});let once=true;
  value.hooks.afterNative=call=>{if(call.method==='nextTurn'&&once){once=false;throw error('network');}};
  await assert.rejects(value.controller().next(),{code:'network'});
  const journal=[...value.maps.users.get('gm')].find(([key])=>key.includes('.operation.'))[1];
  journal.value.plans={};
  await assert.rejects(value.controller().resumePending(),{code:'combat.missingPlan'});
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('dice','roll'),0);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,20);assert.ok(value.public().operation);
});

test('linked actors deduplicate owner clocks while independent snapshots keep separate effects',async()=>{
  const value=fixture({entries:[{id:'linked',actor_id:'hero',token_id:'linked'},
    {id:'actor',actor_id:'hero',token_id:null,defeated:true},{id:'snapshot',actor_id:'hero',token_id:'snapshot'}],
    data:{hero:{effects:[duration(),periodic(3)]}}});
  await value.controller().next();
  assert.equal(value.docs.get('hero').data.effects[0].data.duration.remaining,2);
  assert.equal(value.docs.get('hero').data.bars.bar_1.value,20);
  assert.equal(value.docs.get('snapshot').data.effects[0].data.duration.remaining,2);
  assert.equal(value.docs.get('snapshot').data.bars.bar_1.value,17);
});

test('backward and manual turn commands never tick effects, nextRound advances only explicit clocks',async()=>{
  const value=fixture({data:{hero:{effects:[duration(),periodic(3)]},monster:{effects:[duration(),periodic(3)]}}});
  const controller=value.controller();await controller.previous();await controller.execute('setTurn',{tokenId:'enemy'});
  assert.equal(value.docs.get('hero').data.effects[0].data.duration.remaining,undefined);
  await controller.nextRound();assert.equal(value.docs.get('hero').data.effects[0].data.duration.remaining,2);
  assert.equal(value.docs.get('hero').data.bars.bar_1.value,20);assert.equal(value.docs.get('monster').data.bars.bar_1.value,20);
});

test('initiative respects scopes, canonical conditions, editions and hidden privacy',async()=>{
  const value=fixture({data:{hero:{exhaustion:1},monster:{rulesEdition:'2024',exhaustion:2}}});
  value.tokens[2].conditions=[{code:'invisible'}];value.tokens[2].hidden=true;
  const controller=value.controller();await controller.rollInitiative('npcs');
  let rolls=value.accepted.filter(call=>call.domain==='dice');assert.equal(rolls.length,1);
  assert.match(rolls[0].payload.expression,/2d20kh1/);assert.match(rolls[0].payload.expression,/- 4/);
  assert.equal(rolls[0].payload.visibility,'gm');
  value.native.combatants[0].initiative=null;await controller.rollInitiative('missing');
  rolls=value.accepted.filter(call=>call.domain==='dice');assert.equal(rolls.length,2);
  assert.match(rolls[1].payload.expression,/2d20kl1/);assert.equal(rolls[1].payload.visibility,'public');
});

test('public operation reservations block other GMs until the owner recovers',async()=>{
  const value=fixture(),one=value.controller(),two=value.controller({user:'other-gm'});let once=true;
  value.hooks.afterNative=call=>{if(call.method==='nextTurn'&&once){once=false;throw error('network');}};
  await assert.rejects(one.next());await assert.rejects(two.next(),{code:'combat.operationBusy'});
  await one.next();await two.next();assert.equal(value.count('combat','nextTurn'),2);
});

test('simultaneous GM claims advance once and never share another owner private journal',{timeout:2000},async()=>{
  const value=fixture(),one=value.controller(),two=value.controller({user:'other-gm'});
  let arrivals=0,release;const gate=new Promise(resolve=>{release=resolve;});
  value.hooks.storage=async call=>{if(call.when==='before'&&call.scope==='table'&&call.value.operation){
    if(++arrivals===2)release();await gate;
  }};
  const results=await Promise.allSettled([one.next(),two.next()]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'combat.operationBusy');
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.public().operation,null);
  assert.equal(value.public().completed.length,1);
});

test('GM-only phases and legacy guard do not block owners from editing their resources',async()=>{
  const value=fixture(),player=value.controller({user:'player',gm:false}),blocked=value.controller({
    compatibility:{assertReady:async()=>{throw error('legacy-server-active');}}});
  await assert.rejects(player.next(),{code:'permission_denied'});
  await assert.rejects(blocked.next(),{code:'legacy-server-active'});
  await player.setResource(value.native.combatants[0],'bar_1','-3');assert.equal(value.docs.get('hero').data.bars.bar_1.value,17);
  assert.equal(value.count('combat','nextTurn'),0);
});

test('pause blocks advancement, and Stop retries the same native UUID after lost checkpoints',async()=>{
  const value=fixture(),controller=value.controller();await controller.pause();
  await assert.rejects(controller.next(),{code:'combat.pausedError'});await controller.resume();
  let once=true;value.hooks.afterNative=call=>{if(call.method==='stop'&&once){once=false;throw error('network');}};
  await assert.rejects(controller.stop(),{code:'network'});assert.equal(value.public().stopping!==null,true);
  await assert.rejects(value.controller({user:'other'}).start(),{code:'combat.operationBusy'});
  await controller.stop();assert.equal(value.count('combat','stop'),1);assert.equal(value.public().stopping,null);
});

test('Stop completion storage failure replays completion without cancelling a new operation',async()=>{
  const value=fixture(),controller=value.controller();let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='before'&&call.key==='combat.scene.scene.stop'&&call.value.confirmed){once=false;throw error('conflict');}};
  await assert.rejects(controller.stop(),{code:'conflict'});
  await value.controller({user:'other'}).start();const version=value.native.version;
  await value.controller().retry();assert.equal(value.native.active,true);assert.equal(value.native.version,version);
  assert.equal(value.count('combat','stop'),1);
});

test('remounted Retry resumes a lost Stop response with its original native UUID',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='stop'){once=false;throw error('unavailable');}};
  await assert.rejects(value.controller().stop(),{code:'unavailable'});
  await value.controller().retry();
  assert.equal(value.count('combat','stop'),1);
  assert.equal(new Set(value.calls.filter(call=>call.method==='stop').map(call=>call.requestId)).size,1);
  assert.equal(value.native.active,false);assert.equal(value.public().stopping,null);
});

test('simultaneous GM Stop reservations accept one native Stop',{timeout:2000},async()=>{
  const value=fixture();let arrivals=0,release;const gate=new Promise(resolve=>{release=resolve;});
  value.hooks.storage=async call=>{if(call.when==='before'&&call.scope==='table'&&call.value.stopping){
    if(++arrivals===2)release();await gate;
  }};
  const results=await Promise.allSettled([value.controller().stop(),value.controller({user:'other-gm'}).stop()]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'combat.operationBusy');
  assert.equal(value.count('combat','stop'),1);assert.equal(value.native.active,false);
});

test('Stop cancels its observed pending operation and remount Retry cannot replay cancelled clocks',async()=>{
  const value=fixture({data:{monster:{effects:[periodic()]}}});let once=true;
  value.hooks.afterNative=call=>{if(call.method==='nextTurn'&&once){once=false;throw error('network');}};
  await assert.rejects(value.controller().next(),{code:'network'});
  const pending=structuredClone(value.public().operation);
  await value.controller({user:'other-gm'}).stop();
  assert.equal(value.public().completed.find(receipt=>receipt.id===pending.id).cancelled,true);
  await value.controller({user:'other-gm'}).start();const version=value.native.version;
  await value.controller().retry();
  assert.equal(value.native.active,true);assert.equal(value.native.version,version);
  assert.equal(value.count('combat','nextTurn'),1);assert.equal(value.count('dice','roll'),0);
  assert.equal(value.docs.get('monster').data.bars.bar_1.value,20);
});

test('a stale Stop cannot claim or clear a replacement operation or encounter',async()=>{
  for(const replaceEncounter of [false,true]) {
    const value=fixture(),controller=value.controller();let once=true;
    value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key==='combat.scene.scene.stop'){
      once=false;if(replaceEncounter)value.native.encounterId='replacement';
      else value.maps.table.set('combat.scene.scene',{revision:'foreign',value:{operation:{id:'foreign',owner:'other'}}});
    }};
    await assert.rejects(controller.stop(),{code:'combat.operationBusy'});assert.equal(value.count('combat','stop'),0);
    if(!replaceEncounter)assert.equal(value.public().operation.id,'foreign');
  }
});

test('resource final checkpoint loss replays one relative adjustment after remount',async()=>{
  const value=fixture(),controller=value.controller();let once=true;
  value.hooks.storage=call=>{if(once&&call.when==='after'&&call.key.endsWith('.resource')&&call.value.confirmed){once=false;throw error('network');}};
  await assert.rejects(controller.setResource(value.native.combatants[0],'bar_1','-3'),{code:'network'});
  await value.controller().setResource(value.native.combatants[0],'bar_1','-3');
  assert.equal(value.docs.get('hero').data.bars.bar_1.value,17);assert.equal(value.count('actors','saveSheet'),1);
});

test('lost relative resource save and pre-confirmation conflicts recover exactly one adjustment',async()=>{
  for(const failure of ['native-response','confirmation']){
    const value=fixture();let once=true;
    if(failure==='native-response')value.hooks.afterNative=call=>{if(once&&call.domain==='actors'){once=false;throw error('network');}};
    else value.hooks.storage=call=>{if(once&&call.when==='before'&&call.key.endsWith('.resource')&&call.value.confirmed){once=false;throw error('conflict');}};
    await assert.rejects(value.controller().setResource(value.native.combatants[0],'bar_1','-3'));
    await value.controller().setResource(value.native.combatants[0],'bar_1','-3');
    assert.equal(value.docs.get('hero').data.bars.bar_1.value,17);assert.equal(value.count('actors','saveSheet'),1);
  }
});
