import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatController} from '../combat-controller.js';
import {fixture,error} from './combat-fixture.mjs';

test('only the GM owning an unconfirmed private intent can resume shared pending work',async()=>{
  const value=fixture(),controller=value.controller();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='nextTurn'){once=false;throw error('network');}};
  await assert.rejects(controller.next(),{code:'network'});
  assert.equal(controller.snapshot().canResume,true);
  const owner=value.controller(),other=value.controller({user:'other-gm'}),player=value.controller({gm:false});
  assert.equal((await owner.refresh()).canResume,true);
  assert.equal((await other.refresh()).canResume,false);
  assert.equal((await player.refresh()).canResume,false);
  await owner.retry();
  assert.equal(owner.snapshot().canResume,false);
  assert.equal(value.count('combat','nextTurn'),1);
});

test('polling the same shared marker does not repeatedly read private recovery records',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='nextTurn'){once=false;throw error('network');}};
  await assert.rejects(value.controller().next(),{code:'network'});
  const reads=[],writes=[];
  value.hooks.storage=call=>{
    if(call.scope==='user'&&call.method==='get')reads.push(call.key);
    if(call.method==='set'||call.method==='delete')writes.push(call.key);
  };
  const owner=value.controller();
  assert.equal((await owner.refresh()).canResume,true);
  assert.deepEqual(reads,['combat.owner','combat.scene.scene.intent']);
  for(let index=0;index<3;index++)assert.equal((await owner.syncPublic()).canResume,true);
  assert.equal(reads.length,2);
  assert.deepEqual(writes,[]);
  await owner.retry();
});

test('a shared marker without a matching unconfirmed private record cannot offer recovery',async()=>{
  for(const invalid of ['missing','confirmed','wrong-id','wrong-owner']) {
    const value=fixture();let once=true;
    value.hooks.afterNative=call=>{if(once&&call.method==='nextTurn'){once=false;throw error('network');}};
    await assert.rejects(value.controller().next(),{code:'network'});
    const privateMap=value.maps.users.get('gm'),key='combat.scene.scene.intent',record=privateMap.get(key);
    if(invalid==='missing')privateMap.delete(key);
    if(invalid==='confirmed')record.value.confirmed=true;
    if(invalid==='wrong-id')record.value.id='unrelated';
    if(invalid==='wrong-owner')record.value.owner='unrelated';
    const current=await value.controller().refresh();
    assert.ok(current.tracker.operation);
    assert.equal(current.canResume,false,invalid);
    assert.deepEqual(Object.keys(current.tracker.operation).sort(),['id','kind','owner']);
  }
});

test('lost Stop responses remain resumable only by their private owner after remount',async()=>{
  const value=fixture(),controller=value.controller();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.method==='stop'){once=false;throw error('network');}};
  await assert.rejects(controller.stop(),{code:'network'});
  assert.equal(controller.snapshot().canResume,true);
  assert.equal((await value.controller({user:'other-gm'}).refresh()).canResume,false);
  const owner=value.controller();
  assert.equal((await owner.refresh()).canResume,true);
  await owner.retry();
  assert.equal(owner.snapshot().canResume,false);
  assert.equal(value.count('combat','stop'),1);
});

test('a delayed public poll cannot offer recovery for an already acknowledged operation',async()=>{
  const value=fixture(),client=value.client(),read=client.storage.table.get;
  let hold=false,release,captured,poll;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{captured=resolve;});
  client.storage.table.get=async key=>{
    const record=await read(key);
    if(hold){hold=false;captured();await gate;}
    return record;
  };
  const controller=createCombatController({...client,sceneId:'scene'});
  let once=true;
  value.hooks.afterNative=async call=>{if(once&&call.domain==='dice'){
    once=false;hold=true;poll=controller.syncPublic();await ready;
  }};
  try {
    await controller.rollInitiative('all');
    assert.equal(value.public().operation,null);
    assert.equal(value.maps.users.get('gm').has('combat.scene.scene.intent'),false);
    release();
    assert.equal((await poll).canResume,false);
  } finally {release();}
});
