/** Respect the released host's shared chat/dice allowance without changing rolls.
 * Authorized history seeds this controller's short-lived observations. Other
 * scenes, deleted history and concurrent clients can still consume the quota.
 */
const WINDOW=10000, LIMIT=20, INTERVAL=2000;
const fail=code=>Object.assign(new Error(code),{code});
const limited=error=>error?.code==='too_many_messages'
  || error?.code==='invalid_data'&&error.message==='too_many_messages';

function wait(milliseconds,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(fail('cancelled'));return;}
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    const cancel=()=>{cleanup();reject(fail('cancelled'));};
    const timer=setTimeout(()=>{cleanup();resolve();},milliseconds);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

export function createCombatRollPacing({api,signal,fetcher=globalThis.fetch?.bind(globalThis),
  document=globalThis.document,origin=globalThis.location?.origin||'http://localhost'}={}) {
  let accountId,sessionRead=false,clockOffset=0,needsHistory=true;
  const enabled=typeof api?.chat?.history==='function';
  const messages=new Map(),receipts=new Map();
  const check=()=>{if(signal?.aborted)throw fail('cancelled');};
  const prune=()=>{
    const now=Date.now();
    for(const [id,entry]of messages)if(entry.expires<=now)messages.delete(id);
    for(const [id,entry]of receipts)if(entry.expires<=now)receipts.delete(id);
  };
  async function sessionClock() {
    if(sessionRead)return;
    if(!fetcher)throw fail('unavailable');
    const configured=document?.querySelector?.('meta[name="gravewright-backend-api"]')?.content||'/api';
    const url=new URL(configured.replace(/\/$/,'')+'/auth/session',origin);
    if(url.origin!==new URL(origin).origin)throw fail('unavailable');
    const abort=new AbortController(),cancel=()=>abort.abort();
    const timer=setTimeout(cancel,10000);
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      check();
      const response=await fetcher(url.pathname+url.search,{credentials:'same-origin',cache:'no-store',
        redirect:'error',headers:{accept:'application/json'},signal:abort.signal});
      if(!response.ok)throw fail(response.status===401||response.status===403?'permission_denied':'unavailable');
      const session=await response.json();check();
      if(session?.authenticated!==true)throw fail('permission_denied');
      // HTTP Date is rounded down to a second; using it is conservative and
      // avoids trusting the browser's wall clock to match the host's clock.
      const serverTime=Date.parse(response.headers?.get?.('date'));
      if(Number.isFinite(serverTime))clockOffset=serverTime-Date.now();
      sessionRead=true;
    } catch(error) {
      check();throw error?.code?error:fail('unavailable');
    } finally {
      clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    }
  }
  async function loadHistory() {
    if(!needsHistory||!enabled)return;
    const [,history]=await Promise.all([sessionClock(),api.chat.history({}, {signal})]);check();
    if(!Array.isArray(history))throw fail('unavailable');
    const now=Date.now(),serverNow=now+clockOffset;
    for(const message of history) {
      const author=message?.from?.id;
      if(typeof author!=='string'||accountId&&author!==accountId||typeof message.id!=='string'||!Number.isFinite(message.at))continue;
      // A future/skewed timestamp can delay at most one host window.
      const remaining=Math.min(WINDOW,Math.max(0,WINDOW-(serverNow-message.at)));
      if(remaining)messages.set(message.id,{author,expires:Math.max(messages.get(message.id)?.expires||0,now+remaining)});
    }
    needsHistory=false;prune();
  }
  async function capacity(requestId,authorize) {
    if(!enabled)return;
    prune();
    if(receipts.has(requestId))return;
    while(messages.size>=LIMIT) {
      const expires=[...messages.values()].map(entry=>entry.expires).sort((left,right)=>left-right)[messages.size-LIMIT];
      await wait(Math.min(INTERVAL,Math.max(1,expires-Date.now())),signal);
      await authorize(true);prune();
    }
  }
  function accepted(requestId,message) {
    if(!enabled)return;
    if(receipts.has(requestId))return;
    // The session endpoint intentionally has no account ID. A successful own
    // roll supplies it through the public message contract. Until then, visible
    // history is conservatively counted; afterwards other authors are removed.
    if(!accountId&&typeof message?.from?.id==='string') {
      accountId=message.from.id;
      for(const [id,entry]of messages)if(entry.author!==accountId)messages.delete(id);
    }
    const id=typeof message?.id==='string'?message.id:`request:${requestId}`;
    const expires=messages.get(id)?.expires||Date.now()+WINDOW;
    messages.set(id,{author:accountId,expires});receipts.set(requestId,{expires});prune();
  }
  return {
    start(){needsHistory=true;},
    async run(requestId,perform,authorize) {
      check();await loadHistory();await capacity(requestId,authorize);
      let revalidate=false;
      for(let attempt=0;;attempt++) {
        check();await authorize(revalidate);revalidate=false;
        try {const result=await perform();accepted(requestId,result);return result;}
        catch(error) {
          // Released SDKs can normalize this to plain invalid_data. Never
          // guess that a generic validation failure is a rate-limit response.
          if(!limited(error)||attempt===5)throw error;
          await wait(INTERVAL,signal);
          revalidate=true;
        }
      }
    },
  };
}
