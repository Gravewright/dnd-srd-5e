/** Reproducible request-latency diagnostic; no running host or private data.
 * node tests/combat-performance.mjs [output.json] [samples=3] [latencyMs=10] [batch|legacy] [independent|linked]
 * Timings end when controls can be released, before optional private cleanup.
 */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fixture} from './combat-fixture.mjs';
import {createCombatController} from '../combat-controller.js';

const samples = Number(process.argv[3] || 3), latency = Number(process.argv[4] || 10);
const batch=process.argv[5]==='batch',independent=process.argv[6]==='independent';
assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 20);
assert.ok(Number.isFinite(latency) && latency >= 0 && latency <= 1000);
const delay = value => new Promise(resolve => setTimeout(resolve, value));
const results = [];
for (const size of [1, 10, 20]) for (const action of ['initiative', 'next']) {
  const runs = [];
  for (let sample = 0; sample < samples; sample++) {
    const entries = Array.from({length:size}, (_, index) => ({id:`token-${index}`,actor_id:'hero',
      token_id:`token-${index}`,name:`Synthetic participant ${index}`,initiative:null}));
    const value = fixture({entries,batch});
    value.tokens.splice(0, value.tokens.length, ...entries.map(entry => ({id:entry.token_id,actorId:'hero',conditions:[],
      version:1,linkMode:independent?'snapshot':'linked',independent})));
    if(independent)for(const entry of entries)value.docs.set(entry.token_id,{
      ...structuredClone(value.docs.get('hero')),tokenId:entry.token_id});
    const client = value.client(), calls = {};
    let active = 0, peak = 0, storageBytes = 0, largestStorageValue = 0;
    function wrap(object, prefix) {
      for (const [name, method] of Object.entries(object)) if (typeof method === 'function') {
        object[name] = async (...args) => {
          const key = `${prefix}.${name}`;
          calls[key] = (calls[key] || 0) + 1;
          active++;peak = Math.max(peak, active);
          if (prefix.startsWith('storage.') && name === 'set') {
            const bytes = Buffer.byteLength(JSON.stringify(args[1]));
            storageBytes += bytes;largestStorageValue = Math.max(largestStorageValue, bytes);
          }
          try {if (latency) await delay(latency);return await method(...args);}
          finally {active--;}
        };
      }
    }
    for (const domain of ['combat','actors','tokens','dice']) wrap(client.api[domain], domain);
    for (const scope of ['table','user']) wrap(client.storage[scope], `storage.${scope}`);
    const controller = createCombatController({...client,sceneId:'scene'}), started = performance.now();
    if (action === 'initiative') await controller.rollInitiative();else await controller.next();
    const elapsed = performance.now() - started;
    assert.equal(value.public().operation, null);
    assert.equal(value.count('combat', action === 'initiative' ? batch?'rollInitiativeBatch':'setInitiative' : 'nextTurn'),
      action === 'initiative' && !batch ? size : 1);
    runs.push({milliseconds:Number(elapsed.toFixed(3)),callsStartedBeforeReturn:{...calls},peak,
      storageBytesBeforeReturn:storageBytes,largestStorageValue});
    // Cleanup starts just before return; its initial reads can appear above.
    // Drain it before the next sample to avoid contaminating later timings.
    do {await delay(Math.max(1, latency));} while (active);
  }
  const ordered = runs.map(run => run.milliseconds).sort((left,right) => left-right);
  results.push({size,action,medianMilliseconds:ordered[Math.floor(ordered.length / 2)],runs});
}
const report = {method:'Real controller and strict CAS/receipt fixture with fixed latency per API/storage call; no browser, SQL or network measurement.',
  transport:batch?'batch':'legacy',documents:independent?'independent':'linked',latencyMilliseconds:latency,samples,results};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
