// Original, portable character advancement. Plans never mutate actor or catalogue data.
import {ABILITIES,SKILLS,get,set,mod,effectiveAbilityScore,evaluateUsesProfile} from './rules.js';

const COLLECTIONS={weapon:'weapons',armor:'inventory',equipment:'inventory',consumable:'inventory',spell:'spells',feat:'features',feature:'features',race:'features',background:'features',class:'features',effect:'effects'};
const ARMOR={lgt:'light',med:'medium',hvy:'heavy',shl:'shield',light:'light',medium:'medium',heavy:'heavy',shield:'shield'};
const SKILL_ALIASES={acr:'acrobatics',ani:'animal_handling',arc:'arcana',ath:'athletics',dec:'deception',his:'history',ins:'insight',itm:'intimidation',inv:'investigation',med:'medicine',nat:'nature',prc:'perception',prf:'performance',per:'persuasion',rel:'religion',slt:'sleight_of_hand',ste:'stealth',sur:'survival'};
const STANDARD_LANGUAGES=['common','dwarvish','elvish','giant','gnomish','goblin','halfling','orc'];
const EXOTIC_LANGUAGES=['abyssal','celestial','draconic','deep','infernal','primordial','sylvan','undercommon'];
const TOOLS=['alchemist','brewer','calligrapher','carpenter','cartographer','cobbler','cook','glassblower','jeweler','leatherworker','mason','painter','potter','smith','tinker','weaver','woodcarver','disg','forg','herb','navg','pois','thief'];
// SRD Spellcaster spell slots. Index 0 is a non-spellcasting character.
const SPELL_SLOTS=[[],[2],[3],[4,2],[4,3],[4,3,2],[4,3,3],[4,3,3,1],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,2],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1,1],[4,3,3,3,3,1,1,1,1],[4,3,3,3,3,2,1,1,1],[4,3,3,3,3,2,2,1,1]];
const BLOCKED=new Set(['__proto__','constructor','prototype']);
const clone=value=>value===undefined?undefined:structuredClone(value);
const list=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const int=(value,fallback=0)=>finite(value)?Math.trunc(value):fallback;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function grantEqual(a,b){
  const comparable=value=>{
    if(!value)return value;const copy=clone(value);for(const key of ['quantity','equipped','attuned','prepared','enabled'])delete copy[key];
    if(copy.data){delete copy.data.usesSpent;if(copy.data.usesProfile)delete copy.data.uses;else if(copy.data.uses&&typeof copy.data.uses==='object')delete copy.data.uses.value;}
    return copy;
  };
  return equal(comparable(a),comparable(b));
}
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=180&&!BLOCKED.has(value)&&!/[\x00-\x1f]/.test(value);
const label=value=>String(value).split(':').at(-1).replace(/[_-]/g,' ').replace(/\b\w/g,char=>char.toUpperCase());
const tokens=value=>Array.isArray(value)?value:typeof value==='string'?value.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean):[];
const unique=values=>[...new Set(values)];
const subclass=item=>item?.data?.isSubclass===true||item?.data?.classType==='subclass'||item?.data?.subclass===true;
const classKey=item=>item?.data?.classIdentifier||item?.data?.identifier||item?.id;
const rows=item=>{
  const source=Array.isArray(item?.data?.advancement)?item.data.advancement:Object.values(item?.data?.advancement||{});
  const level=row=>{const levels=Object.keys(row.configuration?.choices||{}).filter(key=>/^\d+$/.test(key)&&Number(row.configuration.choices[key]?.count)>0).map(Number);if(row.type==='ItemChoice'&&levels.length)return Math.max(Number(row.level)||0,Math.min(...levels));return finite(row.level)?row.level:0;};
  const phase=row=>row.type==='Trait'?['expertise','forcedExpertise','forced-expertise','mastery'].includes(row.configuration?.mode)?4:0:row.type==='AbilityScoreImprovement'?1:row.type==='ItemChoice'?3:row.type==='HitPoints'?5:2;
  return [...source].sort((a,b)=>level(a)-level(b)||phase(a)-phase(b));
};
const parents=data=>Object.values(data.advancementLedger?.parents||{});
const classParents=data=>parents(data).filter(parent=>parent.type==='class'&&!subclass(parent.item));
function removePath(data,path){const keys=path.split('.'),key=keys.pop(),parent=get(data,keys.join('.'),null);if(parent&&typeof parent==='object')delete parent[key];}
function ownsPath(data,path){const keys=path.split('.'),key=keys.pop(),parent=keys.length?get(data,keys.join('.'),null):data;return !!parent&&Object.hasOwn(parent,key);}
function ledgerOf(data){
  if(data.advancementLedger?.version!==1)data.advancementLedger={version:1,parents:{},fields:{},grants:{}};
  const ledger=data.advancementLedger;ledger.parents??={};ledger.fields??={};ledger.grants??={};ledger.derived??=[];return ledger;
}
function operations(ledger,path){
  const found=new Map();for(const parent of [...Object.values(ledger.parents),{contributions:ledger.derived}])for(const change of parent.contributions||[])if(change.path===path&&!found.has(change.key))found.set(change.key,change);
  return [...found.values()];
}
function observeManual(data,ledger){
  for(const [path,field] of Object.entries(ledger.fields)){
    if(['hpConModifier','classHitPointLevels'].includes(path))continue;
    const current=get(data,path,undefined);if(equal(current,field.applied))continue;
    const changes=operations(ledger,path),numeric=changes.length&&changes.every(change=>['add','hp'].includes(change.mode));
    if(numeric&&finite(current)&&finite(field.applied)){
      if(changes.some(change=>change.mode==='hp')){
        const before=ledger.fields.hpConModifier?.applied,after=data.hpConModifier;
        const conDelta=finite(before)&&finite(after)?classParents(data).flatMap(parent=>Object.entries(parent.hpRolls||{}).filter(([level])=>Number(level)<=parent.classLevel).map(([,roll])=>Math.max(1,roll+after)-Math.max(1,roll+before))).reduce((sum,delta)=>sum+delta,0):0;
        field.offset=(field.offset||0)+current-field.applied-conDelta;
      }
      else{field.base=(finite(field.base)?field.base:0)+current-field.applied;field.exists=true;}
    }else if(changes.length&&changes.every(change=>['union','text'].includes(change.mode))){
      const before=tokens(field.applied),after=tokens(current),base=tokens(field.base);
      field.removed=unique([...(field.removed||[]),...before.filter(value=>!after.includes(value))]).filter(value=>!after.includes(value));
      field.base=unique([...base.filter(value=>after.includes(value)),...after.filter(value=>!before.includes(value))]);
      if(changes[0].mode==='text')field.base=field.base.join(', ');field.exists=true;
    }else{field.override=clone(current);field.hasOverride=true;field.exists=ownsPath(data,path);}
  }
}
function recompute(data,ledger){
  for(const [path,field] of Object.entries(ledger.fields)){
    const changes=operations(ledger,path);let value=changes.some(change=>change.mode==='training')?false:clone(field.base);
    if(field.hasOverride)value=clone(field.override);
    else for(const change of changes){
      if(change.mode==='training')continue;
      if(change.mode==='add')value=(finite(value)?value:0)+change.value;
      else if(change.mode==='hp')value=change.value+(field.offset||0);
      else if(change.mode==='max')value=Math.max(finite(value)?value:0,change.value);
      else if(change.mode==='or')value=!!value||change.value;
      else if(change.mode==='union'||change.mode==='text'){
        const merged=unique([...tokens(value),...tokens(change.value)]).filter(entry=>!field.removed?.includes(entry));value=change.mode==='text'?merged.join(', '):merged;
      }else value=clone(change.value);
    }
    if(!changes.length){
      if(!field.hasOverride&&field.offset&&finite(value))value+=field.offset;
      if(path.startsWith('currency.')&&finite(value))value=Math.max(0,value);
      if(field.exists||field.hasOverride)set(data,path,value);else removePath(data,path);if(!ledger.replanning)delete ledger.fields[path];
    }else{set(data,path,value);field.applied=clone(value);}
  }
}
function addContribution(data,ledger,parent,source,key,path,mode,value){
  if(path.split('.').some(part=>!safe(part)))return;
  if(!ledger.fields[path])ledger.fields[path]={base:clone(get(data,path,undefined)),applied:clone(get(data,path,undefined)),exists:ownsPath(data,path)};
  const changes=source==='classes'?ledger.derived:parent.contributions,change={key:`${source}:${key}:${path}`,path,mode,value:clone(value)},index=changes.findIndex(candidate=>candidate.key===change.key);
  if(index>=0)changes[index]=change;else changes.push(change);recompute(data,ledger);
}
function releaseParent(data,parentId){
  const ledger=ledgerOf(data),parent=ledger.parents[parentId];if(!parent)return;
  delete ledger.parents[parentId];
  for(const [id,grant] of Object.entries(ledger.grants)){
    grant.owners=grant.owners.filter(owner=>owner!==parentId);if(grant.owners.length)continue;
    const entries=list(data[grant.collection]),entry=entries.find(item=>item.id===id);
    // A grant edited by hand becomes an independent item instead of being deleted.
    if(grant.created&&entry&&grantEqual(entry,grant.snapshot))data[grant.collection]=entries.filter(item=>item.id!==id);
    else if(entry?.advancementParentIds)data[grant.collection]=entries.map(item=>item.id===id?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='advancementParentIds')):item);
    delete ledger.grants[id];
  }
  recompute(data,ledger);
}
function catalogue(catalog,id){return catalog instanceof Map?catalog.get(id):Object.hasOwn(catalog||{},id)?catalog[id]:undefined;}
function canonicalTrait(value){
  if(typeof value!=='string')return '';const parts=value.split(':');if(parts[0]==='skills')parts[parts.length-1]=SKILL_ALIASES[parts.at(-1)]||parts.at(-1);
  if(parts[0]==='armor')parts[parts.length-1]=ARMOR[parts.at(-1)]||parts.at(-1);
  if(parts[0]==='weapon'){if(parts.at(-1)==='sim')parts[parts.length-1]='simple';if(parts.at(-1)==='mar')parts[parts.length-1]='martial';}
  return parts.join(':');
}
function expandTraits(pool,edition,catalog){
  const result=[];
  for(const raw of list(pool)){
    const value=canonicalTrait(raw);if(!value)continue;
    if(!value.includes('*')){result.push(value);continue;}
    const prefix=value.split(':')[0];
    if(prefix==='skills')result.push(...Object.keys(SKILLS).map(id=>'skills:'+id));
    else if(prefix==='saves')result.push(...ABILITIES.map(id=>'saves:'+id));
    else if(prefix==='armor')result.push(...['light','medium','heavy','shield'].map(id=>'armor:'+id));
    else if(prefix==='languages'){
      const standard=edition==='2024'?[...STANDARD_LANGUAGES,'commonSign']:STANDARD_LANGUAGES;
      const values=value.includes(':standard:')?standard:value.includes(':exotic:')?EXOTIC_LANGUAGES:[...standard,...EXOTIC_LANGUAGES];
      result.push(...values.map(id=>'languages:'+id));
    }else if(prefix==='tool'){
      const instruments=['bagpipes','drum','dulcimer','flute','horn','lute','lyre','panflute','shawm','viol'],games=['dice','dragonchess','card','threeDragonAnte'];
      const values=value.includes(':art:')?TOOLS.slice(0,17):value.includes(':music:')?instruments:value.includes(':game:')?games:[...TOOLS,...instruments,...games];result.push(...values.map(id=>'tool:'+id));
    }else if(prefix==='weapon'){
      const weapons=[...(catalog instanceof Map?catalog.values():Object.values(catalog||{}))].filter(item=>item.type==='weapon'&&item.data?.baseWeapon&&item.data.rulesEdition===edition);
      const group=value.includes(':sim:')||value.includes(':simple:')?'simple':value.includes(':mar:')||value.includes(':martial:')?'martial':null;
      result.push(...weapons.filter(item=>!group||item.data.weaponGroup===group).map(item=>`weapon:${item.data.weaponGroup}:${item.data.baseWeapon}`));
    }
  }
  return unique(result);
}
function traitValue(data,trait){
  const [kind,...parts]=canonicalTrait(trait).split(':'),id=parts.at(-1);
  if(kind==='skills')return get(data,`skills.${id}.expert`,false)?2:get(data,`skills.${id}.prof`,false)?1:0;
  if(kind==='saves')return get(data,`saves.${id}.prof`,false)?1:0;
  if(kind==='armor')return data.armorTraining?.[id]===true?1:0;
  if(kind==='tool')return list(data.toolExpertise).includes(id)?2:list(data.toolProficiencies).includes(id)?1:0;
  if(kind==='weapon'){const group=parts.find(part=>['sim','mar','simple','martial'].includes(part)),category={sim:'simple',mar:'martial'}[group]||group;return list(data.weaponProficiencies).includes(id)||category&&list(data.weaponProficiencies).includes(category)?1:0;}
  if(kind==='languages')return list(data.languageIds).includes(id)||tokens(data.languages).some(value=>value.toLowerCase()===label(id).toLowerCase())?1:0;
  const key={dr:'resistances',di:'immunities',dv:'vulnerabilities'}[kind];if(key)return list(data.damageTraits?.[key]).includes(id)?1:0;
  if(kind==='ci')return list(data.conditionImmunities).includes(id)?1:0;
  return 0;
}

/** A complete draft is returned only after callers resolve every choice. */
export function planAdvancement(draft,item,catalog,answers={},options={}){
  const data=clone(draft||{}),choices=[],summary=[],warnings=[];
  if(!item||!safe(item.id)||!COLLECTIONS[item.type])throw new Error('Invalid advancement item');
  if(options.type&&options.type!=='character')throw new Error('Advancement requires a character');
  if(item.type==='effect'&&options.role&&options.role!=='gm')throw new Error('Effect advancement requires GM access');
  if(options.canEdit===false)throw new Error('Advancement requires edit access');
  const ledger=ledgerOf(data);observeManual(data,ledger);
  const same=parents(data).find(parent=>parent.source===item.id);
  const parentId=options.parentId||same?.id||`adv-${item.id}`;
  if(!safe(parentId))throw new Error('Invalid advancement parent');
  if(same&&!options.parentId&&!options.resync)return {data:clone(draft),choices,summary:[{kind:'existing',name:item.name}],warnings,parentId:same.id};
  const old=ledger.parents[parentId];
  const priorOwned=new Map((old?.owned||[]).map(id=>{const record=ledger.grants[id];return [id,clone(record?list(data[record.collection]).find(entry=>entry.id===id):undefined)];}));
  const mergedAnswers={...(old?.answers||{}),...clone(answers)};
  if(old){ledger.replanning=true;releaseParent(data,parentId);}
  if(options.replace!==false&&['race','background'].includes(item.type)){
    for(const parent of parents(data))if(parent.type===item.type)releaseParent(data,parent.id);
    data.features=list(data.features).filter(entry=>entry.type!==item.type||entry.source===item.id||ledger.grants[entry.id]);
  }
  const classLevel=Math.max(1,Math.min(20,int(options.classLevel,int(item.data?.levels,1))));
  const primaryClass=options.primaryClass??old?.primaryClass??(item.type==='class'&&!classParents(data).length&&!subclass(item));
  if(subclass(item)&&!classParents(data).some(parent=>classKey(parent.item)===item.data?.classIdentifier))throw new Error('Subclass requires its matching class');
  if(item.type==='class'&&!subclass(item)){
    const other=classParents(data).find(parent=>classKey(parent.item)===classKey(item));if(other)throw new Error('Class already has advancement');
    const total=classParents(data).reduce((sum,parent)=>sum+parent.classLevel,0)+classLevel;if(total>20)throw new Error('Character level cannot exceed 20');
  }
  const parent={id:parentId,source:item.id,type:item.type,item:clone(item),answers:mergedAnswers,classLevel,primaryClass,contributions:[],owned:[],hpRolls:clone(old?.hpRolls||{})};
  ledger.parents[parentId]=parent;
  const contribute=(source,key,path,mode,value)=>addContribution(data,ledger,parent,source,key,path,mode,value);
  const ask=(id,config,valid)=>{
    const answer=mergedAnswers[id];if(answer!==undefined&&valid(answer))return answer;
    choices.push({id,...config,...(answer!==undefined?{error:'invalidAnswer',current:clone(answer)}:{})});return undefined;
  };
  const select=(id,kind,title,pool,count=1,selectType='multi',extra={})=>{
    if(count===0)return [];
    const ids=pool.map(option=>option.id),valid=answer=>{const values=Array.isArray(answer)?answer:[answer];return values.length===count&&unique(values).length===values.length&&values.every(value=>typeof value==='string'&&ids.includes(value));};
    const answer=ask(id,{type:selectType,kind,title,options:pool,count,...extra},valid);return answer===undefined?[]:Array.isArray(answer)?answer:[answer];
  };
  const trait=(source,key,value,mode='default',ownedEntry)=>{
    const [kind,...parts]=canonicalTrait(value).split(':'),id=parts.at(-1),rank=traitValue(data,value);
    if(kind==='skills'&&Object.hasOwn(SKILLS,id)){
      contribute(source,key,`skills.${id}.prof`,'or',true);
      if(['expertise','forcedExpertise','forced-expertise'].includes(mode)||mode==='upgrade'&&rank)contribute(source,key,`skills.${id}.expert`,'or',true);
    }else if(kind==='saves'&&ABILITIES.includes(id))contribute(source,key,`saves.${id}.prof`,'or',true);
    else if(kind==='armor'&&Object.values(ARMOR).includes(id))contribute(source,key,`armorTraining.${id}`,'or',true);
    else if(kind==='languages'){
      contribute(source,key,'languageIds','union',[id]);contribute(source,key,'languages','text',[label(id)]);
    }else if(kind==='weapon'){
      contribute(source,key,mode==='mastery'?'weaponMasteries':'weaponProficiencies','union',[id]);contribute(source,key,'proficiencies','text',[`Weapon: ${label(id)}`]);
    }else if(kind==='tool'){
      contribute(source,key,'toolProficiencies','union',[id]);contribute(source,key,'proficiencies','text',[`Tool: ${label(id)}`]);
      if(['expertise','forcedExpertise','forced-expertise'].includes(mode)||mode==='upgrade'&&rank)contribute(source,key,'toolExpertise','union',[id]);
    }else if(['dr','di','dv'].includes(kind)){
      const damageKey={dr:'resistances',di:'immunities',dv:'vulnerabilities'}[kind];
      if(ownedEntry&&!['race','background','class'].includes(ownedEntry.type)){ownedEntry.data.damageTraits??={};ownedEntry.data.damageTraits[damageKey]=unique([...list(ownedEntry.data.damageTraits[damageKey]),id]);}
      else contribute(source,key,`damageTraits.${damageKey}`,'union',[id]);
    }else if(kind==='ci'){
      if(ownedEntry&&!['race','background','class'].includes(ownedEntry.type))ownedEntry.data.conditionImmunities=unique([...list(ownedEntry.data.conditionImmunities),id]);
      else contribute(source,key,'conditionImmunities','union',[id]);
    }
    else warnings.push({code:'unsupportedTrait',item:source,trait:value});
  };
  const eligibleTrait=(value,mode)=>{
    const rank=traitValue(data,value);
    return mode==='expertise'?rank===1:mode==='upgrade'?rank<2:mode==='mastery'?rank>0&&!list(data.weaponMasteries).includes(value.split(':').at(-1)):!rank;
  };
  const eligibleItem=(candidate,level)=>{
    if(!candidate)return false;
    const metadata=candidate?.data||{},requiredClass=metadata.prerequisiteClass;
    const owned=['features','spells','weapons','inventory','equipment'].flatMap(key=>list(data[key]));
    const classLevelOf=id=>classParents(data).find(parent=>classKey(parent.item)===id)?.classLevel||Number(data.classLevels?.[id])||0;
    const availableLevel=requiredClass?classLevelOf(requiredClass):level;
    if(Number(metadata.prerequisiteLevel||0)>availableLevel)return false;
    if(list(metadata.prerequisiteAlternatives).length&&!metadata.prerequisiteAlternatives.some(branch=>{
      if(!branch.classId||classLevelOf(branch.classId)<Number(branch.level||0))return false;
      return !branch.subclassId||owned.some(entry=>subclass(entry)&&entry.data?.identifier===branch.subclassId&&entry.data.classIdentifier===branch.classId);
    }))return false;
    return list(metadata.prerequisiteItems).every(id=>owned.some(entry=>entry.source===id||entry.data?.identifier===id));
  };
  const grant=(entry,sourceKey,spellConfig={},grantOptions={})=>{
    const collection=COLLECTIONS[entry.type];if(!collection||entry.type==='effect'&&options.role&&options.role!=='gm'){warnings.push({code:'unsupportedGrant',id:entry.id});return null;}
    data[collection]??=[];if(!Array.isArray(data[collection]))data[collection]=[];
    const ownedId=grantOptions.separate?`gear-${parentId}-${entry.id}`:`owned-${entry.id}`;
    let owned=data[collection].find(candidate=>grantOptions.separate?candidate.id===ownedId:candidate.source===entry.id),created=false;
    if(!owned){
      const quantity=finite(grantOptions.quantity)?Math.max(1,Math.min(1e6,grantOptions.quantity)):finite(entry.data?.quantity)?Math.max(1,Math.min(1e6,entry.data.quantity)):1;
      owned={id:ownedId,source:entry.id,name:entry.name,type:entry.type,data:clone(entry.data||{}),quantity,equipped:false,attuned:false,prepared:false,enabled:true};
      if(entry.type==='armor')owned.equipped=![...list(data.inventory),...list(data.equipment)].some(other=>other.type==='armor'&&other.equipped===true&&(other.data?.armor_type==='shield')===(entry.data?.armor_type==='shield'));
      const prior=priorOwned.get(owned.id);
      if(prior){
        for(const key of ['quantity','equipped','attuned','prepared','enabled'])if(Object.hasOwn(prior,key))owned[key]=clone(prior[key]);
        if(prior.data?.uses!==undefined)owned.data.uses=clone(prior.data.uses);
        if(prior.data?.usesSpent!==undefined)owned.data.usesSpent=prior.data.usesSpent;
      }
      data[collection].push(owned);created=true;
    }
    const record=ledger.grants[owned.id]??={collection,source:entry.id,owners:[],created,snapshot:clone(owned)};
    if(!record.owners.includes(parentId))record.owners.push(parentId);if(!parent.owned.includes(owned.id))parent.owned.push(owned.id);
    if(entry.type==='spell'&&created){
      const abilities=list(spellConfig.ability).filter(ability=>ABILITIES.includes(ability));
      const ability=abilities.length===1?abilities[0]:abilities.length>1?select(`${sourceKey}:ability`,'SpellAbility',entry.name,abilities.map(id=>({id,label:label(id)})),1,'select')[0]:undefined;
      if(ability)owned.data.spell_ability=ability;
      if(['always','prepared','atwill','innate'].includes(spellConfig.preparation))owned.prepared=true;
      const usesProfile=spellConfig.uses?.maxProfile,maximum=usesProfile?evaluateUsesProfile(usesProfile,data):Number(spellConfig.uses?.max),period=spellConfig.uses?.per;
      if(usesProfile)owned.data.usesProfile=clone(usesProfile);
      if(Number.isInteger(maximum)&&maximum>0&&!priorOwned.has(owned.id)){owned.data.uses={value:maximum,max:maximum};owned.data.recharge={lr:'long',sr:'short'}[period]||'none';}
    }
    if(created)record.snapshot=clone(owned);
    summary.push({kind:created?'grant':'shared',name:entry.name,type:entry.type,id:owned.id});return owned;
  };
  const seen=new Set(),stack=new Set();let visited=0;
  const visit=(entry,sourceKey,spellConfig={},scope={})=>{
    if(++visited>500){warnings.push({code:'advancementLimit'});return;}
    if(stack.has(entry.id)){warnings.push({code:'advancementCycle',id:entry.id});return;}
    if(seen.has(entry.id))return;seen.add(entry.id);stack.add(entry.id);
    const owned=grant(entry,sourceKey,spellConfig,scope.grantOptions);if(!owned){stack.delete(entry.id);return;}
    const grantRecord=ledger.grants[owned.id],snapshotCurrent=grantEqual(owned,grantRecord.snapshot);
    for(const ownerId of ledger.grants[owned.id]?.owners||[])if(ownerId!==parentId)for(const [key,value] of Object.entries(ledger.parents[ownerId]?.answers||{}))if(key.startsWith(entry.id+':')&&mergedAnswers[key]===undefined)mergedAnswers[key]=clone(value);
    const source=entry.id,entryData=entry.data||{},isClass=entry.type==='class'&&!subclass(entry);
    for(const warning of list(entryData.advancementWarnings))warnings.push(typeof warning==='string'?{code:'contentWarning',message:warning}:clone(warning));
    const characterLevel=classParents(data).reduce((sum,parent)=>sum+parent.classLevel,0)||Math.max(1,int(data.level,1));
    const currentLevel=isClass?classLevel:subclass(entry)?classParents(data).find(candidate=>classKey(candidate.item)===entryData.classIdentifier)?.classLevel||1:scope.classLevel||characterLevel;
    const childScope=isClass||subclass(entry)?{classLevel:currentLevel,classId:classKey(entry)}:{classLevel:scope.classLevel,classId:scope.classId};
    if(entry===item){
      if(entry.type==='race')contribute(source,'identity','race','set',entry.name);
      if(entry.type==='background')contribute(source,'identity','background','set',entry.name);
    }
    if(entry.type==='race'||entryData.movement){
      const movement=entryData.movement||{walk:entryData.speed};
      for(const [kind,value] of Object.entries(movement))if(finite(value)&&value>=0){contribute(source,'movement',`movement.${kind}`,kind==='walk'?'set':'max',value);if(kind==='walk')contribute(source,'movement','speed','set',value);}
    }
    for(const [sense,value] of Object.entries(entryData.senses||{}))if(finite(value)&&value>0)contribute(source,'senses',`senses.${sense}`,'max',value);
    if(entryData.size&&!rows(entry).some(row=>row.type==='Size'))contribute(source,'size','size','set',entryData.size);
    for(const [key,value] of Object.entries(['race','background','class'].includes(entry.type)?entryData.mechanicalTraits||{}:{})){
      if(['hpPerLevel','hpFlat'].includes(key)&&finite(value))contribute(source,'mechanical',`mechanicalTraits.${key}`,'add',value);
      else if(['ignoreHeavyArmorSpeedPenalty','initiativeAdvantage','magicalSleepImmunity'].includes(key)&&value===true)contribute(source,'mechanical',`mechanicalTraits.${key}`,'or',true);
      else if(key==='saveAdvantages'&&Array.isArray(value))contribute(source,'mechanical',`mechanicalTraits.${key}`,'union',value);
      else if(key==='unarmoredDefense')contribute(source,'mechanical',`mechanicalTraits.${key}`,'union',Array.isArray(value)?value:[value]);
    }
    if(isClass&&primaryClass){
      for(const armor of ['light','medium','heavy','shield'])contribute(source,'trainingBaseline',`armorTraining.${armor}`,'training',false);
      if(ABILITIES.includes(entryData.spellcasting_ability))contribute(source,'spellcasting','spell.ability','set',entryData.spellcasting_ability);
      contribute(source,'weaponProficiency','weaponProficiencyMode','set','class');
    }
    for(const [rowIndex,row] of rows(entry).entries()){
      const config=row.configuration||{},rowId=safe(row.id)?row.id:safe(row._id)?row._id:String(rowIndex),key=`${source}:${rowId}`,title=row.title||entry.name;
      if(finite(row.level)&&row.level>currentLevel)continue;
      if(row.classRestriction==='primary'&&!primaryClass||row.classRestriction==='secondary'&&primaryClass)continue;
      if(row.type==='Trait'){
        const mode=config.mode||'default';
        for(const [i,value] of list(config.grants).entries()){
          if(config.allowReplacements&&traitValue(data,value)&&['skills','tool'].includes(value.split(':')[0])){
            const pool=expandTraits([value.split(':')[0]+':*'],entryData.rulesEdition,catalog).filter(candidate=>eligibleTrait(candidate,mode));
            for(const selected of select(`${key}:replacement:${i}`,'Trait',title,pool.map(id=>({id,label:label(id)})),1))trait(source,`${rowId}:replacement:${i}`,selected,mode,owned);
          }else trait(source,`${rowId}:grant:${i}`,value,mode,owned);
        }
        for(const [i,choice] of list(config.choices).entries()){
          const pool=expandTraits(choice.pool,entryData.rulesEdition,catalog).filter(value=>eligibleTrait(value,mode));
          const count=Math.max(0,int(choice.count,1));
          if(pool.length<count&&choices.length)continue; // Resolve prerequisite proficiencies before dependent expertise.
          for(const selected of select(`${key}:choice:${i}`,'Trait',title,pool.map(id=>({id,label:label(id)})),count))trait(source,`${rowId}:choice:${i}:${selected}`,selected,mode,owned);
        }
      }else if(row.type==='Size'){
        const sizes=unique(list(config.sizes).map(size=>({sm:'small',med:'medium',lg:'large'}[size]||size))).filter(size=>['tiny','small','medium','large','huge','gargantuan'].includes(size));
        const size=sizes.length===1?sizes[0]:select(key,'Size',title,sizes.map(id=>({id,label:label(id)})),1,'select')[0];if(size)contribute(source,rowId,'size','set',size);
      }else if(row.type==='AbilityScoreImprovement'){
        if(entry.type==='race'&&entryData.rulesEdition==='2024'){warnings.push({code:'speciesASI2024Ignored',id:source});continue;}
        if((isClass||subclass(entry))&&config.allowFeats&&options.allowFeats!==false){
          const acquisitionLevel=characterLevel-currentLevel+Math.max(1,int(row.level,currentLevel));
          const feats=[...(catalog instanceof Map?catalog.values():Object.values(catalog||{}))].filter(candidate=>candidate.type==='feat'&&candidate.data?.rulesEdition===entryData.rulesEdition&&candidate.data.featCategory!=='origin'&&candidate.data.identifier!=='ability-score-improvement'&&eligibleItem(candidate,acquisitionLevel)&&(candidate.data.repeatable||!list(data.features).some(owned=>owned.source===candidate.id)));
          const selected=select(`${key}:mode`,'AbilityOrFeat',title,[{id:'ability',label:'Ability score improvement'},...feats.map(feat=>({id:feat.id,label:feat.name}))],1,'select')[0];
          if(!selected)continue;if(selected!=='ability'){visit(catalogue(catalog,selected),key,{},childScope);continue;}
        }
        const fixed=Object.fromEntries(ABILITIES.map(ability=>[ability,Math.max(0,int(config.fixed?.[ability]))])),maximum=int(config.max,20),points=Math.max(0,int(config.points)),cap=Math.max(1,int(config.cap,points||2));
        for(const [ability,value] of Object.entries(fixed))if(value){const before=Number(get(data,`abilities.${ability}.score`,10));contribute(source,`${rowId}:fixed`, `abilities.${ability}.score`,'add',Math.min(value,Math.max(0,maximum-before)));}
        if(points){
          const abilities=ABILITIES.filter(ability=>!list(config.locked).includes(ability)&&!fixed[ability]).map(id=>({id,label:label(id),max:Math.max(0,Math.min(cap,maximum-Number(get(data,`abilities.${id}.score`,10))))}));
          const valid=answer=>answer&&typeof answer==='object'&&!Array.isArray(answer)&&Object.entries(answer).every(([ability,value])=>ABILITIES.includes(ability)&&Number.isInteger(value)&&value>=0&&(value===0||abilities.some(option=>option.id===ability&&value<=option.max)))&&Object.values(answer).reduce((sum,value)=>sum+value,0)===points;
          const answer=ask(key,{type:'ability',kind:'AbilityScoreImprovement',title,options:[],abilities,points,cap,fixed,max:maximum},valid);
          if(answer)for(const [ability,value] of Object.entries(answer))if(value)contribute(source,`${rowId}:choice`,`abilities.${ability}.score`,'add',value);
        }
      }else if(row.type==='ItemGrant'){
        for(const [i,ref] of list(config.items).entries()){
          const id=typeof ref==='string'?ref:ref.id,child=catalogue(catalog,id);if(!child){warnings.push({code:'missingGrant',id,item:entry.name});continue;}
          // SRD 5.1 multiclassing prohibits acquiring Unarmored Defense a second time.
          // Check acquisition, including disabled/manual features, rather than current AC.
          if(parent.type==='class'&&!parent.primaryClass&&parent.item.data?.rulesEdition==='2014'&&childScope.classId===classKey(parent.item)&&child.data?.mechanicalTraits?.unarmoredDefense){
            const acquired=!!data.mechanicalTraits?.unarmoredDefense&&tokens(data.mechanicalTraits.unarmoredDefense).length>0||list(data.features).some(owned=>tokens(owned.data?.mechanicalTraits?.unarmoredDefense).length>0);
            if(acquired){warnings.push({code:'multiclassUnarmoredDefense2014',id,item:entry.name});continue;}
          }
          if(ref.optional||config.optional){const selected=select(`${key}:optional:${i}`,'OptionalItem',title,[{id:'yes',label:child.name},{id:'no',label:'Skip'}],1,'select');if(selected[0]!=='yes')continue;}
          visit(child,`${key}:grant:${id}`,config.spell||{},childScope);
        }
      }else if(row.type==='ItemChoice'){
        const levels=config.choices&&typeof config.choices==='object'?Object.entries(config.choices):[[String(row.level||0),{count:config.count||1}]];
        let pool=unique(list(config.pool).map(ref=>typeof ref==='string'?ref:ref.id)).filter(id=>catalogue(catalog,id));
        const spellLists=list(config.restriction?.list).filter(value=>value.startsWith('class:')).map(value=>value.slice(6));
        const chosenList=spellLists.length===1?spellLists[0]:spellLists.length>1?select(`${key}:spell-list`,'SpellList',title,spellLists.map(id=>({id,label:label(id)})),1,'select')[0]:undefined;
        if(spellLists.length>1&&!chosenList)continue;
        if(chosenList)pool=pool.filter(id=>list(catalogue(catalog,id).data?.spellLists).includes(chosenList));
        if(config.restriction?.level!==undefined&&config.restriction.level!==''){
          const spellLevel=Number(config.restriction.level);if(Number.isInteger(spellLevel))pool=pool.filter(id=>Number(catalogue(catalog,id).data?.level)===spellLevel);
        }
        for(const [level,choice] of levels){
          if(Number(level)>currentLevel)continue;
          const available=pool.filter(id=>!seen.has(id)&&eligibleItem(catalogue(catalog,id),currentLevel));
          if(available.length<Math.max(0,int(choice.count,1))&&choices.length)continue;
          for(const id of select(`${key}:level:${level}`,'ItemChoice',title,available.map(id=>({id,label:catalogue(catalog,id).name})),Math.max(0,int(choice.count,1))))visit(catalogue(catalog,id),`${key}:choice:${level}:${id}`,config.spell||{},childScope);
          if(choice.replacement)warnings.push({code:'replacementOptional',item:entry.name,level:Number(level)});
        }
      }else if(row.type==='ScaleValue'){
        const levels=Object.keys(config.scale||{}).map(Number).filter(level=>Number.isInteger(level)&&level<=currentLevel).sort((a,b)=>a-b),value=config.scale?.[levels.at(-1)];
        const identifier=config.identifier||rowId,namespace=entryData.identifier||source;if(value!==undefined&&safe(identifier)&&safe(namespace))contribute(source,rowId,`scales.${namespace}.${identifier}`,'set',value);
      }else if(row.type==='HitPoints'){
        if(!isClass)continue;const die=Number(String(entryData.hit_die||'d8').slice(1));if(![6,8,10,12].includes(die)){warnings.push({code:'invalidHitDie',item:entry.name});continue;}
        for(let level=1;level<=classLevel;level++){
          const id=`${key}:hp:${level}`;let result=primaryClass&&level===1?die:undefined;
          if(result===undefined){result=ask(id,{type:'number',kind:'HitPoints',title:`${entry.name} · ${level}`,options:[],min:1,max:die,average:Math.floor(die/2)+1,count:1},value=>Number.isInteger(value)&&value>=1&&value<=die);}
          if(result!==undefined)parent.hpRolls[level]=result;
        }
      }else if(row.type==='Subclass'){
        const declared=list(config.pool).map(ref=>typeof ref==='string'?ref:ref.id);
        const matching=[...(catalog instanceof Map?catalog.values():Object.values(catalog||{}))].filter(candidate=>subclass(candidate)&&candidate.data.classIdentifier===classKey(entry)&&(!declared.length||declared.includes(candidate.id)));
        for(const id of select(key,'Subclass',title,matching.map(candidate=>({id:candidate.id,label:candidate.name})),1,'select'))visit(catalogue(catalog,id),key,{},childScope);
      }else warnings.push({code:'unsupportedAdvancement',type:row.type,item:entry.name});
    }
    const starting=entryData.startingEquipment;
    if(starting&&Array.isArray(starting.groups)&&(entry.type==='background'||isClass&&primaryClass)){
      const groups=starting.groups.filter(group=>safe(group.id)),gear=new Map(),currency=new Map(),active=new Set();
      const wealth=starting.wealth,hasWealth=wealth&&finite(wealth.amount)&&wealth.amount>=0;
      const method=hasWealth?select(`${source}:starting:method`,'StartingEquipment',entry.name,[{id:'equipment',label:'Starting equipment'},{id:'wealth',label:`${wealth.amount} ${wealth.currency||'gp'}`}],1,'select')[0]:'equipment';
      const addGear=(id,quantity)=>{if(catalogue(catalog,id))gear.set(id,(gear.get(id)||0)+quantity);else warnings.push({code:'missingStartingItem',id,item:entry.name});};
      const describe=group=>{
        if(group.itemId)return `${catalogue(catalog,group.itemId)?.name||group.itemId}${group.quantity>1?' ×'+group.quantity:''}`;
        if(group.type==='currency')return `${group.quantity} ${group.currency||'gp'}`;
        const children=groups.filter(child=>child.group===group.id);return children.length?children.map(child=>child.itemId?catalogue(catalog,child.itemId)?.name||child.itemId:child.type==='currency'?`${child.quantity} ${child.currency||'gp'}`:child.selector||child.type).join(' + '):group.selector||group.type;
      };
      const resolveGroup=group=>{
        if(active.has(group.id)){warnings.push({code:'startingEquipmentCycle',id:group.id});return;}active.add(group.id);
        const children=groups.filter(child=>child.group===group.id),quantity=Math.max(1,int(group.quantity,1));
        if(group.type==='OR'){
          for(const id of select(`${source}:starting:${group.id}`,'StartingEquipment',entry.name,children.map(child=>({id:child.id,label:describe(child)})),1,'select'))resolveGroup(children.find(child=>child.id===id));
        }else if(group.type==='AND')for(const child of children)resolveGroup(child);
        else if(group.type==='currency'){
          if(['cp','sp','ep','gp','pp'].includes(group.currency))currency.set(group.currency,(currency.get(group.currency)||0)+Math.max(0,int(group.quantity)));
        }else if(group.itemId){addGear(group.itemId,quantity);for(const child of children)resolveGroup(child);}
        else if(Array.isArray(group.pool)&&group.pool.length){
          const pool=unique(group.pool).map(id=>catalogue(catalog,id)).filter(Boolean).filter(candidate=>!group.requiresProficiency||candidate.type==='weapon'&&(list(data.weaponProficiencies).includes(candidate.data.baseWeapon)||list(data.weaponProficiencies).includes(candidate.data.weaponGroup)));
          for(let index=0;index<quantity;index++)for(const id of select(`${source}:starting:${group.id}:${index}`,'StartingEquipment',entry.name,pool.map(candidate=>({id:candidate.id,label:candidate.name})),1,'select'))addGear(id,1);
        }else warnings.push({code:'manualStartingEquipment',item:entry.name,id:group.id,reason:group.reason||group.selector||group.type});
        active.delete(group.id);
      };
      if(method==='wealth')currency.set(wealth.currency||'gp',wealth.amount);
      else if(method==='equipment')for(const root of groups.filter(group=>!group.group||!groups.some(parent=>parent.id===group.group)))resolveGroup(root);
      for(const [id,quantity] of gear)visit(catalogue(catalog,id),`${source}:starting:${id}`,{},{...childScope,grantOptions:{separate:true,quantity}});
      for(const [coin,amount] of currency)if(['cp','sp','ep','gp','pp'].includes(coin))contribute(source,'startingCurrency',`currency.${coin}`,'add',amount);
      if(wealth?.manual&&!hasWealth)warnings.push({code:'manualStartingWealth',item:entry.name,formula:wealth.formula});
    }
    if(snapshotCurrent)grantRecord.snapshot=clone(owned);stack.delete(entry.id);
  };
  visit(item,item.id);
  refreshClasses(data,ledger);delete ledger.replanning;recompute(data,ledger);
  const result={data,choices,summary,warnings,parentId};
  return item.type==='class'&&!subclass(item)&&options.resyncDependents!==false?resyncParents(result,parentId,catalog,answers):result;
}

function refreshClasses(data,ledger){
  const classes=classParents(data),derived=[];
  const resourceValues=new Map();
  const contribute=(key,path,mode,value)=>{
    if(!ledger.fields[path])ledger.fields[path]={base:clone(get(data,path,undefined)),applied:clone(get(data,path,undefined)),exists:ownsPath(data,path)};
    derived.push({key:`classes:${key}:${path}`,path,mode,value:clone(value)});
  };
  const resource=(path,max)=>{
    resourceValues.set(path,{max:Number(get(data,path+'.max',0))||0,value:Number(get(data,path+'.value',0))||0});
    contribute('slots',path+'.max','set',max);
  };
  // Snapshot remaining uses before max changes; leveling never restores spent uses.
  for(const change of ledger.derived||[])if(change.key.startsWith('classes:slots:')){
    const path=change.path.replace(/\.max$/,'');resourceValues.set(path,{max:Number(get(data,path+'.max',0))||0,value:Number(get(data,path+'.value',0))||0});
  }
  if(!classes.length){ledger.derived=[];recompute(data,ledger);for(const [path,state] of resourceValues)if(ownsPath(data,path+'.max'))set(data,path+'.value',Math.max(0,Number(get(data,path+'.max',0))-(state.max-state.value)));else removePath(data,path);return;}
  const total=classes.reduce((sum,entry)=>sum+entry.classLevel,0),con=mod(effectiveAbilityScore(data,'con'));
  contribute('total','level','set',total);
  contribute('identity','class','set',classes.map(entry=>`${entry.item.name} ${entry.classLevel}`).join(' / '));
  for(const armor of ['light','medium','heavy','shield'])contribute('trainingBaseline',`armorTraining.${armor}`,'training',false);
  const casters=classes.filter(entry=>['full','half','third'].includes(entry.item.data?.spellcasting?.progression));
  if(casters.length){
    const rank=casters.reduce((sum,entry)=>{
      const progression=entry.item.data.spellcasting.progression,level=entry.classLevel;
      if(progression==='full')return sum+level;
      if(casters.length===1)return sum+(progression==='half'&&level===1&&entry.item.data.rulesEdition!=='2024'?0:Math.ceil(level/(progression==='half'?2:3)));
      return sum+(progression==='half'&&entry.item.data.rulesEdition==='2024'?Math.ceil(level/2):Math.floor(level/(progression==='half'?2:3)));
    },0),slots=SPELL_SLOTS[Math.min(20,rank)]||[];
    for(let level=1;level<=9;level++)resource(`slots.l${level}`,slots[level-1]||0);
  }
  const pact=classes.filter(entry=>entry.item.data?.spellcasting?.progression==='pact').reduce((sum,entry)=>sum+entry.classLevel,0);
  if(pact){resource('pactSlots',pact>=17?4:pact>=11?3:pact>=2?2:1);contribute('pactLevel','pactSlots.level','set',Math.min(5,Math.ceil(pact/2)));}
  const hpReady=classes.every(entry=>Object.keys(entry.hpRolls||{}).length>=entry.classLevel);
  if(hpReady){
    const maximum=classes.reduce((sum,entry)=>sum+Object.entries(entry.hpRolls).filter(([level])=>Number(level)<=entry.classLevel).reduce((hp,[,roll])=>hp+Math.max(1,roll+con),0),0);
    contribute('hp','hpBaseMax','hp',maximum);
    contribute('hpCon','hpConModifier','set',con);contribute('hpLevels','classHitPointLevels','set',total);
  }
  ledger.derived=derived;recompute(data,ledger);
  for(const [path,state] of resourceValues)if(ownsPath(data,path+'.max'))set(data,path+'.value',Math.max(0,Number(get(data,path+'.max',0))-Math.max(0,state.max-state.value)));else removePath(data,path);
  if(hpReady){if(data.bars?.bar_1){data.bars.bar_1.max=data.hpBaseMax;data.bars.bar_1.value=Math.min(data.bars.bar_1.value,data.hpBaseMax);}if(data.hp)data.hp.max=data.hpBaseMax;delete data.hpDerivedMax;}
  const pools=list(data.hitDicePools).filter(pool=>!pool.advancementClass);
  for(const entry of classes){
    const old=list(data.hitDicePools).find(pool=>pool.id===entry.id),max=entry.classLevel,spent=old?Math.max(0,old.max-old.value):0;
    pools.push({id:entry.id,die:entry.item.data.hit_die||'d8',value:Math.max(0,max-spent),max,className:entry.item.name,advancementClass:entry.id});
  }
  data.hitDicePools=pools;
}

export function removeAdvancement(draft,ownedParentId,catalog){
  const data=clone(draft||{}),ledger=ledgerOf(data),parentId=ledger.parents[ownedParentId]?ownedParentId:Object.values(ledger.parents).find(parent=>parent.owned[0]===ownedParentId)?.id;
  if(!parentId)return {data:clone(draft),choices:[],summary:[],warnings:[],parentId};
  const removedClass=ledger.parents[parentId].type==='class';
  const fallback=catalog||new Map([...Object.values(ledger.grants).map(grant=>[grant.source,{id:grant.source,...clone(grant.snapshot),id:grant.source}]),...parents(data).map(parent=>[parent.source,parent.item])]);
  observeManual(data,ledger);if(parentId)releaseParent(data,parentId);
  refreshClasses(data,ledger);
  const ids=new Set(classParents(data).map(parent=>parent.id));data.hitDicePools=list(data.hitDicePools).filter(pool=>!pool.advancementClass||ids.has(pool.advancementClass));
  if(data.bars?.bar_1&&finite(data.hpBaseMax)){data.bars.bar_1.max=data.hpBaseMax;data.bars.bar_1.value=Math.min(data.bars.bar_1.value,data.hpBaseMax);delete data.hpDerivedMax;}
  const result={data,choices:[],summary:parentId?[{kind:'remove',id:parentId}]:[],warnings:[],parentId};
  if(removedClass)resyncParents(result,parentId,fallback,{});return result;
}

function resyncParents(result,excludeId,catalog,answers){
  for(const other of parents(result.data).filter(candidate=>candidate.id!==excludeId)){
    const plan=planAdvancement(result.data,other.item,catalog,answers,{parentId:other.id,classLevel:other.classLevel,primaryClass:other.primaryClass,resync:true,resyncDependents:false,type:'character',edition:result.data.rulesEdition});
    result.data=plan.data;result.choices.push(...plan.choices);result.summary.push(...plan.summary);result.warnings.push(...plan.warnings);
  }
  result.choices=[...new Map(result.choices.map(choice=>[choice.id,choice])).values()];return result;
}

export function syncAdvancementLevel(draft,parentId,level,catalog,answers={}){
  const parent=draft?.advancementLedger?.parents?.[parentId];if(!parent||parent.type!=='class'||subclass(parent.item))throw new Error('Unknown class advancement');
  if(!Number.isInteger(level)||level<1||level>20)throw new Error('Invalid class level');
  const result=planAdvancement(draft,parent.item,catalog,answers,{parentId,classLevel:level,primaryClass:parent.primaryClass,resync:true,resyncDependents:false,type:'character',edition:draft.rulesEdition});
  // Species spell gates use character level; subclasses and class grants use their class level.
  return resyncParents(result,parentId,catalog,answers);
}
