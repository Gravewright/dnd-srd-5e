import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {hostModule} from './host-paths.mjs';
const {createTranslator} = await import(hostModule('gravewright/modules/static/gravewright_modules/i18n.js'));
const {Lifetime} = await import(hostModule('gravewright/modules/static/gravewright_modules/lifetime.js'));
import system from '../main.js';
import {openModal} from '../sheet.js';

const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const catalogs=Object.fromEntries(['en','pt-BR','es'].map(locale=>[locale,read(`locales/${locale}.json`)]));
const moduleId=read('manifest.json').id;
const message=(language,key)=>catalogs[language][key]??catalogs.en[key];
const placeholders=text=>[...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_.]*|\d+)\}/g)].map(match=>match[1]).sort();
const files=directory=>readdirSync(new URL(`../${directory}/`,import.meta.url),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):entry.name.endsWith('.json')?[`${directory}/${entry.name}`]:[]);
globalThis.window=new EventTarget();
const locale=id=>{window.gravewrightLocale={id,messages:{text:{'host.private':'Host only','itemType.weapon':'Host weapon'}}};};

function activation(t,namespace=moduleId){
  const life=new Lifetime(error=>assert.fail(error));
  const i18n=createTranslator(namespace,life);
  t.after(()=>life.close());
  return {life,i18n};
}

test('all three production catalogs have exact key parity and matching named placeholders',()=>{
  const expected=Object.keys(catalogs.en).sort();
  assert.ok(expected.length>900,'Exercise the complete production catalog');
  for(const [language,messages] of Object.entries(catalogs)){
    const missing=expected.filter(key=>!Object.hasOwn(messages,key));
    const extra=Object.keys(messages).filter(key=>!Object.hasOwn(catalogs.en,key));
    assert.equal(missing.length,0,`${language}: ${missing.length} missing UI translations; examples: ${missing.slice(0,12).join(', ')}`);
    assert.equal(extra.length,0,`${language}: extra UI translations ${extra.join(', ')}`);
    for(const [key,text] of Object.entries(messages)){
      assert.equal(typeof text,'string',`${language}:${key}`);
      assert.ok(text.trim(),`${language}:${key} must not be empty`);
      assert.deepEqual(placeholders(text),placeholders(catalogs.en[key]),`${language}:${key}`);
    }
  }
});

test('every declared layout, schema, action and item-type translation exists in the production catalogs',()=>{
  const keys=new Set();
  function visit(value){
    if(!value||typeof value!=='object')return;
    if(typeof value.labelKey==='string')keys.add(value.labelKey);
    for(const child of Object.values(value))visit(child);
  }
  for(const file of ['manifest.json',...files('layouts'),...files('schemas')])visit(read(file));
  for(const action of Object.values(read('rules/actions.gw.json').actions)){
    // An @item.name label intentionally renders the user's document name.
    if(typeof action.label==='string'&&!action.label.startsWith('@'))keys.add(action.label);
  }
  assert.ok(keys.size>250);
  for(const language of Object.keys(catalogs))for(const key of keys){
    assert.ok(Object.hasOwn(catalogs[language],key),`${language}: untranslated declaration ${key}`);
  }
});

test('the actual host adapter accepts and renders every production translation',t=>{
  const {i18n}=activation(t);
  i18n.register(catalogs);
  for(const [language,messages] of Object.entries(catalogs)){
    locale(language);
    for(const [key,message] of Object.entries(messages)){
      assert.equal(i18n.t(key),message,`${language}:${key}`);
      assert.equal(i18n.has(key),true,`${language}:${key}`);
    }
  }
});

test('production placeholders render user values literally and leave absent arguments visible',t=>{
  const {i18n}=activation(t);
  i18n.register(catalogs);
  const actorName='<img src=x onerror=alert(1)> $& Café — Seraphina';
  for(const language of Object.keys(catalogs)){
    locale(language);
    assert.equal(i18n.t('advancementTitle',{name:actorName}),message(language,'advancementTitle').replace('{name}',()=>actorName));
    assert.equal(i18n.t('inventoryTotals',{count:3,weight:1.25,unit:'kg'}),message(language,'inventoryTotals').replace('{count}','3').replace('{weight}','1.25').replace('{unit}','kg'));
    assert.equal(i18n.t('rest.healing',{value:8}),message(language,'rest.healing').replace('{value}','8'));
    assert.equal(i18n.t('setSlots',{level:2}),message(language,'setSlots').replace('{level}','2'));
    assert.equal(i18n.t('advancementTitle'),message(language,'advancementTitle'));
  }
});

test('regional and absent-Translator fallbacks use the module catalog without borrowing host or other-module text',t=>{
  const {i18n}=activation(t),other=activation(t,'other.system').i18n;
  i18n.register(catalogs);
  other.register({en:{'itemType.weapon':'Other module weapon','other.private':'Private'}});
  locale('es-MX');assert.equal(i18n.t('itemType.weapon'),catalogs.es['itemType.weapon']);
  locale('pt-BR');assert.equal(i18n.t('itemType.weapon'),catalogs['pt-BR']['itemType.weapon']);
  locale('fr-FR');assert.equal(i18n.t('itemType.weapon'),catalogs.en['itemType.weapon']);
  assert.equal(i18n.has('host.private'),false);
  assert.equal(i18n.t('other.private'),'other.private');
  assert.equal(i18n.t('missing.key'),'missing.key');
  delete window.gravewrightLocale;
  assert.equal(i18n.locale,'en');
  assert.equal(i18n.t('shortRest'),catalogs.en.shortRest);
  locale('pt-BR');assert.equal(i18n.number(1234.5),'1.234,5');
  locale('en');assert.equal(i18n.number(1234.5),'1,234.5');
});

test('real system activation registers translations for mounts and reopening, then its lifetime removes them',async t=>{
  locale('pt-BR');
  const {life,i18n}=activation(t),stylePaths=[],eventNames=[];
  await system.start({
    i18n,signal:life.signal,
    assets:{json:async path=>{assert.equal(path,'system.json');return {schemas:{},layouts:{},actions:{},locales:catalogs};}},
    styles:{use:path=>stylePaths.push(path)},
    api:{i18n,events:{on:name=>eventNames.push(name)}},
  });
  t.after(()=>system.stop());
  assert.deepEqual(stylePaths,['styles.css','monster.css']);
  assert.deepEqual(eventNames,['compendiums.changed']);
  const first=new Lifetime(),reopened=new Lifetime();
  t.after(()=>first.close());t.after(()=>reopened.close());
  const firstSurface=createTranslator(moduleId,first),secondSurface=createTranslator(moduleId,reopened);
  assert.equal(firstSurface.t('rest.previewHelp'),catalogs['pt-BR']['rest.previewHelp']);
  await first.close();
  assert.equal(secondSurface.t('rest.previewHelp'),catalogs['pt-BR']['rest.previewHelp']);
  locale('es');
  assert.equal(secondSurface.t('longRest'),message('es','longRest'));
  await life.close();
  assert.equal(secondSurface.has('longRest'),false);
  assert.throws(()=>i18n.t('longRest'),{code:'stale_context'});
});

test('the system detects an unsupported host before attempting assets or any translation fallback',async()=>{
  let assetsRead=false;
  const assets={json:async()=>{assetsRead=true;assert.fail('Unsupported host must fail before loading assets');}};
  for(const context of [{},{i18n:{register(){}},api:{}},{api:{i18n:{t:key=>key}}}]){
    await assert.rejects(()=>system.start({...context,assets}),/official Translator i18n API/);
  }
  assert.equal(assetsRead,false);
});

test('module listeners follow locale events and catalog disposal without leaking after surface close',async t=>{
  locale('en');
  const provider=activation(t),surface=activation(t),seen=[];
  provider.i18n.register(catalogs);
  surface.i18n.onChange(language=>seen.push([language,surface.i18n.t('shortRest')]));
  locale('es');window.dispatchEvent(new Event('gravewright:locale'));
  locale('pt-BR');window.dispatchEvent(new Event('gravewright:locale'));
  assert.deepEqual(seen,[['es',message('es','shortRest')],['pt-BR',catalogs['pt-BR'].shortRest]]);
  await surface.life.close();
  locale('en');window.dispatchEvent(new Event('gravewright:locale'));
  await provider.life.close();
  assert.equal(seen.length,2);
});

test('invalid translated placeholders are rejected atomically without replacing the real catalog',t=>{
  locale('pt-BR');
  const {i18n}=activation(t);i18n.register(catalogs);
  const before=i18n.t('inventoryTotals');
  assert.throws(()=>i18n.register({en:{inventoryTotals:catalogs.en.inventoryTotals},'pt-BR':{inventoryTotals:'{count} {weight} {weight} {unit}'}}),{code:'invalid_data'});
  assert.equal(i18n.t('inventoryTotals'),before);
});

test('the actual 5e modal helper protects translated UI and keeps user titles as text on every open',t=>{
  locale('pt-BR');
  const {life,i18n}=activation(t);i18n.register(catalogs);
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.dataset={};this.attributes={};this.children=[];this.isConnected=true;}
    setAttribute(key,value){this.attributes[key]=value;}
    append(...nodes){this.children.push(...nodes);}
    set innerHTML(_value){assert.fail('User titles must use textContent');}
  }
  const doc={activeElement:null,createElement:tag=>new Element(tag)};
  const mounts=[];
  const api={ui:{openModal:(element,options)=>{assert.deepEqual(options,{nested:true});element.close=()=>{element.isConnected=false;element.dispatchEvent(new Event('close'));};mounts.push(element);return element;}}};
  const name='Fireball <img src=x> $& — Bola de Fogo';
  for(let index=0;index<2;index++){
    const modal=openModal(api,doc,name,life.signal,i18n.t('close'));
    assert.equal(modal.tagName,'SECTION');
    assert.equal(modal.attributes.translate,'no');
    assert.equal(modal.attributes['aria-label'],name);
    assert.equal(modal.children[0].textContent,name);
    assert.equal(modal.children[0].children[0].attributes['aria-label'],catalogs['pt-BR'].close);
    modal.close();
  }
  assert.equal(mounts.length,2);
});
