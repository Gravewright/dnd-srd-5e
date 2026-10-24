import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTracker} from '../tracker.js';
import {fixture,error} from './combat-fixture.mjs';

// The tracker only needs ordinary tree, attribute and event operations. Keeping
// this DOM local lets the tests hold real controller requests without a browser.
class Element {
  constructor(doc,tag) {
    this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};
    this.style={};this.className='';this._text='';
    this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},
      toggle:(name,on)=>{const names=new Set(this.className.split(' ').filter(Boolean));
        if(on??!names.has(name))names.add(name);else names.delete(name);this.className=[...names].join(' ');}};
  }
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get isConnected(){return this.tagName==='root'||!!this.parentElement?.isConnected;}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(){}
  getClientRects(){return this.isConnected?[{}]:[];}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
}
function document() {
  const doc={activeElement:null};doc.createElement=tag=>new Element(doc,tag);
  doc.createTextNode=text=>{const node=new Element(doc,'text');node.textContent=text;return node;};
  doc.createElementNS=(namespace,tag)=>{const node=new Element(doc,tag);node.namespaceURI=namespace;return node;};
  return doc;
}
const nodes=root=>[root,...root.children.flatMap(nodes)];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(predicate) {
  for(let count=0;count<200;count++){if(predicate())return;await new Promise(setImmediate);}
  assert.fail('The tracker did not reach the expected state.');
}
async function mount(value,options={}) {
  const client=value.client(options),doc=document(),root=doc.createElement('root'),abort=new AbortController(),events=new Map();
  const api={...client.api,i18n:{t:key=>key,onChange:()=>()=>{}},events:{on:(name,listener)=>{
    if(!events.has(name))events.set(name,new Set());events.get(name).add(listener);return ()=>events.get(name).delete(listener);
  }}};
  const dispose=await mountTracker({root,api,storage:client.storage,context:{sceneId:'scene'},signal:abort.signal},
    {compatibility:{...client.compatibility,current:{state:'absent'},subscribe:()=>()=>{}}});
  const find=action=>nodes(root).find(node=>node.dataset.gw5CombatAction===action);
  return {root,find,dispose:()=>{abort.abort();dispose();},
    text:()=>root.textContent,alerts:()=>nodes(root).filter(node=>node.role==='alert'),
    busy:()=>nodes(root).some(node=>node.getAttribute('aria-busy')==='true'),
    click:action=>{const button=find(action);assert.ok(button,action);assert.equal(!!button.disabled,false,action);
      button.onclick({stopPropagation(){}});},
    emit:name=>{for(const listener of events.get(name)||[])listener();},
    subscriptions:()=>[...events.values()].reduce((count,listeners)=>count+listeners.size,0)};
}

test('local commands show contextual progress before and during shared updates without a retry button',async()=>{
  for(const [action,method,key] of [
    ['initiative/roll-all','roll','combat.progressInitiative'],
    ['turn/next','nextTurn','combat.progressTurn'],
    ['round/next','nextRound','combat.progressRound'],
    ['start','start','combat.progressStart'],
    ['end','stop','combat.progressStop'],
  ]) {
    const value=fixture(),gate=deferred(),entered=deferred();
    if(action==='start')value.native.active=false;
    let once=true;
    value.hooks.beforeNative=async call=>{if(once&&call.method===method){once=false;entered.resolve();await gate.promise;}};
    const panel=await mount(value);
    try {
      panel.click(action);
      assert.ok(panel.text().includes(key));assert.equal(panel.find('retry'),undefined);
      await entered.promise;panel.emit('combat.changed');
      await until(()=>panel.busy()&&panel.text().includes(key));
      assert.equal(panel.text().includes('combat.pending'),false);assert.equal(panel.find('retry'),undefined);
      assert.equal(panel.alerts().length,0);
      gate.resolve();await until(()=>!panel.busy());
      assert.equal(value.public().operation??null,null);assert.equal(value.public().stopping??null,null);
      assert.equal(panel.text().includes(key),false);assert.equal(panel.alerts().length,0);
    } finally {gate.resolve();panel.dispose();}
  }
});

test('a real failed initiative keeps an enabled owner retry and hides it during recovery',async()=>{
  const value=fixture();let once=true;
  value.hooks.beforeNative=call=>{if(once&&call.domain==='dice'){once=false;throw error('network');}};
  const panel=await mount(value);
  try {
    panel.click('initiative/roll-all');
    await until(()=>!panel.busy()&&panel.alerts().length===1);
    assert.ok(panel.text().includes('combat.pending'));assert.ok(value.public().operation);
    assert.equal(panel.find('retry').disabled,false);
    panel.click('retry');assert.equal(panel.find('retry'),undefined);
    assert.ok(panel.text().includes('combat.progressInitiative'));
    await until(()=>!panel.busy()&&value.public().operation===null);
    assert.equal(panel.alerts().length,0);assert.equal(panel.find('retry'),undefined);
    assert.equal(value.count('dice','roll'),2);
  } finally {panel.dispose();}
});

test('a remounted owner can resume while other GMs and players see neutral shared progress',async()=>{
  const value=fixture();let once=true;
  value.hooks.afterNative=call=>{if(once&&call.domain==='dice'){once=false;throw error('network');}};
  await assert.rejects(value.controller().rollInitiative('all'),{code:'network'});
  const owner=await mount(value),observer=await mount(value,{user:'other-gm'}),player=await mount(value,{user:'player',gm:false});
  try {
    for(const panel of [owner,observer,player]) {
      assert.ok(panel.text().includes('combat.progressInitiative'));
      assert.equal(panel.text().includes('combat.pending'),false);assert.equal(panel.alerts().length,0);
    }
    assert.equal(owner.find('retry').disabled,false);assert.equal(owner.find('retry').title,'combat.resumePending');
    assert.equal(observer.find('retry'),undefined);assert.equal(player.find('retry'),undefined);
    owner.click('retry');await until(()=>!owner.busy()&&value.public().operation===null);
    observer.emit('combat.changed');player.emit('combat.changed');
    await until(()=>!observer.text().includes('combat.progressInitiative')&&!player.text().includes('combat.progressInitiative'));
    assert.equal(value.count('dice','roll'),2,'The accepted first roll is recovered, not rolled again.');
  } finally {for(const panel of [owner,observer,player])panel.dispose();}
  assert.equal(owner.root.children.length,0);assert.equal(owner.subscriptions(),0);
});
