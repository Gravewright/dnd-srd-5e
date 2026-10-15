import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCombatFormula} from '../combat-formula.js';

test('bounded numeric DSL supports sheet paths, arithmetic, comparisons, eager logic and builtins',async()=>{
  const data={level:4,bars:{bar_1:{value:7,max:10}},flag:true,text:'2.5'};
  for(const [formula,value]of [
    ['@sheet.level * 2 + 1',9],['(1+2)*3-4/2',7],
    ['@sheet.bars.bar_1.value < @sheet.bars.bar_1.max && @sheet.flag',1],
    ['@sheet.missing || 2',1],['if(@sheet.level >= 4, max(2,5), 100)',5],
    ['min()+max()',0],['floor(@sheet.text)+ceil(-1.5)+abs(-3)',4],
    ['clamp(12,0,10)',10],['round(2.5)+round(3.5)+round(-1.5)+round(-2.5)',2],
    ['unknown + @sheet.nope.value',0],['1!=2',1],['3<=2',0],
  ])assert.equal(await evaluateCombatFormula(formula,data),value,formula);
});

test('native random callback receives stable unique node IDs and standard dice expressions',async()=>{
  const calls=[];
  const roll=async(expression,id)=>{calls.push({expression,id});return expression.startsWith('2d20')?19:3;};
  assert.equal(await evaluateCombatFormula('2d20kh1 + 1d4',{}, {roll,prefix:'job'}),22);
  assert.deepEqual(calls.map(call=>call.expression),['2d20kh1','1d4']);
  assert.deepEqual(calls.map(call=>call.id),['job:0','job:2']);
  const again=[];await evaluateCombatFormula('2d20kh1 + 1d4',{}, {roll:async(expression,id)=>{again.push(id);return expression.startsWith('2d20')?19:3;},prefix:'job'});
  assert.deepEqual(again,calls.map(call=>call.id));
});

test('dynamic dice, successes, under, fate, draw and bounded explosions use native rolls',async()=>{
  const values=[5,6,2,1,3,8,10,6,6,2],calls=[];
  const roll=async(expression,id)=>{calls.push({expression,id});return values.shift();};
  assert.equal(await evaluateCombatFormula('die(6)+successes(2,6,5)+under(2,6,2)+fate()+draw(52)+explode(6,6)',{}, {roll}),5+1+1+10+14);
  assert.equal(new Set(calls.map(call=>call.id)).size,calls.length);
  assert.equal(calls.filter(call=>call.expression==='1d6').length,8);
  let rolls=0;
  assert.equal(await evaluateCombatFormula('explode(6,1)',{}, {roll:async()=>{rolls++;return 6;}}),600);
  assert.equal(rolls,100);
});

test('100-die DSL terms split into native 99-die terms with stable journal IDs and keep semantics',async()=>{
  for(const [formula,values,expected]of [
    ['100d1000',[99000,1000],100000],['die(100,1000)',[99000,1000],100000],
    ['100d1000kh1',[900,1000],1000],['100d1000kl1',[700,900],700],
  ]){
    const calls=[];
    const roll=async(expression,id)=>{
      const match=/^(\d+)d(\d+)(kh1|kl1)?$/.exec(expression);
      assert.ok(match);assert.ok(Number(match[1])<=99);assert.ok(Number(match[2])<=1000);
      calls.push({expression,id});return values[calls.length-1];
    };
    assert.equal(await evaluateCombatFormula(formula,{}, {roll,prefix:'job'}),expected);
    const keep=formula.endsWith('kh1')?'kh1':formula.endsWith('kl1')?'kl1':'';
    assert.deepEqual(calls.map(call=>call.expression),[`99d1000${keep}`,`1d1000${keep}`]);
    assert.deepEqual(calls.map(call=>call.id),['job:0:part:0','job:0:part:1']);
    const replay=[];
    await evaluateCombatFormula(formula,{}, {roll:async(expression,id)=>{replay.push({expression,id});return values[replay.length-1];},prefix:'job'});
    assert.deepEqual(replay,calls);
  }
});

test('one-sided dice are rejected as in the original provider before requesting randomness',async()=>{
  let rolls=0;
  for(const formula of ['1d1','100d1','100d1kh1','100d1kl1','die(1)','die(100,1)','draw(1)',
    'successes(2,1,1)','under(2,1,1)','explode(1,1)']){
    await assert.rejects(evaluateCombatFormula(formula,{}, {roll:async()=>{rolls++;return 1;}}),{code:'combat-formula-invalid'},formula);
  }
  assert.equal(rolls,0);
});

test('if and boolean operators evaluate both branches as the previous provider did',async()=>{
  const seen=[];const roll=async(expression,id)=>{seen.push(id);return 2;};
  assert.equal(await evaluateCombatFormula('if(1,1d4,1d6) + (1 || 1d8)',{}, {roll}),3);
  assert.equal(seen.length,3);
});

test('invalid syntax, side effects, unsafe paths and unbounded random work are rejected',async()=>{
  for(const expression of ['','1; globalThis.x=1','@sheet.__proto__.x','@sheet.constructor.x','Math.random()',
    '1/0','unknown(1)','die(1001)','101d6','1d0','successes(2,6,7)','clamp(1,2)','fate(1)','('.repeat(201)]) {
    await assert.rejects(evaluateCombatFormula(expression,{}, {roll:async()=>1}),{code:'combat-formula-invalid'},expression);
  }
  await assert.rejects(evaluateCombatFormula('1d4',{}),{code:'combat-formula-roll-required'});
  await assert.rejects(evaluateCombatFormula('1d4',{}, {roll:async()=>99}),{code:'combat-formula-invalid'});
  let count=0;
  await assert.rejects(evaluateCombatFormula('1d4; invalid',{}, {roll:async()=>{count++;return 1;}}));
  assert.equal(count,0);
});
