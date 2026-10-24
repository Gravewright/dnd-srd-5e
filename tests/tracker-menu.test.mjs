import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTracker} from '../tracker.js';
import {fixture} from './combat-fixture.mjs';

class Target {
  constructor(){this.listeners=new Map();}
  addEventListener(type,callback,options={}) {
    if(options.signal?.aborted)return;
    if(!this.listeners.has(type))this.listeners.set(type,new Set());
    const entry={callback,once:options.once};this.listeners.get(type).add(entry);
    options.signal?.addEventListener('abort',()=>this.listeners.get(type)?.delete(entry),{once:true});
  }
  dispatchEvent(event) {
    for(const entry of [...this.listeners.get(event.type)||[]]) {
      entry.callback(event);if(entry.once)this.listeners.get(event.type).delete(entry);
    }
    return !event.defaultPrevented;
  }
  count(){return [...this.listeners.values()].reduce((count,listeners)=>count+listeners.size,0);}
}
class Element extends Target {
  constructor(doc,tag){
    super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};
    this.style={};this.className='';this._text='';
    this.classList={add:(...values)=>{this.className=[...new Set([...this.className.split(' '),...values])].join(' ');},
      toggle:(value,on)=>{const names=new Set(this.className.split(' '));if(on??!names.has(value))names.add(value);else names.delete(value);this.className=[...names].join(' ');}};
  }
  append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get isConnected(){return this.tagName==='body'||!!this.parentElement?.isConnected;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){return nodes(this).slice(1).filter(node=>matches(node,selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getClientRects(){return this.isConnected?[this.getBoundingClientRect()]:[];}
  getBoundingClientRect(){return this.rect||(this.className.includes('gw5-combat-menu')?
    {left:0,top:0,right:220,bottom:300,width:220,height:300}:{left:0,top:0,right:24,bottom:24,width:24,height:24});}
  focus(){this.ownerDocument.activeElement=this;}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
}
const nodes=root=>[root,...root.children.flatMap(nodes)];
function matches(node,selector) {
  if(selector==='button:not(:disabled)')return node.tagName==='button'&&!node.disabled;
  if(selector.startsWith('.'))return node.className.split(' ').includes(selector.slice(1));
  const data=selector.match(/^\[data-([\w-]+)="([^"]*)"\](?::not\(:disabled\))?$/);
  if(data)return node.dataset[data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]===data[2]&&(!selector.includes(':not')||!node.disabled);
  return false;
}
function event(type,target,extra={}) {
  return {type,target,...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
}
async function until(predicate){for(let count=0;count<300;count++){if(predicate())return;await new Promise(setImmediate);}assert.fail('Tracker did not settle.');}
async function mount() {
  const value=fixture(),client=value.client(),doc=new Target(),view=new Target(),abort=new AbortController(),events=new Map();
  Object.assign(view,{innerWidth:390,innerHeight:400});Object.assign(doc,{defaultView:view,activeElement:null});
  doc.createElement=tag=>new Element(doc,tag);doc.createTextNode=text=>{const node=new Element(doc,'text');node._text=String(text);return node;};
  doc.createElementNS=(namespace,tag)=>{const node=doc.createElement(tag);node.namespaceURI=namespace;return node;};
  doc.body=doc.createElement('body');const root=doc.createElement('root');doc.body.append(root);
  const api={...client.api,i18n:{t:key=>key,onChange:()=>()=>{}},events:{on:(type,listener)=>{
    if(!events.has(type))events.set(type,new Set());events.get(type).add(listener);return ()=>events.get(type).delete(listener);
  }}};
  const dispose=await mountTracker({root,api,storage:client.storage,context:{sceneId:'scene'},signal:abort.signal},
    {compatibility:{...client.compatibility,current:{state:'absent'},subscribe:()=>()=>{}}});
  const trigger=id=>nodes(root).find(node=>node.dataset.gw5CombatMenu===id);
  const popup=()=>nodes(doc.body).find(node=>node.className.split(' ').includes('gw5-combat-menu'));
  return {value,doc,view,root,trigger,popup,
    open(id='enemy'){const node=trigger(id);node.rect={left:340,right:364,top:350,bottom:374,width:24,height:24};node.onclick(event('click',node));return node;},
    action:name=>nodes(doc.body).find(node=>node.dataset.gw5CombatAction===name),
    emit:type=>{for(const listener of events.get(type)||[])listener();},
    busy:()=>nodes(root).some(node=>node.getAttribute('aria-busy')==='true'),
    dispose:()=>{abort.abort();dispose();}};
}

test('combatant actions escape the scrolling panel, clamp to the viewport and invoke the selected token once',async()=>{
  const panel=await mount();
  try {
    const trigger=panel.open(),popup=panel.popup();
    assert.equal(popup.parentElement,panel.doc.body);
    assert.equal(panel.root.contains(popup),false);
    assert.equal(trigger.getAttribute('aria-expanded'),'true');
    const left=parseFloat(popup.style.left),top=parseFloat(popup.style.top),box=popup.getBoundingClientRect();
    assert.ok(left>=8&&left+box.width<=panel.view.innerWidth-8);
    assert.ok(top>=8&&top+box.height<=panel.view.innerHeight-8);
    const list=popup.children[0];assert.equal(list.getAttribute('role'),'menu');
    assert.equal(list.children.every(item=>item.getAttribute('role')==='menuitem'),true);
    const choose=panel.action('turn/set');choose.onclick(event('click',choose));
    assert.equal(panel.popup(),undefined);
    await until(()=>!panel.busy());
    assert.equal(panel.value.native.combatants[panel.value.native.turn].id,'enemy');
    assert.equal(panel.value.count('combat','setTurn'),1);
    assert.equal(panel.doc.count(),0);assert.equal(panel.view.count(),0);
  } finally {panel.dispose();}
});

test('combat action keyboard navigation skips disabled choices and Escape returns focus without closing the panel',async()=>{
  const panel=await mount();
  try {
    const trigger=panel.open();
    assert.equal(panel.doc.activeElement,panel.action('token/sheet'));
    panel.doc.dispatchEvent(event('keydown',panel.doc.activeElement,{key:'ArrowDown'}));
    assert.equal(panel.doc.activeElement,panel.action('initiative/roll-one'));
    panel.doc.dispatchEvent(event('keydown',panel.doc.activeElement,{key:'ArrowDown'}));
    assert.equal(panel.doc.activeElement,panel.action('turn/set'),'Move actions are disabled in this fixture.');
    panel.doc.dispatchEvent(event('keydown',panel.doc.activeElement,{key:'End'}));
    assert.equal(panel.doc.activeElement,panel.action('combatants/remove'));
    panel.doc.dispatchEvent(event('keydown',panel.doc.activeElement,{key:'Home'}));
    assert.equal(panel.doc.activeElement,panel.action('token/sheet'));
    const escape=event('keydown',panel.doc.activeElement,{key:'Escape'});panel.doc.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented,true);assert.equal(escape.stopped,true);
    assert.equal(panel.popup(),undefined);assert.equal(panel.doc.activeElement,trigger);
    assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.ok(panel.root.children.length);
    trigger.onkeydown(event('keydown',trigger,{key:'ArrowUp'}));
    assert.equal(panel.doc.activeElement,panel.action('combatants/remove'));
    panel.doc.dispatchEvent(event('keydown',panel.doc.activeElement,{key:'Tab'}));
    assert.equal(panel.popup(),undefined);assert.equal(panel.doc.activeElement,trigger);
  } finally {panel.dispose();}
});

test('combat popups close on outside interaction, external scrolling, resizing, rerender and disposal',async()=>{
  const panel=await mount();
  try {
    panel.open('linked');panel.open('enemy');
    assert.equal(nodes(panel.doc.body).filter(node=>node.className.split(' ').includes('gw5-combat-menu')).length,1);
    let popup=panel.popup();panel.doc.dispatchEvent(event('scroll',popup.children[0]));assert.equal(panel.popup(),popup);
    panel.doc.dispatchEvent(event('scroll',panel.root));assert.equal(panel.popup(),popup,'Queued pre-open scroll events do not move the anchor.');
    panel.root.scrollTop=10;panel.doc.dispatchEvent(event('scroll',panel.root));assert.equal(panel.popup(),undefined);
    panel.open();panel.doc.dispatchEvent(event('pointerdown',panel.root));assert.equal(panel.popup(),undefined);
    panel.open();panel.view.dispatchEvent(event('resize',panel.view));assert.equal(panel.popup(),undefined);
    panel.open();panel.emit('combat.changed');await until(()=>panel.popup()===undefined);
    assert.equal(panel.doc.activeElement,panel.trigger('enemy'));
    panel.open();popup=panel.popup();panel.dispose();
    assert.equal(popup.isConnected,false);assert.equal(panel.doc.count(),0);assert.equal(panel.view.count(),0);
    assert.equal(panel.root.children.length,0);
  } finally {panel.dispose();}
});

test('queued scroll-into-view notifications preserve the popup while subsequent ancestor or page movement closes it',async()=>{
  const panel=await mount();
  try {
    panel.root.scrollTop=80;panel.root.scrollLeft=12;panel.view.scrollY=120;
    panel.open();const popup=panel.popup();
    panel.doc.dispatchEvent(event('scroll',panel.root));
    panel.doc.dispatchEvent(event('scroll',panel.doc));
    assert.equal(panel.popup(),popup);
    panel.root.scrollLeft=13;panel.doc.dispatchEvent(event('scroll',panel.root));
    assert.equal(panel.popup(),undefined);
    panel.open();panel.view.scrollY=121;panel.doc.dispatchEvent(event('scroll',panel.doc));
    assert.equal(panel.popup(),undefined);
  } finally {panel.dispose();}
});
