/** Migrate the former server companion through the unchanged VTT 0.2.3 owner APIs. */
export const LEGACY_PACKAGE_ID = 'gravewright.5e-srd-server';
export const LEGACY_MIGRATION_KEY = 'compatibility.legacy-server';
const fail = (code, httpStatus) => Object.assign(new Error(code), {code, ...(httpStatus ? {httpStatus} : {})});
const copy = value => structuredClone(value);
const legacy = row => row?.id === LEGACY_PACKAGE_ID && row.django && !row.system && !row.entry;

export function createLegacyCompatibility(context, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const doc = options.document ?? globalThis.document;
  const origin = options.origin ?? globalThis.location?.origin ?? 'http://localhost';
  const now = options.now ?? Date.now;
  const timeoutMs = options.restartTimeoutMs ?? 120000;
  const intervalMs = options.pollIntervalMs ?? 1500;
  const controller = new AbortController();
  const listeners = new Set();
  let state = {state:'unknown', active:null, installed:[], isOwner:false, error:null, progress:null, migration:null};
  let refreshing, operation, journal, journalLoaded = false, disposed = false;

  function check() {if (disposed || controller.signal.aborted || context.signal?.aborted) throw fail('cancelled');}
  function publish(changes) {
    state = {...state, ...changes};
    if (!disposed) for (const callback of [...listeners]) callback(copy(state));
    return copy(state);
  }
  function path(value) {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin) throw fail('legacy-status-unavailable');
    return url.pathname + url.search;
  }
  function meta(name, fallback) {return path(doc?.querySelector?.(`meta[name="${name}"]`)?.content || fallback);}
  function apiPath(value) {return meta('gravewright-backend-api', '/api').replace(/\/$/, '') + value.slice(4);}
  async function request(value, {method = 'GET', data} = {}) {
    check();
    if (!fetcher) throw fail('legacy-status-unavailable');
    const headers = {accept:'application/json'};
    if (method === 'POST') {
      const csrf = await send(meta('gravewright-csrf-url', '/__gravewright/csrf'), {headers});
      if (typeof csrf?.token !== 'string' || !csrf.token || typeof csrf?.header !== 'string'
          || !/^[a-z0-9-]+$/i.test(csrf.header)) throw fail('invalid_csrf_token');
      headers[csrf.header] = csrf.token;
      headers['content-type'] = 'application/json';
    }
    return send(apiPath(value), {method, headers, ...(data === undefined ? {} : {body:JSON.stringify(data)})});
  }
  async function send(url, init) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const timer = setTimeout(cancel, options.requestTimeoutMs ?? 10000);
    controller.signal.addEventListener('abort', cancel, {once:true});
    context.signal?.addEventListener('abort', cancel, {once:true});
    try {
      check();
      const response = await fetcher(url, {...init, signal:abort.signal, credentials:'same-origin', cache:'no-store', redirect:'error'});
      let result;
      try {result = await response.json();} catch {throw fail('legacy-status-unavailable', response.status);}
      if (!response.ok) throw fail(result?.error || 'legacy-status-unavailable', response.status);
      check();
      return result;
    } catch (error) {
      if (disposed || controller.signal.aborted || context.signal?.aborted) throw fail('cancelled');
      if (error?.code) throw error;
      throw fail('legacy-status-unavailable');
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancel);
      context.signal?.removeEventListener('abort', cancel);
    }
  }
  async function readJournal() {
    if (!journalLoaded) {
      journal = await context.storage?.user?.get(LEGACY_MIGRATION_KEY) ?? null;
      journalLoaded = true;
    }
    const value = journal?.value;
    return value?.schemaVersion === 1 && value.id === LEGACY_PACKAGE_ID ? value : null;
  }
  async function persist(value) {
    if (!context.storage?.user?.set) throw fail('legacy-status-unavailable');
    await readJournal();
    journal = await context.storage.user.set(LEGACY_MIGRATION_KEY, value, {expectedRevision:journal?.revision ?? null});
    publish({migration:copy(value)});
  }
  function refresh() {
    if (!refreshing) refreshing = (async () => {
      try {
        const [rows, session, migration] = await Promise.all([
          request('/api/module-packages'), request('/api/auth/session'), readJournal(),
        ]);
        if (!Array.isArray(rows)) throw fail('legacy-status-invalid');
        const installed = rows.filter(legacy).map(row => {
          if (typeof row.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(row.version)
              || typeof row.globalEnabled !== 'boolean') throw fail('legacy-status-invalid');
          return {id:LEGACY_PACKAGE_ID, version:row.version, active:row.globalEnabled, revoked:row.revoked === true};
        });
        if (new Set(installed.map(row => row.version)).size !== installed.length) throw fail('legacy-status-invalid');
        const active = installed.some(row => row.active);
        return publish({state:active ? 'active' : installed.length ? 'inactive' : 'absent', active, installed,
          isOwner:session?.authenticated === true && session.account?.role === 'owner', error:null, migration});
      } catch (error) {
        publish({state:'unknown', active:null, error:error?.code || 'legacy-status-unavailable'});
        throw error;
      }
    })().finally(() => {refreshing = undefined;});
    return refreshing;
  }
  async function assertReady() {
    let next;
    try {next = await refresh();} catch (error) {
      if (error.code === 'cancelled') throw error;
      throw fail('legacy-status-unavailable');
    }
    if (next.active) throw fail('legacy-server-active');
    return next;
  }
  async function owner() {
    const next = await refresh();
    if (!next.isOwner) throw fail('owner_required');
    return next;
  }
  async function pause() {
    check();
    if (options.sleep) {await options.sleep(intervalMs, controller.signal); check(); return;}
    await new Promise((resolve, reject) => {
      const cancel = () => {clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); reject(fail('cancelled'));};
      const timer = setTimeout(() => {controller.signal.removeEventListener('abort', cancel); resolve();}, intervalMs);
      controller.signal.addEventListener('abort', cancel, {once:true});
    });
    check();
  }
  async function waitInactive(startedAt) {
    const deadline = now() + timeoutMs;
    while (true) {
      check();
      let next, progress;
      try {next = await refresh();} catch (error) {if (error.code === 'cancelled' || error.httpStatus === 401 || error.httpStatus === 403) throw error;}
      if (next && !next.isOwner) throw fail('owner_required');
      if (next && !next.active) {
        await persist({schemaVersion:1,id:LEGACY_PACKAGE_ID, phase:'complete', startedAt});
        return publish({progress:null});
      }
      try {progress = (await request('/api/admin/status'))?.updates?.automatic;} catch (error) {
        if (error.code === 'cancelled' || error.httpStatus === 401 || error.httpStatus === 403) throw error;
      }
      if (progress) {
        publish({state:'restarting', progress});
        if (progress.kind === 'django' && progress.at * 1000 >= startedAt
            && ['failed', 'rolled_back'].includes(progress.stage)) throw fail('legacy-deactivation-failed');
      }
      if (now() >= deadline) throw fail('legacy-restart-timeout');
      await pause();
    }
  }
  function exclusive(kind, task) {
    if (operation) return operation.kind === kind ? operation.promise : Promise.reject(fail('operation-busy'));
    const promise = Promise.resolve().then(task).finally(() => {operation = undefined;});
    operation = {kind, promise};
    return promise;
  }
  function deactivate({confirmed = false} = {}) {
    if (confirmed !== true) return Promise.reject(fail('legacy-confirmation-required'));
    return exclusive('deactivate', async () => {
      const next = await owner();
      if (!next.active) return next;
      if (next.installed.filter(row => row.active).length !== 1) throw fail('legacy-status-invalid');
      const progress = (await request('/api/admin/status'))?.updates?.automatic;
      if (progress?.busy) throw fail('update_in_progress');
      if (progress?.supported === false) throw fail('managed_start_required');
      const startedAt = now(), selected = next.installed.find(row => row.active);
      await persist({schemaVersion:1,id:LEGACY_PACKAGE_ID, version:selected.version, phase:'waiting', startedAt});
      try {
        const result = await request('/api/module-packages/activation', {method:'POST',
          data:{id:LEGACY_PACKAGE_ID, version:selected.version, enabled:false}});
        if (result?.restartRequired !== true) throw fail('legacy-status-invalid');
      } catch (error) {
        // A lost response may mean the supervisor already restarted. Observe
        // current state; never blindly repeat the activation request.
        if (error.code !== 'legacy-status-unavailable') throw error;
      }
      publish({state:'restarting', progress:{stage:'queued', kind:'django'}});
      return waitInactive(startedAt);
    });
  }
  function resume() {
    return exclusive('resume', async () => {
      const next = await owner(), migration = await readJournal();
      if (!migration || migration.phase === 'complete' || !next.active) return next;
      return waitInactive(migration.startedAt);
    });
  }
  async function previewRemoval() {
    const next = await owner();
    if (next.active) throw fail('legacy-server-active');
    const packages = [];
    for (const row of next.installed) {
      const preview = await request('/api/module-packages/removal-preview', {method:'POST', data:{id:LEGACY_PACKAGE_ID,version:row.version}});
      if (preview?.system !== false || preview.resetsSystem !== false || !Array.isArray(preview.tables)
          || preview.tables.some(table => typeof table?.id !== 'string' || typeof table.name !== 'string')) throw fail('legacy-removal-changed');
      packages.push({id:LEGACY_PACKAGE_ID,version:row.version,...preview});
    }
    return {packages};
  }
  function remove({confirmed = false, preview} = {}) {
    if (confirmed !== true) return Promise.reject(fail('legacy-confirmation-required'));
    return exclusive('remove', async () => {
      if (!Array.isArray(preview?.packages) || preview.packages.some(row => row.id !== LEGACY_PACKAGE_ID
          || typeof row.version !== 'string' || !Array.isArray(row.tables))) throw fail('legacy-removal-changed');
      const current = await previewRemoval();
      for (const row of current.packages) {
        const approved = preview.packages.find(value => value.version === row.version);
        if (!approved || JSON.stringify(approved.tables) !== JSON.stringify(row.tables)) throw fail('legacy-removal-changed');
      }
      for (const row of current.packages) {
        try {
          const result = await request('/api/module-packages/remove', {method:'POST', data:{id:LEGACY_PACKAGE_ID,
            version:row.version,confirmedTables:row.tables.map(table => table.id)}});
          if (result?.removed !== true) throw fail('legacy-server-active');
        } catch (error) {if (error.httpStatus !== 404) throw error;}
      }
      return refresh();
    });
  }
  function dispose() {disposed = true; controller.abort(); listeners.clear();context.signal?.removeEventListener('abort', dispose);}
  context.signal?.addEventListener('abort', dispose, {once:true});
  context.onDispose?.(dispose);
  return {refresh, assertReady, deactivate, resume, previewRemoval, remove, dispose,
    get current() {return copy(state);},
    subscribe(callback) {check(); listeners.add(callback); return () => listeners.delete(callback);}};
}
