import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rollResult,rollOutcome,heroicDice,heroicReroll} from '../automation.js';
const pool = (faces,sides=20,operations=[],start=0,end=7) => ({sourceSpan:{start,end},plan:{initial:{sides},operations},facts:faces.map((face,index)=>({id:String(index),face})),selection:Object.fromEntries(faces.map((_,index)=>[String(index),index ? 'discarded' : 'active']))});
const result = (value,rolls) => ({value:{value},rolls});
test('native results use the kept natural die, not total or discarded 20',()=>{
 const parsed=rollResult({roll:{result:result(9,[pool([4,20])])}});
 assert.equal(parsed.total,9);assert.equal(parsed.natural,4);
 assert.equal(rollOutcome('weapon.attack',parsed,{ac:12}),'miss');
 assert.equal(rollOutcome('roll.check.str',{total:20,natural:20},{dc:25}),'failure');
 assert.equal(rollOutcome('weapon.attack',{total:18,natural:20},{ac:30}),'critical');
 assert.equal(rollOutcome('weapon.attack',{total:18,natural:12},{ac:15,criticalOnHit:true}),'critical');
 assert.equal(rollOutcome('weapon.attack',{total:18,natural:1},{ac:15,criticalOnHit:true}),'miss');
 assert.throws(()=>rollResult({roll:{result:{}}}));
});
test('Heroic Inspiration freezes other dice and reselects advantage after one replacement',()=>{
 const original=result(20,[pool([16,7],20,[{category:'selection',kind:'keep',count:1,direction:'highest'}],0,7),pool([4],4,[],10,13)]);
 const plan=heroicReroll('2d20kh1 + 1d4',original,{poolIndex:0,factId:'1'});
 assert.equal(plan.expression,'max(16, 1d20) + (4)');
 assert.equal(plan.natural(result(20,[pool([12])])),16);
 assert.equal(plan.natural(result(24,[pool([20])])),20);
});
test('Heroic Inspiration replaces only one damage die and rejects generated/rerolled pools',()=>{
 const original=result(13,[pool([5,6],6,[],0,3)]);original.rolls[0].selection['1']='active';
 assert.equal(heroicReroll('2d6 + 2',original,{poolIndex:0,factId:'0'}).expression,'(1d6 + 6) + 2');
 assert.equal(heroicDice(result(4,[pool([4],6,[{category:'generation',kind:'reroll'}])])).length,0);
 assert.equal(heroicDice(result(9,[pool([4,5],6,[{category:'selection',kind:'keep',count:2,direction:'highest'}])])).length,0);
});
