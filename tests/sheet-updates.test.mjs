import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorUpdates,createSheetRefresh} from '../sheet-updates.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
function setup({tokenId}={}){
  const abort=new AbortController(),reads=[],applied=[],errors=[];
  let view={version:1,sheetVersion:1,canEdit:true},busy=false;
  const updates=createSheetRefresh({context:{actorId:'hero',tableId:'table',tokenId},signal:abort.signal,
    current:()=>view,busy:()=>busy,read:()=>{const task=deferred();reads.push(task);return task.promise;},
    apply:value=>{view=value;applied.push(value);},error:value=>errors.push(value)});
  return {updates,reads,applied,errors,abort,setBusy:value=>{busy=value;},setCurrent:value=>{view=value;}};
}
const state=(version=1,extra={})=>({tableId:'table',actors:[{id:'hero',version,sheetVersion:version,canEdit:true,...extra}]});

test('actor index revisions skip initial and unrelated sheet reads, preserving permission changes',async()=>{
  const value=setup();
  await value.updates.invalidate(state());
  await value.updates.invalidate({...state(),actors:[...state().actors,{id:'other',version:9,sheetVersion:9}]});
  await value.updates.invalidate({...state(2),tableId:'another-table'});
  assert.equal(value.reads.length,0);
  const work=value.updates.invalidate(state(1,{canEdit:false}));
  assert.equal(value.reads.length,1);value.reads[0].resolve({version:1,sheetVersion:1,canEdit:false});await work;
  assert.equal(value.applied[0].canEdit,false);
});

test('a burst has one in-flight read and one final refresh without dropping the newest version',async()=>{
  const value=setup();
  const work=value.updates.invalidate(state(2));
  for(let version=3;version<=20;version++)value.updates.invalidate(state(version));
  assert.equal(value.reads.length,1);
  value.reads[0].resolve({version:2,sheetVersion:2,canEdit:true});await tick();
  assert.equal(value.reads.length,2);value.reads[1].resolve({version:20,sheetVersion:20,canEdit:true});await work;
  assert.equal(value.applied.at(-1).version,20);
});

test('token snapshots always revalidate independently of their actor index revisions',async()=>{
  const value=setup({tokenId:'snapshot'}),work=value.updates.invalidate(state());
  assert.equal(value.reads.length,1);value.reads[0].resolve({version:1,sheetVersion:3,canEdit:true});await work;
  assert.equal(value.applied[0].sheetVersion,3);
});

test('editing defers invalidation and in-flight responses until an authorized fresh read after saving',async()=>{
  const value=setup(),work=value.updates.invalidate(state(2));value.setBusy(true);
  value.reads[0].resolve({version:2,sheetVersion:2,canEdit:true});await work;
  assert.equal(value.applied.length,0);value.setBusy(false);
  const resumed=value.updates.resume();assert.equal(value.reads.length,2);
  value.reads[1].resolve({version:3,sheetVersion:3,canEdit:true});await resumed;
  assert.equal(value.applied.length,1);assert.equal(value.applied[0].version,3);
});

test('closing a sheet discards an in-flight read and queued invalidations',async()=>{
  const value=setup(),work=value.updates.invalidate(state(2));value.updates.invalidate(state(3));value.abort.abort();
  value.reads[0].resolve({version:2,sheetVersion:2,canEdit:true});await work;
  assert.equal(value.applied.length,0);assert.equal(value.reads.length,1);
});

test('a local save completed during a delayed read cannot be replaced by an older response',async()=>{
  const value=setup(),work=value.updates.invalidate(state(2));
  value.setCurrent({version:3,sheetVersion:3,canEdit:true});
  value.reads[0].resolve({version:2,sheetVersion:2,canEdit:true});await tick();
  assert.equal(value.applied.length,0);assert.equal(value.reads.length,2);
  value.reads[1].resolve({version:3,sheetVersion:3,canEdit:true});await work;
  assert.equal(value.applied.at(-1).version,3);
});

test('actor subscriptions share one authorized read per table and release the last listener',()=>{
  function source(){let starts=0,ends=0,emit;const abort=new AbortController();
    const api={events:{on:(name,handler)=>{assert.equal(name,'actors.changed');starts++;emit=handler;return()=>{ends++;};}}};
    return {shared:createActorUpdates(api,abort.signal),abort,emit:value=>emit(value),counts:()=>[starts,ends]};}
  const first=source(),second=source(),seen=[];
  const a=first.shared.subscribe(value=>seen.push(['a',value])),b=first.shared.subscribe(value=>seen.push(['b',value]));
  const c=second.shared.subscribe(value=>seen.push(['c',value]));
  first.emit('first');assert.deepEqual(seen,[['a','first'],['b','first']]);assert.deepEqual(first.counts(),[1,0]);
  a();assert.deepEqual(first.counts(),[1,0]);b();assert.deepEqual(first.counts(),[1,1]);
  first.shared.subscribe(value=>seen.push(['d',value]));assert.deepEqual(first.counts(),[2,1]);
  first.abort.abort();assert.deepEqual(first.counts(),[2,2]);first.shared.subscribe(()=>assert.fail('disposed'));
  second.emit('second');assert.deepEqual(seen.at(-1),['c','second']);c();assert.deepEqual(second.counts(),[1,1]);
});

test('a newly opened sheet receives an index change that arrived while its initial sheet was loading',async()=>{
  let emit,subscriptions=0,releases=0;
  const abort=new AbortController(),shared=createActorUpdates({events:{on:(_name,handler)=>{
    emit=handler;subscriptions++;return()=>{releases++;};
  }}},abort.signal);
  const existing=shared.subscribe(()=>{});emit(state(2));
  const sheet=setup(),release=shared.subscribe(sheet.updates.invalidate);
  assert.equal(sheet.reads.length,0,'Cached state is delivered after registration completes.');
  await tick();assert.equal(sheet.reads.length,1);
  sheet.reads[0].resolve({version:2,sheetVersion:2,canEdit:true});await tick();
  assert.equal(sheet.applied[0].version,2);assert.equal(subscriptions,1);
  release();existing();assert.equal(releases,1);
  const next=[];shared.subscribe(value=>next.push(value));await tick();
  assert.equal(next.length,0,'An inactive subscription retains no authorized cache.');
  emit(state(3));assert.equal(next[0].actors[0].version,3);assert.equal(subscriptions,2);
  abort.abort();
});

test('newer events supersede queued index replay and disposal cancels it',async()=>{
  let emit;const abort=new AbortController();
  const shared=createActorUpdates({events:{on:(_name,handler)=>{emit=handler;return()=>{};}}},abort.signal);
  shared.subscribe(()=>{});emit(state(2));
  const versions=[];shared.subscribe(value=>versions.push(value.actors[0].version));emit(state(3));
  await tick();assert.deepEqual(versions,[3]);
  const release=shared.subscribe(()=>assert.fail('Released replay'));release();
  shared.subscribe(()=>assert.fail('Aborted replay'));abort.abort();await tick();
});
