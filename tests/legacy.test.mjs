import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyCompatibility, LEGACY_PACKAGE_ID, LEGACY_MIGRATION_KEY} from '../legacy.js';

const old = (version = '0.1.0', active = true) => ({id:LEGACY_PACKAGE_ID,version,
  django:{apps:['gravewright_5e.apps.Gravewright5eConfig']},globalEnabled:active});
const reply = (value, status = 200) => ({ok:status >= 200 && status < 300,status,json:async () => structuredClone(value)});

function fixture({rows = [], role = 'owner', onRequest, state:stateChanges, journal:initialJournal} = {}) {
  const calls = [], abort = new AbortController();
  const backend = {rows:structuredClone(rows),role,queued:false,polls:0,finishAfter:2,
    progress:{supported:true,busy:false,stage:'idle'},csrf:0,time:100000,removed:[],...stateChanges};
  let record = initialJournal ? {value:structuredClone(initialJournal),revision:'1'} : null;
  const context = {signal:abort.signal,storage:{user:{
    async get(key) {assert.equal(key,LEGACY_MIGRATION_KEY);return structuredClone(record);},
    async set(key,value,{expectedRevision}) {
      assert.equal(key,LEGACY_MIGRATION_KEY);
      if (expectedRevision !== (record?.revision ?? null)) throw Object.assign(new Error('conflict'),{code:'conflict'});
      record = {value:structuredClone(value),revision:String(Number(record?.revision ?? 0)+1)};
      return structuredClone(record);
    },
  }}};
  const fetch = async (url, init) => {
    calls.push({url,...init});
    assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    const override = await onRequest?.(url,init,backend);
    if (override) return override;
    if (url === '/api/module-packages') {
      if (backend.queued && ++backend.polls >= backend.finishAfter) {
        backend.rows.forEach(row => {if (row.id === LEGACY_PACKAGE_ID) row.globalEnabled = false;});
        backend.queued = false;
      }
      return reply(backend.rows);
    }
    if (url === '/api/auth/session') return reply({authenticated:true,account:{role:backend.role}});
    if (url === '/api/admin/status') return reply({updates:{automatic:backend.progress}});
    if (url === '/__gravewright/csrf') return reply({token:`csrf-${++backend.csrf}`,header:'x-csrf-token'});
    assert.equal(init.method,'POST');assert.equal(init.headers['x-csrf-token'],`csrf-${backend.csrf}`);
    assert.equal(init.headers['content-type'],'application/json');
    const data = JSON.parse(init.body);
    assert.equal(data.id,LEGACY_PACKAGE_ID);
    if (url === '/api/module-packages/activation') {
      assert.equal(data.enabled,false);
      backend.queued = true;
      return reply({stage:'queued',restartRequired:true},202);
    }
    if (url === '/api/module-packages/removal-preview') return reply({tables:[],system:false,resetsSystem:false});
    if (url === '/api/module-packages/remove') {
      assert.deepEqual(data.confirmedTables,[]);
      backend.rows = backend.rows.filter(row => row.id !== data.id || row.version !== data.version);
      backend.removed.push(data.version);
      return reply({removed:true});
    }
    throw Error('Unexpected endpoint '+url);
  };
  const options = {fetch,origin:'https://vtt.test',now:() => backend.time,pollIntervalMs:1,restartTimeoutMs:20,
    sleep:async () => {backend.time++;}};
  return {manager:createLegacyCompatibility(context,options),context,options,backend,calls,abort,
    journal:() => structuredClone(record),posts:() => calls.filter(call => call.method === 'POST')};
}

test('fresh installations need no migration and never mutate the host',async () => {
  const value = fixture({rows:[{id:'gravewright.5e-srd',version:'0.1.1',entry:'main.js',system:{}}]});
  assert.equal((await value.manager.assertReady()).state,'absent');
  assert.equal(value.manager.current.active,false);assert.deepEqual(value.posts(),[]);
  assert.equal((await value.manager.deactivate({confirmed:true})).state,'absent');
  assert.deepEqual(value.posts(),[]);value.manager.dispose();
});

test('an active legacy server blocks package automation for every campaign role',async () => {
  for (const role of ['owner','participant']) {
    const value = fixture({rows:[old()],role});
    await assert.rejects(value.manager.assertReady(),{code:'legacy-server-active'});
    assert.equal(value.manager.current.active,true);assert.equal(value.manager.current.isOwner,role === 'owner');
    assert.deepEqual(value.posts(),[]);value.manager.dispose();
  }
});

test('network failures or invalid installed state fail closed rather than enable duplicate clocks',async () => {
  for (const response of [() => {throw new TypeError('offline');},() => reply({items:[]}),
    () => reply([{...old(),globalEnabled:undefined}])]) {
    const value = fixture({onRequest:(url) => url === '/api/module-packages' ? response() : undefined});
    await assert.rejects(value.manager.assertReady(),{code:'legacy-status-unavailable'});
    assert.equal(value.manager.current.active,null);assert.equal(value.manager.current.state,'unknown');
    assert.deepEqual(value.posts(),[]);value.manager.dispose();
  }
});

test('confirmation and native host-owner permission are required before any migration write',async () => {
  const value = fixture({rows:[old()],role:'participant'});
  await assert.rejects(value.manager.deactivate(),{code:'legacy-confirmation-required'});
  await assert.rejects(value.manager.remove(),{code:'legacy-confirmation-required'});
  await assert.rejects(value.manager.deactivate({confirmed:true}),{code:'owner_required'});
  await assert.rejects(value.manager.previewRemoval(),{code:'owner_required'});
  assert.deepEqual(value.posts(),[]);value.manager.dispose();
});

test('owner-confirmed deactivation queues exactly one restart and waits for the actual inactive registry',async () => {
  const value = fixture({rows:[old()]});
  const first = value.manager.deactivate({confirmed:true}), second = value.manager.deactivate({confirmed:true});
  assert.equal(first,second);
  assert.equal((await first).state,'inactive');
  const writes = value.posts();assert.equal(writes.length,1);
  assert.deepEqual(JSON.parse(writes[0].body),{id:LEGACY_PACKAGE_ID,version:'0.1.0',enabled:false});
  assert.equal(value.journal().value.phase,'complete');
  assert.equal((await value.manager.assertReady()).active,false);
  await value.manager.deactivate({confirmed:true});assert.equal(value.posts().length,1);value.manager.dispose();
});

test('temporary restart outages and an ambiguous activation response are observed without resubmission',async () => {
  let outage = false;
  const value = fixture({rows:[old()],onRequest:(url,init,backend) => {
    if (url === '/api/module-packages/activation') {backend.queued = true;outage = true;throw new TypeError('restart closed connection');}
    if (url === '/api/module-packages' && outage) {outage = false;throw new TypeError('server offline');}
  }});
  assert.equal((await value.manager.deactivate({confirmed:true})).state,'inactive');
  assert.equal(value.posts().length,1);value.manager.dispose();
});

test('a reloaded module resumes a persisted confirmed restart without another activation POST',async () => {
  const value = fixture({rows:[old()],journal:{schemaVersion:1,id:LEGACY_PACKAGE_ID,phase:'waiting',startedAt:99999},
    state:{queued:true,finishAfter:3}});
  assert.equal((await value.manager.resume()).state,'inactive');
  assert.deepEqual(value.posts(),[]);assert.equal(value.journal().value.phase,'complete');value.manager.dispose();
});

test('unsupported or busy managed hosts are reported without queueing a migration',async () => {
  for (const [progress,code] of [[{supported:false,busy:false},'managed_start_required'],
    [{supported:true,busy:true},'update_in_progress']]) {
    const value = fixture({rows:[old()],state:{progress}});
    await assert.rejects(value.manager.deactivate({confirmed:true}),{code});assert.deepEqual(value.posts(),[]);value.manager.dispose();
  }
});

test('a failed restart retains the old package and never enables package clocks or removes data',async () => {
  const value = fixture({rows:[old()],state:{finishAfter:Infinity},onRequest:(url,init,backend) => {
    if (url === '/api/admin/status' && backend.queued) return reply({updates:{automatic:{supported:true,
      kind:'django',stage:'rolled_back',at:backend.time/1000}}});
  }});
  await assert.rejects(value.manager.deactivate({confirmed:true}),{code:'legacy-deactivation-failed'});
  await assert.rejects(value.manager.assertReady(),{code:'legacy-server-active'});
  assert.equal(value.backend.rows.length,1);assert.deepEqual(value.backend.removed,[]);value.manager.dispose();
});

test('bounded restart waiting and disposal stop polling without any removal request',async () => {
  const value = fixture({rows:[old()],state:{finishAfter:Infinity}});
  await assert.rejects(value.manager.deactivate({confirmed:true}),{code:'legacy-restart-timeout'});
  assert.deepEqual(value.backend.removed,[]);value.manager.dispose();
  await assert.rejects(value.manager.refresh(),{code:'cancelled'});
});

test('removal needs a separate reviewed preview and deletes only inactive legacy releases',async () => {
  const value = fixture({rows:[old('0.1.0',false),old('0.0.9',false),
    {id:'gravewright.5e-srd',version:'0.1.1',entry:'main.js',system:{},globalEnabled:false}]});
  const preview = await value.manager.previewRemoval();
  assert.equal(preview.packages.length,2);assert.deepEqual(value.backend.removed,[]);
  await assert.rejects(value.manager.remove({preview}),{code:'legacy-confirmation-required'});
  assert.equal((await value.manager.remove({confirmed:true,preview})).state,'absent');
  assert.deepEqual(value.backend.removed,['0.1.0','0.0.9']);
  assert.equal(value.backend.rows[0].id,'gravewright.5e-srd');
  await value.manager.remove({confirmed:true,preview});assert.equal(value.backend.removed.length,2);
  assert.equal(value.backend.csrf,6);value.manager.dispose();
});

test('active companions cannot be removed and a reactivated companion invalidates an earlier preview',async () => {
  const value = fixture({rows:[old('0.1.0',false)]});
  const preview = await value.manager.previewRemoval();value.backend.rows[0].globalEnabled = true;
  await assert.rejects(value.manager.remove({confirmed:true,preview}),{code:'legacy-server-active'});
  assert.deepEqual(value.backend.removed,[]);value.manager.dispose();
});

test('a changed removal preview or another package identity is refused before deletion',async () => {
  const value = fixture({rows:[old('0.1.0',false)],onRequest:url => url === '/api/module-packages/removal-preview'
    ? reply({system:false,resetsSystem:false,tables:[{id:'campaign',name:'Campaign'}]}) : undefined});
  await assert.rejects(value.manager.remove({confirmed:true,preview:{packages:[{id:LEGACY_PACKAGE_ID,
    version:'0.1.0',tables:[]}]}}),{code:'legacy-removal-changed'});
  await assert.rejects(value.manager.remove({confirmed:true,preview:{packages:[{id:'gravewright.5e-srd',
    version:'0.1.1',tables:[]}]}}),{code:'legacy-removal-changed'});
  assert.deepEqual(value.backend.removed,[]);value.manager.dispose();
});

test('server-side authorization and CSRF errors are never replaced by local success',async () => {
  const value = fixture({rows:[old()],onRequest:url => url === '/api/module-packages/activation'
    ? reply({error:'owner_required'},403) : undefined});
  await assert.rejects(value.manager.deactivate({confirmed:true}),{code:'owner_required',httpStatus:403});
  assert.equal(value.manager.current.active,true);assert.deepEqual(value.backend.removed,[]);value.manager.dispose();
});

test('native path metadata is honored but cross-origin API configuration is rejected',async () => {
  const value = fixture();
  const prefixed = createLegacyCompatibility(value.context,{...value.options,
    document:{querySelector:selector => ({content:selector.includes('backend-api') ? '/vtt/api' : '/vtt/csrf'})},
    fetch:async url => {
      assert.ok(url.startsWith('/vtt/'));
      return reply(url.endsWith('/auth/session') ? {authenticated:true,account:{role:'owner'}} : []);
    }});
  assert.equal((await prefixed.refresh()).state,'absent');prefixed.dispose();
  const foreign = createLegacyCompatibility(value.context,{...value.options,
    document:{querySelector:() => ({content:'https://external.test/api'})}});
  await assert.rejects(foreign.assertReady(),{code:'legacy-status-unavailable'});
  assert.equal(value.calls.length,0);foreign.dispose();value.manager.dispose();
});

test('failed persistence prevents an untracked restart and abort releases a pending migration',async () => {
  const conflict = fixture({rows:[old()]});
  conflict.context.storage.user.set = async () => {throw Object.assign(new Error('conflict'),{code:'conflict'});};
  await assert.rejects(conflict.manager.deactivate({confirmed:true}),{code:'conflict'});
  assert.deepEqual(conflict.posts(),[]);conflict.manager.dispose();
  const cancelled = fixture({rows:[old()],state:{finishAfter:Infinity}});
  cancelled.options.sleep = async () => {cancelled.abort.abort();};
  await assert.rejects(cancelled.manager.deactivate({confirmed:true}),{code:'cancelled'});
  assert.equal(cancelled.posts().length,1);assert.deepEqual(cancelled.backend.removed,[]);
});

test('removal can be retried after a lost successful response without deleting another package',async () => {
  let lose = true;
  const value = fixture({rows:[old('0.1.0',false)],onRequest:(url,init,backend) => {
    if (url === '/api/module-packages/remove' && lose) {
      lose = false;backend.rows = [];throw new TypeError('response lost after successful removal');
    }
  }});
  const preview = await value.manager.previewRemoval();
  await assert.rejects(value.manager.remove({confirmed:true,preview}),{code:'legacy-status-unavailable'});
  assert.equal((await value.manager.remove({confirmed:true,preview})).state,'absent');
  assert.equal(value.posts().filter(call => call.url.endsWith('/remove')).length,1);value.manager.dispose();
});
