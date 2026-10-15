/** DnD initiative and forward-turn mechanics owned entirely by the browser system. */
import {damage,heal,incomingDamage,effectiveAbilityScore,modifiers,numeric} from './rules.js';
import {evaluateCombatFormula,formulaError} from './combat-formula.js';
export {evaluateCombatFormula} from './combat-formula.js';
const clone = value => structuredClone(value);
const object = value => value && typeof value==='object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const codes = new Set(['poisoned','invisible','surprised','incapacitated','paralyzed','petrified','stunned','unconscious']);
const collections = ['inventory','weapons','equipment','features','effects'];

function activeItems(data,includeEffects=true) {
  const result = [];
  for (const collection of collections) {
    if (!includeEffects && collection==='effects') continue;
    list(data[collection]).slice(0,128).forEach((item,index)=>{
      if (!object(item) || item.enabled===false || item.data?.enabled===false
          || item.data?.requiresAttunement===true && item.attuned!==true) return;
      if (['features','effects'].includes(collection) || item.equipped===true) result.push({item,id:`${collection}:${index}`});
    });
  }
  return result;
}
export function combatConditions(data,conditions=[]) {
  const values = [...list(data.conditions),...list(conditions)];
  const active = activeItems(data);
  for (const {item} of active) values.push(item.data?.conditionId || item.data?.systemCondition);
  const result = new Set();
  for (const condition of values) {
    const code = typeof condition==='string' ? condition : condition?.status || condition?.conditionId || condition?.code;
    if (codes.has(code)) result.add(code);
  }
  const immunities = [...list(data.conditionImmunities),...active.flatMap(({item})=>list(item.data?.conditionImmunities))];
  for (const immunity of immunities) result.delete(immunity);
  if (data.death?.dead || data.death?.unconscious) result.add('unconscious');
  if (['paralyzed','petrified','stunned','unconscious'].some(code=>result.has(code))) result.add('incapacitated');
  if (result.has('petrified')) result.delete('poisoned');
  return result;
}

export function prepareInitiative(formula,source,{conditions=[]}={}) {
  if (typeof formula!=='string' || formula.length>500) throw formulaError('combat-formula-invalid');
  const data = clone(source), edition = data.rulesEdition==='2024' ? '2024' : '2014';
  const exhaustion = Math.max(0,Math.min(6,Math.trunc(numeric(data.exhaustion))));
  const dexterity = object(data.abilities?.dex) ? data.abilities.dex : {};
  if (Object.hasOwn(dexterity,'score')) {
    dexterity.mod = Math.floor((effectiveAbilityScore(data,'dex')-10)/2);
    data.init = dexterity.mod+numeric(data.init_misc);
  } else if (!Object.hasOwn(data,'init')) data.init = numeric(dexterity.mod)+numeric(data.init_misc);
  const condition = combatConditions(data,conditions);
  const traits = activeItems(data).filter(({item})=>!['race','background','class'].includes(item.type));
  let advantage = data.mechanicalTraits?.initiativeAdvantage===true || traits.some(({item})=>item.data?.mechanicalTraits?.initiativeAdvantage===true)
    || edition==='2024' && condition.has('invisible');
  let disadvantage = condition.has('poisoned') || edition==='2014' && exhaustion>=1
    || edition==='2024' && ['surprised','incapacitated'].some(code=>condition.has(code));
  for (const collection of ['inventory','equipment']) for (const item of list(data[collection]).slice(0,128)) {
    if (!object(item) || item.type!=='armor' || item.equipped!==true) continue;
    const payload = object(item.data) ? item.data : {}, kind = payload.armor_type;
    if (kind==='shield' && edition==='2024') continue;
    if ((payload.trained ?? data.armorTraining?.[kind] ?? true)===false) disadvantage = true;
  }
  const active = modifiers(data,['roll.check','roll.initiative']);
  advantage ||= active.some(change=>change.operation==='advantage');
  disadvantage ||= active.some(change=>change.operation==='disadvantage');
  if (advantage!==disadvantage) formula = formula.replace(/(?<![A-Za-z0-9_])1d20(?![A-Za-z0-9_])/i,advantage ? '2d20kh1' : '2d20kl1');
  if (edition==='2024' && exhaustion && /\d+d20/i.test(formula)) formula+=` - ${exhaustion*2}`;
  for (const change of active) {
    if (['add','subtract'].includes(change.operation)) formula+=` ${change.operation==='add'?'+':'-'} (${numeric(change.value)})`;
    else if (change.operation==='add_dice') {
      const dice = String(change.value ?? '').trim();
      if (!/^\d{1,2}d\d{1,3}$/i.test(dice)) throw formulaError('combat-formula-invalid');
      formula+=' + '+dice;
    }
  }
  return {formula,data};
}

function duration(effect) {return object(effect.data) && Object.hasOwn(effect.data,'duration') ? effect.data.duration : effect.duration;}
function clockMatches(clock,event) {
  if (!object(clock) || !['rounds','turns'].includes(clock.type) || !['start','end'].includes(clock.expires) || clock.expires!==event.phase) return false;
  if (clock.sourceTokenId) return String(clock.sourceTokenId)===String(event.tokenId || '');
  if (clock.sourceActorId) return String(clock.sourceActorId)===String(event.actorId || '');
  return event.isCurrent===true;
}
function remaining(clock) {
  const value = Object.hasOwn(clock,'remaining') ? clock.remaining : clock.value;
  if (typeof value==='boolean' || typeof value==='string' && !/^[+-]?\d+$/.test(value.trim())) return null;
  const result = Number(value);
  return value!==null && value!==undefined && Number.isInteger(result) && result>=0 && result<=10000 ? result : null;
}
export function advanceEffectClocks(source,event={}) {
  const data = clone(source);let changed = false;
  if (!object(data) || !['start','end'].includes(event.phase)) return {data,changed};
  list(data.effects).slice(0,128).forEach((effect,index)=>{
    if (!object(effect) || effect.enabled===false || effect.data?.enabled===false
        || effect.data?.requiresAttunement===true && effect.attuned!==true) return;
    const key = JSON.stringify([...(event.documentKey || []),index,event.phase]);
    if (event.clockKeys?.has(key)) return;
    const clock = duration(effect);
    if (!clockMatches(clock,event)) return;
    const value = remaining(clock);if (value===null) return;
    clock.remaining = Math.max(0,value-1);effect.duration = clone(clock);
    if (object(effect.data?.duration)) effect.data.duration = clone(clock);
    if (!clock.remaining) effect.enabled = false;
    event.clockKeys?.add(key);changed = true;
  });
  return {data,changed};
}

function targetPath(target) {
  const normalized = String(target || '').trim();
  const value = ['', 'damage.self','heal.self','self','resource.hp'].includes(normalized) ? 'bars.bar_1.value'
    : normalized.startsWith('sheet.') ? normalized.slice(6) : '';
  if (!value || value.length>240 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value)
      || value.split('.').some(part=>['__proto__','constructor','prototype'].includes(part))) return null;
  return value;
}
function itemModifiers(item,id) {
  const changes = item.data?.modifiers || item.modifiers;
  return list(changes).slice(0,32).flatMap((change,index)=>{
    if (!object(change) || !['damage_over_time','heal_over_time'].includes(change.operation)) return [];
    const target = targetPath(change.target);if (!target) return [];
    const descriptor = {id:`${id}:${index}`,operation:change.operation,target,
      damageType:String(change.damageType || change.damage_type || '')};
    if (typeof change.value==='number' && Number.isFinite(change.value)) descriptor.amount = Math.max(0,Math.trunc(numeric(change.value)));
    else if (typeof change.value==='string' && change.value.trim()) descriptor.formula = change.value.trim();
    else return [];
    return [descriptor];
  });
}
const periodicEvent = event => event.periodic!==false && event.phase==='start' && event.isCurrent===true;
/** Detect candidates without consuming dice, changing clocks or evaluating conditions. */
export function hasCombatEffects(source,events=[]) {
  if (!object(source)) return false;
  let periodic;
  for (const event of list(events)) {
    if (!object(event)) continue;
    if (['start','end'].includes(event.phase) && list(source.effects).slice(0,128).some((effect,index)=>{
      if (!object(effect) || effect.enabled===false || effect.data?.enabled===false
          || effect.data?.requiresAttunement===true && effect.attuned!==true) return false;
      const key = JSON.stringify([...(event.documentKey || []),index,event.phase]);
      if (event.clockKeys?.has(key)) return false;
      const clock = duration(effect);
      return clockMatches(clock,event) && remaining(clock)!==null;
    })) return true;
    if (periodicEvent(event)) {
      periodic ??= activeItems(source).some(({item,id})=>itemModifiers(item,id).length>0
        || typeof item.data?.condition==='string' && !!item.data.condition.trim());
      if (periodic) return true;
    }
  }
  return false;
}
async function conditionPasses(item,data,{roll,prefix}={}) {
  const condition = item.data?.condition;
  return typeof condition!=='string' || !condition.trim() || (await evaluateCombatFormula(condition,data,{roll,prefix}))!==0;
}
export async function periodicModifiers(data,event={},options={}) {
  if (!object(data) || !periodicEvent(event)) return [];
  const result = [];
  for (const {item,id} of activeItems(data)) if (await conditionPasses(item,data,{...options,prefix:`${options.prefix || 'periodic'}:${id}:condition`})) result.push(...itemModifiers(item,id));
  return result;
}

export function applyPeriodic(source,descriptor,amount,{conditions=[],actorType}={}) {
  const original = clone(source), data = clone(source), count = Math.max(0,Math.trunc(numeric(amount)));
  if (!count || !object(data) || !descriptor || !['damage_over_time','heal_over_time'].includes(descriptor.operation)) return {data:original,changed:false};
  const path = targetPath('sheet.'+descriptor.target);if (!path) return {data:original,changed:false};
  const damaging = descriptor.operation==='damage_over_time';
  if (path==='bars.bar_1.value') {
    if (!damaging && data.death?.dead) return {data:original,changed:false};
    const beforeHP = numeric(data.bars?.bar_1?.value,numeric(data.hp?.value,10));
    if (damaging) {
      const hadConditions = Object.hasOwn(data,'conditions'), authoredConditions = clone(data.conditions);
      data.conditions = [...combatConditions(data,conditions)];
      if (!incomingDamage(data,count,descriptor.damageType)) return {data:original,changed:false};
      const hadSaves = Object.hasOwn(data,'deathSavesEnabled');
      if (!hadSaves) data.deathSavesEnabled = actorType!=='monster';
      const effects = clone(data.effects), concentration = clone(data.concentration);
      damage(data,count,{damageType:descriptor.damageType,edition:data.rulesEdition==='2024'?'2024':'2014'});
      if (!hadSaves) delete data.deathSavesEnabled;
      if (hadConditions) data.conditions = authoredConditions;else delete data.conditions;
      if (Object.hasOwn(original,'effects')) data.effects = effects;else delete data.effects;
      data.death = {...data.death,stable:Boolean(data.death?.stable),dead:Boolean(data.death?.dead),unconscious:Boolean(data.death?.unconscious)};
      if (data.death.dead || data.death.unconscious || combatConditions(data,conditions).has('incapacitated')) {
        data.concentration = {...(object(concentration)?concentration:{}),active:false,sourceId:'',pendingDC:null,pendingChecks:[]};
      }
    } else {
      heal(data,count);
      if (data.bars.bar_1.value<=beforeHP) return {data:original,changed:false};
    }
  } else {
    const parts = path.split('.');let parent = data;
    for (const part of parts.slice(0,-1)) {if (!object(parent[part])) parent[part]={};parent=parent[part];}
    const key = parts.at(-1), current = typeof parent[key]==='boolean' ? 0 : Math.trunc(numeric(parent[key]));
    parent[key] = Math.max(0,current+(damaging ? -count : count));
  }
  return {data,changed:true};
}

export async function advanceCombatEffects(source,event={},options={}) {
  let {data,changed} = advanceEffectClocks(source,event);
  if (!object(data) || !periodicEvent(event)) return {data,changed};
  // Re-evaluate conditions and amounts against each preceding applied effect.
  for (const {item,id} of activeItems(data)) {
    const prefix = `${options.prefix || 'periodic'}:${id}`;
    if (!(await conditionPasses(item,data,{...options,prefix:prefix+':condition'}))) continue;
    for (const descriptor of itemModifiers(item,id)) {
      const amount = descriptor.formula!==undefined
        ? await evaluateCombatFormula(descriptor.formula,data,{...options,prefix:`${prefix}:${descriptor.id}:amount`}) : descriptor.amount;
      const result = applyPeriodic(data,descriptor,amount,{conditions:event.conditions,actorType:event.actorType});
      data = result.data;changed ||= result.changed;
    }
  }
  return {data,changed};
}
