import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {sortItemEntries} from '../tabs.js';
import {itemFieldDefinition} from '../item-editor.js';

const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const locales=['en','pt-BR','es'];

test('item names sort naturally in each active language without changing persisted order or metadata',()=>{
  const entries=[{id:'z',name:'Zebra',prepared:true},{id:'e',name:'Élan',quantity:2},{id:'a10',name:'Arma 10',equipped:true},{id:'a2',name:'Arma 2',data:{damage:'1d8'}}];
  const original=structuredClone(entries);
  for(const locale of locales){
    const sorted=sortItemEntries(entries,locale);
    assert.deepEqual(sorted.map(entry=>entry.id),['a2','a10','e','z']);
    assert.equal(sorted[0],entries[3]);
    assert.deepEqual(entries,original);
    assert.deepEqual(sortItemEntries(entries.map(entry=>({entry})),locale,row=>row.entry.name).map(row=>row.entry),sorted);
  }
});

test('descriptive item options use translated labels while ability links and mechanical tiers retain their order',()=>{
  const visit=(node,result=[])=>{
    if(node.type==='selectField')result.push(node);
    for(const child of node.children||[])visit(child,result);
    return result;
  };
  const alphabetical=new Set(['sheet.school','sheet.damage_type','sheet.category','sheet.subtype']);
  const nodes=readdirSync(new URL('../layouts/items/',import.meta.url)).flatMap(file=>visit(read(`layouts/items/${file}`).body));
  assert.ok(nodes.length>10);
  for(const locale of locales){
    const messages=read(`locales/${locale}.json`),t=key=>messages[key]||key;
    for(const node of nodes){
      const original=structuredClone(node),rendered=itemFieldDefinition(node,t,locale);
      assert.deepEqual(node,original,'Rendering must not mutate declarative layouts');
      assert.deepEqual([...rendered.options].map(option=>option.value).sort(),node.options.map(option=>option.value).sort(),'Every persisted value must remain available');
      if(alphabetical.has(node.path)){
        const names=rendered.options.map(option=>t(option.labelKey||option.label));
        assert.deepEqual(names,[...names].sort(new Intl.Collator(locale,{sensitivity:'base',numeric:true}).compare));
      }else assert.equal(rendered,node,'Preserve meaningful order for mechanical choices');
    }
  }
});
