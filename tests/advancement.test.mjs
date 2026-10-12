import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planAdvancement,removeAdvancement,syncAdvancementLevel} from '../advancement.js';
import {damageTraits,mechanicalTraits,derive,armorState} from '../rules.js';

const actor=(extra={})=>({rulesEdition:'2014',level:1,abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(id=>[id,{score:10}])),skills:{},saves:{},armorTraining:{light:true,medium:true,heavy:true,shield:true},features:[],inventory:[],weapons:[],spells:[],languages:'',hpBaseMax:10,bars:{bar_1:{value:10,max:10},bar_2:{value:0,max:0}},...extra});
const row=(type,configuration={},extra={})=>({id:type.toLowerCase(),type,configuration,...extra});
const entry=(id,type,data={})=>({id,name:id,type,data:{rulesEdition:'2014',...data}});
const catalog=(...items)=>new Map(items.map(item=>[item.id,item]));
const opts={type:'character',role:'gm',edition:'2014'};
function resolve(draft,item,book,options={},answers={}){
  for(let round=0;round<30;round++){
    const plan=planAdvancement(draft,item,book,answers,{...opts,...options});if(!plan.choices.length)return plan;
    for(const choice of plan.choices){
      if(choice.type==='number')answers[choice.id]=choice.average||choice.min;
      else if(choice.type==='ability'){
        let remaining=choice.points;const values={};for(const ability of choice.abilities){values[ability.id]=Math.min(ability.max,remaining);remaining-=values[ability.id];}
        assert.equal(remaining,0,JSON.stringify(choice));answers[choice.id]=values;
      }else{assert.ok(choice.options.length>=choice.count,JSON.stringify(choice));answers[choice.id]=choice.type==='select'?choice.options[0].id:choice.options.slice(0,choice.count).map(option=>option.id);}
    }
  }
  assert.fail('Unresolved advancement loop');
}

test('origin plans are pure, collect all choices, and preserve portable source data',()=>{
  const fire=entry('fire','spell',{level:0}),feat=entry('feat','feature',{advancement:[row('ItemGrant',{items:[{id:'fire'}],spell:{ability:['int','wis','cha'],preparation:'always'}})]});
  const race=entry('race','race',{speed:30,senses:{darkvision:60},advancement:[row('Size',{sizes:['small','medium']}),row('Trait',{grants:['languages:standard:common'],choices:[{count:2,pool:['skills:*']}]}),row('ItemGrant',{items:[{id:'feat'}]})]});
  const draft=actor(),before=structuredClone(draft),source=structuredClone(race),book=catalog(race,feat,fire);
  const pending=planAdvancement(draft,race,book,{},opts);assert.equal(pending.choices.length,3);assert.deepEqual(draft,before);assert.deepEqual(race,source);
  const result=resolve(draft,race,book);assert.equal(result.choices.length,0);assert.equal(result.data.speed,30);assert.equal(result.data.senses.darkvision,60);assert.equal(result.data.languages,'Common');assert.equal(result.data.spells[0].prepared,true);assert.equal(result.data.spells[0].data.spell_ability,'int');
  assert.equal(result.data.features.length,2);assert.equal(result.data.spells.length,1);assert.deepEqual(draft,before);assert.deepEqual(race,source);
  const duplicate=planAdvancement(result.data,race,book,{},opts);assert.equal(duplicate.data.features.length,2);assert.equal(duplicate.summary[0].kind,'existing');
});

test('trait choices validate exact count, allowed pool, uniqueness and expertise eligibility',()=>{
  const origin=entry('skills','background',{advancement:[row('Trait',{grants:[],choices:[{count:2,pool:['skills:athletics','skills:acrobatics','skills:history']}]})]});
  const draft=actor(),book=catalog(origin),pending=planAdvancement(draft,origin,book,{},opts),id=pending.choices[0].id;
  for(const answer of [[],['skills:athletics'],['skills:athletics','skills:athletics'],['skills:athletics','skills:arcana']]){
    const plan=planAdvancement(draft,origin,book,{[id]:answer},opts);assert.equal(plan.choices.length,1);assert.equal(plan.choices[0].error,'invalidAnswer');assert.deepEqual(draft.skills,{});
  }
  const expert=entry('expert','feat',{advancement:[row('Trait',{mode:'expertise',choices:[{count:1,pool:['skills:*']}]})]});
  const trained=actor({skills:{athletics:{prof:true},arcana:{prof:true,expert:true}}});
  const choices=planAdvancement(trained,expert,catalog(expert),{},opts).choices[0];assert.deepEqual(choices.options.map(option=>option.id),['skills:athletics']);
  const result=planAdvancement(trained,expert,catalog(expert),{[choices.id]:['skills:athletics']},opts);assert.equal(result.data.skills.athletics.expert,true);
});

test('2014 racial ASI and 2024 background ASI enforce fixed points, cap and score maximum',()=>{
  const half=entry('half','race',{advancement:[row('AbilityScoreImprovement',{fixed:{cha:2},points:2,cap:1,locked:[]})]});
  const pending=planAdvancement(actor(),half,catalog(half),{},opts),choice=pending.choices[0];assert.ok(!choice.abilities.some(option=>option.id==='cha'));assert.equal(pending.data.abilities.cha.score,12);
  for(const answer of [{str:2},{str:1,cha:1},{str:1,dex:-1,con:2},{str:1.5,dex:0.5}])assert.equal(planAdvancement(actor(),half,catalog(half),{[choice.id]:answer},opts).choices[0].error,'invalidAnswer');
  const result=planAdvancement(actor(),half,catalog(half),{[choice.id]:{str:1,dex:1}},opts);assert.equal(result.data.abilities.str.score,11);
  const modern=entry('modern','background',{rulesEdition:'2024',advancement:[row('AbilityScoreImprovement',{points:3,cap:2,locked:['str','dex','con']})]});
  const modernChoice=planAdvancement(actor(),modern,catalog(modern),{},opts).choices[0];assert.deepEqual(modernChoice.abilities.map(option=>option.id),['int','wis','cha']);
  const species=entry('species','race',{rulesEdition:'2024',advancement:[row('AbilityScoreImprovement',{fixed:{str:2}})]});
  const noASI=planAdvancement(actor(),species,catalog(species),{},opts);assert.equal(noASI.data.abilities.str.score,10);assert.ok(noASI.warnings.some(warning=>warning.code==='speciesASI2024Ignored'));
});

test('replace and remove origins preserve shared grants, previous values and manual changes',()=>{
  const shared=entry('shared','feature',{mechanicalTraits:{saveAdvantages:['poisoned']},advancement:[row('Trait',{grants:['dr:fire','skills:perception']})]});
  const race=entry('race','race',{speed:25,advancement:[row('AbilityScoreImprovement',{fixed:{str:2}}),row('ItemGrant',{items:[{id:'shared'}]})]}),bg=entry('bg','background',{advancement:[row('ItemGrant',{items:[{id:'shared'}]})]});
  const book=catalog(shared,race,bg),original=actor({speed:30,skills:{history:{prof:true}}});
  const a=resolve(original,race,book),b=resolve(a.data,bg,book);assert.equal(b.data.features.filter(item=>item.source==='shared').length,1);
  const removed=removeAdvancement(b.data,a.parentId);assert.equal(removed.data.speed,30);assert.deepEqual(damageTraits(removed.data).resistances,['fire']);assert.equal(removed.data.skills.perception.prof,true);
  const last=removeAdvancement(removed.data,b.parentId);assert.deepEqual(damageTraits(last.data).resistances,[]);assert.equal(last.data.features.length,0);assert.equal(last.data.skills.history.prof,true);
  const edited=structuredClone(a.data);edited.abilities.str.score=15;edited.speed=40;edited.skills.perception.prof=false;edited.features.find(item=>item.source==='shared').name='Custom feature';
  const manual=removeAdvancement(edited,a.parentId);assert.equal(manual.data.abilities.str.score,13);assert.equal(manual.data.speed,40);assert.equal(manual.data.skills.perception.prof,false);assert.ok(manual.data.features.some(item=>item.name==='Custom feature'));
  const replacement=resolve(a.data,entry('other','race',{speed:35}),book);assert.equal(replacement.data.race,'other');assert.equal(replacement.data.abilities.str.score,10);assert.equal(replacement.data.features.length,1);
});

test('recursive grants handle cycles and missing licensed references without mutation or duplication',()=>{
  const a=entry('a','feat',{advancement:[row('ItemGrant',{items:[{id:'b'},{id:'missing'}]})]}),b=entry('b','feature',{advancement:[row('ItemGrant',{items:[{id:'a'}]})]});
  const result=planAdvancement(actor(),a,catalog(a,b),{},opts);assert.equal(result.data.features.length,2);assert.ok(result.warnings.some(warning=>warning.code==='advancementCycle'));assert.ok(result.warnings.some(warning=>warning.code==='missingGrant'));
});

const fighter=()=>entry('fighter','class',{identifier:'fighter',hit_die:'d10',advancement:[row('HitPoints'),row('Trait',{grants:['saves:str','saves:con','armor:heavy','armor:shield','weapon:martial']},{id:'primary',level:1,classRestriction:'primary'}),row('Trait',{grants:['armor:light']},{id:'secondary',level:1,classRestriction:'secondary'}),row('ItemGrant',{items:[{id:'extra'}]},{id:'extra-grant',level:5}),row('ScaleValue',{identifier:'second-wind',scale:{1:{value:1},3:{value:2}}})]});
const wizard=()=>entry('wizard','class',{identifier:'wizard',hit_die:'d6',spellcasting_ability:'int',advancement:[row('HitPoints'),row('Trait',{grants:['saves:int','saves:wis']},{classRestriction:'primary',level:1})]});

test('primary classes reset generated armor defaults and secondary classes do not grant primary saves',()=>{
  const f=fighter(),w=wizard(),extra=entry('extra','feature'),book=catalog(f,w,extra);
  const primary=resolve(actor(),w,book);assert.equal(primary.data.hpBaseMax,6);assert.deepEqual(primary.data.armorTraining,{light:false,medium:false,heavy:false,shield:false});assert.equal(primary.data.saves.int.prof,true);assert.equal(primary.data.weaponProficiencyMode,'class');
  const multi=resolve(primary.data,f,book);assert.equal(multi.data.level,2);assert.equal(multi.data.hpBaseMax,12);assert.equal(multi.data.saves.str?.prof,undefined);assert.equal(multi.data.armorTraining.light,true);assert.equal(multi.data.armorTraining.heavy,false);assert.equal(multi.data.hitDicePools.length,2);
  const removed=removeAdvancement(multi.data,multi.parentId);assert.equal(removed.data.level,1);assert.equal(removed.data.hpBaseMax,6);assert.equal(removed.data.hitDicePools.length,1);assert.equal(removed.data.armorTraining.light,false);
});

test('class levels gate subclass grants by class rather than total level and preserve spent hit dice',()=>{
  const f=fighter(),w=wizard(),extra=entry('extra','feature'),sub=entry('champion','feature',{subclass:true,classIdentifier:'fighter',advancement:[row('ItemGrant',{items:[{id:'sub-extra'}]},{level:3})]}),subExtra=entry('sub-extra','feature'),book=catalog(f,w,extra,sub,subExtra);
  assert.throws(()=>planAdvancement(actor(),sub,book,{},opts),/matching class/);
  const wiz=resolve(actor(),w,book,{classLevel:4}),fight=resolve(wiz.data,f,book),champion=resolve(fight.data,sub,book);
  assert.equal(champion.data.level,5);assert.ok(!champion.data.features.some(item=>item.source==='sub-extra'));
  const before=structuredClone(champion.data);before.hitDicePools.find(pool=>pool.id===fight.parentId).value=0;
  let result=syncAdvancementLevel(before,fight.parentId,3,book),answers={};
  for(const choice of result.choices)answers[choice.id]=choice.type==='number'?choice.average:choice.options[0]?.id;
  result=syncAdvancementLevel(before,fight.parentId,3,book,answers);assert.equal(result.choices.length,0);assert.equal(result.data.level,7);assert.ok(result.data.features.some(item=>item.source==='sub-extra'));assert.equal(result.data.hitDicePools.find(pool=>pool.id===fight.parentId).value,2);
  const lower=syncAdvancementLevel(result.data,fight.parentId,1,book);assert.equal(lower.choices.length,0);assert.ok(!lower.data.features.some(item=>item.source==='sub-extra'));assert.equal(lower.data.level,5);
});

test('level synchronization grants and removes species spells at total character level',()=>{
  const spell=entry('lineage-spell','spell',{level:1}),race=entry('lineage','race',{advancement:[row('ItemGrant',{items:[{id:spell.id}]},{level:3})]}),f=fighter(),book=catalog(spell,race,f,entry('extra','feature'));
  const origin=resolve(actor(),race,book),first=resolve(origin.data,f,book);assert.equal(first.data.spells.length,0);
  let up=syncAdvancementLevel(first.data,first.parentId,3,book),answers={};for(const choice of up.choices)answers[choice.id]=choice.average;
  up=syncAdvancementLevel(first.data,first.parentId,3,book,answers);assert.equal(up.choices.length,0);assert.equal(up.data.spells.length,1);
  const down=syncAdvancementLevel(up.data,first.parentId,1,book);assert.equal(down.data.spells.length,0);assert.equal(down.data.level,1);
});

test('all eleven owned types route through structured grants while effects retain GM restriction',()=>{
  const types=['weapon','armor','equipment','consumable','spell','feat','feature','race','background','class','effect'];
  for(const type of types){const child=entry('child-'+type,type),root=entry('root-'+type,'feat',{advancement:[row('ItemGrant',{items:[{id:child.id}]})]}),plan=planAdvancement(actor(),root,catalog(root,child),{},opts);assert.ok(Object.values(plan.data).some(value=>Array.isArray(value)&&value.some(item=>item?.source===child.id)),type);}
  assert.throws(()=>planAdvancement(actor(),entry('effect','effect'),new Map(),{}, {...opts,role:'player'}),/GM/);
  assert.throws(()=>planAdvancement(actor(),entry('feature','feature'),new Map(),{}, {...opts,canEdit:false}),/edit access/);
  assert.throws(()=>planAdvancement(actor(),entry('feature','feature'),new Map(),{}, {...opts,type:'monster'}),/character/);
});

test('removing an ordinary child never removes its parent advancement',()=>{
  const child=entry('child','feature'),origin=entry('origin','race',{advancement:[row('ItemGrant',{items:[{id:'child'}]})]});
  const result=resolve(actor(),origin,catalog(origin,child)),childId=result.data.features.find(item=>item.source==='child').id;
  const removed=removeAdvancement(result.data,childId);assert.ok(removed.data.advancementLedger.parents[result.parentId]);assert.equal(removed.data.features.length,2);
});

test('spell choice lists stay exclusive and preserve each owned spell edition and ability',()=>{
  const cleric=entry('cleric-spell','spell',{level:0,spellLists:['cleric'],rulesEdition:'2024'}),wizard=entry('wizard-spell','spell',{level:0,spellLists:['wizard']}),first=entry('initiate','feat',{advancement:[row('ItemChoice',{choices:{0:{count:1}},pool:[cleric.id,wizard.id],restriction:{level:'0',list:['class:cleric','class:wizard']},spell:{ability:['int','wis','cha']}})]});
  const book=catalog(cleric,wizard,first),pending=planAdvancement(actor(),first,book,{},opts);assert.equal(pending.choices.length,1);assert.equal(pending.choices[0].kind,'SpellList');
  const answers={[pending.choices[0].id]:'cleric'},spells=planAdvancement(actor(),first,book,answers,opts);assert.deepEqual(spells.choices[0].options.map(option=>option.id),[cleric.id]);
  answers[spells.choices[0].id]=[cleric.id];const ability=planAdvancement(actor(),first,book,answers,opts).choices[0];answers[ability.id]='wis';
  const result=planAdvancement(actor(),first,book,answers,opts);assert.equal(result.choices.length,0);assert.equal(result.data.spells[0].data.rulesEdition,'2024');assert.equal(result.data.spells[0].data.spell_ability,'wis');
});

test('spell slot progression follows class and multiclass editions while retaining spent slots',()=>{
  const full=edition=>({...wizard(),id:'wizard-'+edition,data:{...wizard().data,rulesEdition:edition,spellcasting:{progression:'full'}}});
  const half=edition=>entry('paladin-'+edition,'class',{rulesEdition:edition,identifier:'paladin',hit_die:'d10',spellcasting:{progression:'half'},advancement:[row('HitPoints')]});
  for(const edition of ['2014','2024']){
    const w=full(edition),p=half(edition),book=catalog(w,p);
    const paladin=resolve(actor(),p,book);assert.equal(paladin.data.slots.l1.max,edition==='2014'?0:2);
    const wiz=resolve(actor(),w,book);wiz.data.slots.l1.value=1;
    const multi=resolve(wiz.data,p,book);assert.equal(multi.data.slots.l1.max,edition==='2014'?2:3);assert.equal(multi.data.slots.l1.value,edition==='2014'?1:2);
    const removed=removeAdvancement(multi.data,multi.parentId,book);assert.equal(removed.data.slots.l1.max,2);assert.equal(removed.data.slots.l1.value,1);
  }
  const w=full('2024'),book=catalog(w),third=resolve(actor(),w,book,{classLevel:3});assert.deepEqual(third.data.slots.l1,{max:4,value:4});assert.deepEqual(third.data.slots.l2,{max:2,value:2});
  const pact=entry('warlock','class',{identifier:'warlock',hit_die:'d8',spellcasting:{progression:'pact'},advancement:[row('HitPoints')]});
  const warlock=resolve(actor(),pact,catalog(pact),{classLevel:5});assert.deepEqual(warlock.data.pactSlots,{max:2,level:3,value:2});assert.equal(warlock.data.slots,undefined);
});

test('removing a class recalculates species level gates and remaining class HP',()=>{
  const lineageSpell=entry('lineage-spell','spell'),race=entry('lineage','race',{advancement:[row('ItemGrant',{items:[{id:lineageSpell.id}]},{level:3})]}),f=fighter(),w=wizard(),book=catalog(lineageSpell,race,f,w,entry('extra','feature'));
  const first=resolve(actor(),race,book),second=resolve(first.data,f,book,{classLevel:2}),third=resolve(second.data,w,book);
  let updated=syncAdvancementLevel(third.data,second.parentId,2,book);assert.equal(updated.choices.length,0);assert.equal(updated.data.level,3);assert.equal(updated.data.spells.length,1);
  const removed=removeAdvancement(updated.data,third.parentId,book);assert.equal(removed.data.level,2);assert.equal(removed.data.spells.length,0);assert.equal(removed.data.hpBaseMax,16);
});

test('equipment and feature passive traits follow active state rather than global ledger contributions',()=>{
  const armor=entry('armor','armor',{armor_type:'heavy',requiresAttunement:true,mechanicalTraits:{hpFlat:5},advancement:[row('Trait',{grants:['dr:fire','ci:poisoned']})]}),book=catalog(armor),result=planAdvancement(actor(),armor,book,{},opts);
  assert.equal(result.data.mechanicalTraits?.hpFlat,undefined);assert.deepEqual(result.data.inventory[0].data.damageTraits.resistances,['fire']);assert.equal(result.data.inventory[0].attuned,false);
  assert.deepEqual(damageTraits(result.data).resistances,[]);assert.equal(mechanicalTraits(result.data).hpFlat??0,0);
  result.data.inventory[0].attuned=true;assert.deepEqual(damageTraits(result.data).resistances,['fire']);assert.equal(mechanicalTraits(result.data).hpFlat,5);
  result.data.inventory[0].equipped=false;assert.deepEqual(damageTraits(result.data).resistances,[]);assert.equal(mechanicalTraits(result.data).hpFlat??0,0);
});

test('resync preserves spent resources and mutable state while level removal deletes automatic grants',()=>{
  const resource=entry('resource','feature',{uses:{max:0,value:0},usesProfile:{type:'classLevel',classId:'fighter'}}),f={...fighter(),data:{...fighter().data,advancement:[row('HitPoints'),row('ItemGrant',{items:[{id:resource.id}]},{level:1})]}},book=catalog(f,resource);
  const first=resolve(actor(),f,book,{classLevel:2}),schema=JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url))),derived=derive(first.data,'character',schema,'2014');
  const feat=derived.features.find(item=>item.source===resource.id);assert.equal(feat.data.uses.max,2);feat.data.uses.value=1;feat.data.usesSpent=1;feat.enabled=false;
  const up=syncAdvancementLevel(derived,first.parentId,3,book),answers={};for(const choice of up.choices)answers[choice.id]=choice.average;
  const final=syncAdvancementLevel(derived,first.parentId,3,book,answers),updated=derive(final.data,'character',schema,'2014'),newFeat=updated.features.find(item=>item.source===resource.id);
  assert.equal(newFeat.data.uses.max,3);assert.equal(newFeat.data.uses.value,2);assert.equal(newFeat.enabled,false);assert.equal(updated.features.filter(item=>item.source===resource.id).length,1);
  const removed=removeAdvancement(updated,first.parentId,book);assert.equal(removed.data.features.length,0);assert.equal(removed.data.bars.bar_1.value<=derived.bars.bar_1.value,true);
});

test('derived Constitution HP changes are not mistaken for a manual maximum override on resync',()=>{
  const f=fighter(),book=catalog(f,entry('extra','feature')),first=resolve(actor(),f,book,{classLevel:2}),schema=JSON.parse(readFileSync(new URL('../schemas/character.schema.json',import.meta.url)));
  const changed=structuredClone(first.data);changed.abilities.con.score=14;
  const derived=derive(changed,'character',schema,'2014');assert.equal(derived.hpBaseMax,20);
  const sync=syncAdvancementLevel(derived,first.parentId,2,book);assert.equal(sync.choices.length,0);assert.equal(sync.data.hpBaseMax,20);assert.equal(sync.data.hpConModifier,2);
  const manual=structuredClone(derived);manual.hpBaseMax+=3;manual.bars.bar_1.max+=3;manual.hpDerivedMax+=3;
  assert.equal(syncAdvancementLevel(manual,first.parentId,2,book).data.hpBaseMax,23);
});

test('starting equipment resolves one package, quantities and money without duplicating consumed grants',()=>{
  const sword=entry('sword','weapon'),dagger=entry('dagger','weapon'),gear={groups:[{id:'pick',type:'OR',group:''},{id:'a',type:'AND',group:'pick'},{id:'b',type:'AND',group:'pick'},{id:'sword-row',type:'linked',group:'a',itemId:sword.id,quantity:1},{id:'gold-row',type:'currency',group:'a',currency:'gp',quantity:50},{id:'daggers',type:'linked',group:'b',itemId:dagger.id,quantity:2}],wealth:{amount:100,currency:'gp'}};
  const f={...fighter(),data:{...fighter().data,advancement:[row('HitPoints')],startingEquipment:gear}},book=catalog(f,sword,dagger),draft=actor({currency:{gp:0}});
  const first=resolve(draft,f,book);assert.equal(first.data.weapons.length,1);assert.equal(first.data.weapons[0].source,sword.id);assert.equal(first.data.currency.gp,50);
  first.data.currency.gp=20;first.data.weapons[0].quantity=0;
  let next=syncAdvancementLevel(first.data,first.parentId,2,book),answers={};for(const choice of next.choices)answers[choice.id]=choice.average;
  next=syncAdvancementLevel(first.data,first.parentId,2,book,answers);assert.equal(next.choices.length,0);assert.equal(next.data.currency.gp,20);assert.equal(next.data.weapons[0].quantity,0);
  const removed=removeAdvancement(next.data,next.parentId,book);assert.equal(removed.data.currency.gp,0);assert.equal(removed.data.weapons.length,0);
  const wealth=planAdvancement(draft,f,book,{[`${f.id}:starting:method`]:'wealth'},opts);assert.equal(wealth.choices.length,0);assert.equal(wealth.data.currency.gp,100);assert.equal(wealth.data.weapons.length,0);
  const other=planAdvancement(draft,f,book,{[`${f.id}:starting:method`]:'equipment',[`${f.id}:starting:pick`]:'b'},opts);assert.equal(other.data.weapons[0].source,dagger.id);assert.equal(other.data.weapons[0].quantity,2);assert.equal(other.data.currency.gp,0);
  const secondary=resolve(first.data,wizard(),catalog(f,sword,dagger,wizard()));assert.equal(secondary.data.currency.gp,20);assert.equal(secondary.data.weapons.length,1);
});

test('class ASI may choose only eligible same-edition general feats and invocation prerequisites are enforced',()=>{
  const feat=entry('eligible','feat',{featCategory:'general',prerequisiteLevel:4}),origin=entry('origin-only','feat',{featCategory:'origin'}),future=entry('future','feat',{prerequisiteLevel:19}),foreign=entry('foreign','feat',{rulesEdition:'2024'});
  const f={...fighter(),data:{...fighter().data,advancement:[row('HitPoints'),row('AbilityScoreImprovement',{points:2,cap:2,allowFeats:true},{level:4})]}},book=catalog(f,feat,origin,future,foreign);
  const pending=planAdvancement(actor(),f,book,{}, {...opts,classLevel:4}),choice=pending.choices.find(choice=>choice.kind==='AbilityOrFeat');assert.deepEqual(choice.options.map(option=>option.id),['ability',feat.id]);
  const answers={[choice.id]:feat.id};for(const hp of pending.choices.filter(choice=>choice.type==='number'))answers[hp.id]=hp.average;
  const selected=planAdvancement(actor(),f,book,answers,{...opts,classLevel:4});assert.equal(selected.choices.length,0);assert.ok(selected.data.features.some(item=>item.source===feat.id));assert.equal(selected.data.abilities.str.score,10);
  const inv=entry('inv','feature',{prerequisiteLevel:5,prerequisiteClass:'fighter',prerequisiteItems:['pact']}),choiceItem=entry('chooser','feat',{advancement:[row('ItemChoice',{pool:[inv.id],choices:{0:{count:1}}})]});
  const low=planAdvancement(actor(),choiceItem,catalog(choiceItem,inv),{},opts);assert.equal(low.choices[0].options.length,0);
});

test('class availability alternatives are OR branches and owned prerequisite features precede choices',()=>{
  const style=entry('archery','feat',{identifier:'archery',prerequisiteAlternatives:[{classId:'fighter',level:1},{classId:'ranger',level:2}]}),feature=entry('fighting-style','feature',{identifier:'fighting-style'}),modern=entry('defense','feat',{identifier:'defense',prerequisiteItems:['fighting-style']});
  const f={...fighter(),data:{...fighter().data,advancement:[row('ItemChoice',{pool:[style.id,modern.id],choices:{1:{count:1}}},{level:0}),row('ItemGrant',{items:[{id:feature.id}]},{level:1})]}},book=catalog(f,style,feature,modern);
  const pending=planAdvancement(actor(),f,book,{},opts);assert.deepEqual(pending.choices[0].options.map(option=>option.id),[style.id,modern.id]);
  const ranger=entry('ranger','class',{identifier:'ranger',hit_die:'d10',advancement:[row('ItemChoice',{pool:[style.id],choices:{2:{count:1}}},{level:0})]});
  assert.equal(planAdvancement(actor(),ranger,catalog(ranger,style),{},{...opts,classLevel:2}).choices[0].options[0].id,style.id);
  const invalid=entry('invalid','feat',{prerequisiteAlternatives:[{classId:'fighter',subclassId:'champion',level:10}]}),chooser=entry('chooser','feat',{advancement:[row('ItemChoice',{pool:[invalid.id],choices:{0:{count:1}}})]});
  const leveled=resolve(actor(),fighter(),catalog(fighter(),entry('extra','feature')),{classLevel:10});assert.equal(planAdvancement(leveled.data,chooser,catalog(chooser,invalid),{},opts).choices[0].options.length,0);
});

test('granted spells initialize portable usage profiles and preserve spent uses across resync',()=>{
  const spell=entry('signature','spell'),origin=entry('signature-feature','feature',{advancement:[row('ItemGrant',{items:[{id:spell.id}],spell:{uses:{maxProfile:{type:'constant',value:1},per:'sr'},preparation:'always'}})]}),book=catalog(spell,origin);
  const initial=resolve(actor(),origin,book);assert.deepEqual(initial.data.spells[0].data.uses,{value:1,max:1});assert.equal(initial.data.spells[0].data.recharge,'short');assert.deepEqual(initial.data.spells[0].data.usesProfile,{type:'constant',value:1});
  initial.data.spells[0].data.uses.value=0;initial.data.spells[0].data.usesSpent=1;
  const again=planAdvancement(initial.data,origin,book,{}, {...opts,resync:true});assert.equal(again.data.spells[0].data.uses.value,0);assert.equal(again.data.spells.length,1);
});

const real=Object.fromEntries(['2014','2024'].map(edition=>[edition,JSON.parse(readFileSync(new URL(`../compendiums/${edition}.json`,import.meta.url))).packs.flatMap(pack=>pack.entries)]));
test('2014 real Monk and Barbarian multiclassing keeps only the first Unarmored Defense in both orders',()=>{
  const book=catalog(...real['2014'],...real['2024']);
  for(const edition of ['2014','2024'])for(const firstId of ['monk','barbarian']){
    const secondId=firstId==='monk'?'barbarian':'monk',first=real[edition].find(item=>item.type==='class'&&item.data.identifier===firstId),second=real[edition].find(item=>item.type==='class'&&item.data.identifier===secondId);
    const original=actor({rulesEdition:edition,acMode:'equipment'});original.abilities.dex.score=14;original.abilities.con.score=firstId==='monk'?18:12;original.abilities.wis.score=firstId==='monk'?12:18;
    const primary=resolve(original,first,book),before=structuredClone(primary.data),multi=resolve(primary.data,second,book);
    assert.deepEqual(primary.data,before);assert.deepEqual(mechanicalTraits(multi.data).unarmoredDefense.sort(),(edition==='2014'?[firstId]:[firstId,secondId]).sort());
    const unequipped={...multi.data,inventory:[],equipment:[]};assert.equal(armorState(unequipped,edition).ac,edition==='2014'?13:16);
    if(edition==='2014')assert.ok(multi.warnings.some(warning=>warning.code==='multiclassUnarmoredDefense2014'));
    const up=resolve(multi.data,second,book,{parentId:multi.parentId,resync:true,classLevel:3});assert.deepEqual(mechanicalTraits(up.data).unarmoredDefense.sort(),(edition==='2014'?[firstId]:[firstId,secondId]).sort());
    const removed=removeAdvancement(up.data,multi.parentId,book);assert.deepEqual(mechanicalTraits(removed.data).unarmoredDefense,[firstId]);
  }
});

test('2014 multiclass Unarmored Defense gate preserves an independently owned disabled feature',()=>{
  const barbarian=real['2014'].find(item=>item.type==='class'&&item.data.identifier==='barbarian'),book=catalog(...real['2014']);
  const first=resolve(actor(),wizard(),catalog(wizard()));first.data.features.push({id:'manual-defense',type:'feature',name:'Manual defense',enabled:false,data:{mechanicalTraits:{unarmoredDefense:'monk'}}});
  const second=resolve(first.data,barbarian,book);assert.equal(second.data.features.filter(item=>item.data?.mechanicalTraits?.unarmoredDefense).length,1);assert.equal(second.data.features.find(item=>item.id==='manual-defense').enabled,false);
  const removed=removeAdvancement(second.data,second.parentId,book);assert.ok(removed.data.features.some(item=>item.id==='manual-defense'));
});

test('all real SRD races and backgrounds resolve their complete licensed advancement trees',()=>{
  const book=catalog(...real['2014'],...real['2024']);let tested=0;
  for(const edition of ['2014','2024'])for(const item of real[edition].filter(item=>['race','background'].includes(item.type))){
    const result=resolve(actor(),item,book);assert.equal(result.choices.length,0,`${edition}/${item.name}`);assert.equal(result.data.features.find(entry=>entry.id===result.data.advancementLedger.parents[result.parentId].owned[0]).source,item.id);
    assert.equal(result.data.features.filter(entry=>entry.source===item.id).length,1);tested++;
  }
  assert.ok(tested>=20);
});

test('all 24 real SRD classes resolve through levels 1, 3, 5 and 20',()=>{
  const book=catalog(...real['2014'],...real['2024']);let tested=0;
  for(const edition of ['2014','2024'])for(const item of real[edition].filter(item=>item.type==='class'))for(const classLevel of [1,3,5,20]){
    const plan=resolve(actor(),item,book,{classLevel});assert.equal(plan.data.level,classLevel,`${edition}/${item.name}/${classLevel}`);assert.ok(plan.data.hpBaseMax>=classLevel);tested++;
  }
  assert.equal(tested,96);
});
