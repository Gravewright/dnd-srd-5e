// Original Gravewright rules. Identifiers and formulas are data, never executable code.
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const SKILLS = {acrobatics:'dex',animal_handling:'wis',arcana:'int',athletics:'str',deception:'cha',history:'int',insight:'wis',intimidation:'cha',investigation:'int',medicine:'wis',nature:'int',perception:'wis',performance:'cha',persuasion:'cha',religion:'int',sleight_of_hand:'dex',stealth:'dex',survival:'wis'};
export function skillAbility(d,skill,override) {
  const ability=ABILITIES.includes(override)?override:get(d,`skills.${skill}.ability`);
  return ABILITIES.includes(ability)?ability:SKILLS[skill];
}
export function skillModifier(d,skill,override) {
  const ability=skillAbility(d,skill,override),multiplier=get(d,`skills.${skill}.expert`,false)?2:get(d,`skills.${skill}.prof`,false)?1:0;
  const modifier=get(d,`abilities.${ability}.mod`,null);
  return (modifier===null?mod(effectiveAbilityScore(d,ability)):numeric(modifier))+numeric(d.prof)*multiplier;
}
const blocked = new Set(['__proto__','prototype','constructor']);
export const CONDITIONS=['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','surprised'];
export const DAMAGE_TYPES=['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
export class RuleError extends Error {
  constructor(code,details={}){super(code);this.name='RuleError';this.code=code;this.details=details;}
}
export function get(object, path, fallback = '') {
  if (typeof path !== 'string' || !path) return fallback;
  for (const key of path.replace(/^sheet\./, '').split('.')) {
    if (blocked.has(key) || !object || !Object.hasOwn(object,key)) return fallback;
    object = object[key];
  }
  return object ?? fallback;
}
export function set(object, path, value) {
  const keys = path.replace(/^sheet\./, '').split('.');
  if (keys.some(key => blocked.has(key) || !key)) throw Error('Invalid path');
  for (const key of keys.slice(0,-1)) object = object[key] && typeof object[key] === 'object' ? object[key] : (object[key] = {});
  object[keys.at(-1)] = value;
}
export function numeric(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(-1e6,Math.min(1e6,n)) : fallback; }
export const mod = score => Math.floor((numeric(score,10)-10)/2);
export const signed = value => `${numeric(value) >= 0 ? '+' : ''}${numeric(value)}`;
const integer=(value,fallback=0)=>Math.trunc(numeric(value,fallback));
const positive=value=>Math.max(0,integer(value));
export const itemAttunementActive=item=>item?.data?.requiresAttunement!==true||item?.attuned===true;
export function activeTraitItems(d,includeOrigins=false){
  const originTypes=new Set(['race','background','class']);
  const items=[...(Array.isArray(d.effects)?d.effects:[]),...(Array.isArray(d.features)?d.features:[]).filter(item=>includeOrigins||!originTypes.has(item?.type))];
  for(const key of ['weapons','inventory','equipment'])for(const item of Array.isArray(d[key])?d[key]:[])if(item?.equipped===true)items.push(item);
  return items.filter(item=>item&&item.enabled!==false&&item.data?.enabled!==false&&itemAttunementActive(item));
}
function templateChanges(d){
  const armor=[...(d.inventory||[]),...(d.equipment||[])].filter(item=>item?.equipped===true&&item.type==='armor');
  return activeTraitItems(d,true).flatMap(item=>(Array.isArray(item.data?.effectTemplates)?item.data.effectTemplates:[]).filter(template=>{
    if(!template||template.enabled===false)return false;
    const requirements=template.requirements||{},keys=Object.keys(requirements);
    if(keys.some(key=>!['unarmored','noShield'].includes(key)||typeof requirements[key]!=='boolean'))return false;
    if(requirements.unarmored&&armor.some(item=>item.data?.armor_type!=='shield')||requirements.noShield&&armor.some(item=>item.data?.armor_type==='shield'))return false;
    // A declared equipment-only guard can safely activate a conditional passive.
    return template.passive===true||keys.length>0&&template.manual!==true;
  }).flatMap(template=>(Array.isArray(template.changes)?template.changes:[]).map(change=>({...change,template}))));
}
function changeValue(change,d){return change.valueProfile?evaluateNumericProfile(change.valueProfile,d,{baseAbilities:true}):typeof change.value==='number'&&Number.isFinite(change.value)?change.value:null;}
function applyValue(base,change,d){
  const value=changeValue(change,d);if(value===null)return base;
  if(change.operation==='set')return value;if(change.operation==='minimum')return Math.max(base,value);
  if(change.operation==='maximum')return Math.min(base,value);if(change.operation==='add')return value>=0&&Number.isFinite(change.max)?Math.max(base,Math.min(change.max,base+value)):base+value;
  if(change.operation==='subtract')return base-value;if(change.operation==='multiply')return base*value;return base;
}
export function effectiveAbilityScore(d,ability){
  if(!ABILITIES.includes(ability))return 10;
  return Math.max(0,templateChanges(d).filter(change=>change.target===`ability.${ability}.score`).reduce((score,change)=>applyValue(score,change,d),numeric(get(d,`abilities.${ability}.score`,10),10)));
}
function movementState(d){
  const values={...(d.movement&&typeof d.movement==='object'?d.movement:{}),walk:numeric(d.speed,numeric(d.movement?.walk,30))};
  for(const change of templateChanges(d)){const match=/^movement\.(walk|climb|swim|fly|burrow)$/.exec(change.target||'');if(match)values[match[1]]=Math.max(0,applyValue(numeric(values[match[1]]),change,d));}
  return values;
}
function sensesState(d){
  const values={...(d.senses&&typeof d.senses==='object'?d.senses:{})};
  for(const change of templateChanges(d)){const match=/^senses\.(darkvision|blindsight|truesight|tremorsense)$/.exec(change.target||'');if(match)values[match[1]]=Math.max(0,applyValue(numeric(values[match[1]]),change,d));}return values;
}
export function mechanicalTraits(d){
  const defenses=value=>(Array.isArray(value)?value:[value]).filter(option=>['barbarian','monk'].includes(option));
  const result={...d.mechanicalTraits,saveAdvantages:[...(Array.isArray(d.mechanicalTraits?.saveAdvantages)?d.mechanicalTraits.saveAdvantages:[])],unarmoredDefense:defenses(d.mechanicalTraits?.unarmoredDefense)};
  for(const item of activeTraitItems(d)){
    const traits=item.data?.mechanicalTraits||{};
    for(const key of ['hpPerLevel','hpFlat'])if(typeof traits[key]==='number')result[key]=numeric(result[key])+numeric(traits[key]);
    for(const key of ['ignoreHeavyArmorSpeedPenalty','initiativeAdvantage','magicalSleepImmunity'])if(traits[key]===true)result[key]=true;
    for(const context of Array.isArray(traits.saveAdvantages)?traits.saveAdvantages:[])if(!result.saveAdvantages.includes(context))result.saveAdvantages.push(context);
    for(const option of defenses(traits.unarmoredDefense))if(!result.unarmoredDefense.includes(option))result.unarmoredDefense.push(option);
  }
  // Numeric HP changes are already normalized into hpFlat. Only declarative
  // formulas left in templates need evaluation here.
  for(const change of templateChanges(d))if(change.target==='hp.flat'&&change.valueProfile&&change.operation==='add'){const value=changeValue(change,d);if(value!==null)result.hpFlat=numeric(result.hpFlat)+value;}
  return result;
}
export function damageTraits(d){
  const result={};for(const key of ['resistances','immunities','vulnerabilities'])result[key]=[...new Set([...(Array.isArray(d.damageTraits?.[key])?d.damageTraits[key]:[]),...activeTraitItems(d).flatMap(item=>Array.isArray(item.data?.damageTraits?.[key])?item.data.damageTraits[key]:[])])];return result;
}
function effects(d) {
  const result=[...(Array.isArray(d.effects)?d.effects:[])];
  for(const key of ['inventory','weapons','equipment','features'])for(const item of Array.isArray(d[key])?d[key]:[])if((key==='features'?item?.enabled!==false:item?.equipped===true)&&Array.isArray(item?.data?.modifiers))result.push(item);
  return result.filter(effect=>effect&&effect.enabled!==false&&effect.data?.enabled!==false&&itemAttunementActive(effect));
}
export function modifiers(d, target) {
  const targets=new Set(Array.isArray(target)?target:[target]);
  return effects(d).flatMap(effect=>Array.isArray(effect.data?.modifiers)?effect.data.modifiers:[]).filter(change=>change&&targets.has(change.target));
}
export function defaults(schema, value) {
  if (schema.type === 'object') {
    const output = value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) output[key] = defaults(child, output[key]);
    return output;
  }
  if (value !== undefined) return structuredClone(value);
  if ('default' in schema) return structuredClone(schema.default);
  return schema.type === 'array' ? [] : schema.type === 'boolean' ? false : schema.type === 'number' ? 0 : '';
}
function ensureBars(d) {
  d.bars??={};d.bars.bar_1??={value:numeric(d.hp?.value,10),max:numeric(d.hp?.max,10)};d.bars.bar_2??={value:numeric(d.hp?.temp),max:0};
  d.bars.bar_1.value=positive(d.bars.bar_1.value);d.bars.bar_1.max=positive(d.bars.bar_1.max);d.bars.bar_2.value=positive(d.bars.bar_2.value);
  return d.bars;
}
function syncHP(d) {
  d.hp??={};d.hp.value=d.bars.bar_1.value;d.hp.max=d.bars.bar_1.max;d.hp.temp=d.bars.bar_2.value;return d;
}
function deathState(d) {
  d.death??={};d.death.success=Math.min(3,positive(d.death.success));d.death.fail=Math.min(3,positive(d.death.fail));return d.death;
}
export function conditionSet(d) {
  const ids=new Set((Array.isArray(d.conditions)?d.conditions:[]).filter(id=>CONDITIONS.includes(id)));
  if(d.death?.unconscious)ids.add('unconscious');
  for(const effect of effects(d)){const id=effect.data?.conditionId||effect.data?.systemCondition;if(CONDITIONS.includes(id))ids.add(id);}
  const immunities=[...(Array.isArray(d.conditionImmunities)?d.conditionImmunities:[]),...activeTraitItems(d).flatMap(item=>Array.isArray(item.data?.conditionImmunities)?item.data.conditionImmunities:[])];
  for(const id of immunities)ids.delete(id);
  if(ids.has('petrified'))ids.delete('poisoned');
  if(['paralyzed','petrified','stunned','unconscious'].some(id=>ids.has(id)))ids.add('incapacitated');return ids;
}
export function incapacitated(d){return !!d.death?.dead||conditionSet(d).has('incapacitated');}
function flatModifiers(changes,base) {
  let value=base;
  for(const change of changes){if(change.operation==='set')value=numeric(change.value);if(change.operation==='add')value+=numeric(change.value);if(change.operation==='subtract')value-=numeric(change.value);}
  return value;
}
export function armorState(d,edition=d.rulesEdition||'2014') {
  const dex=mod(effectiveAbilityScore(d,'dex')),traits=mechanicalTraits(d);
  const items=[...(d.inventory||[]),...(d.equipment||[])].filter(item=>item?.equipped&&item.type==='armor');
  const suits=items.filter(item=>item.data?.armor_type!=='shield'),shields=items.filter(item=>item.data?.armor_type==='shield'),armor=suits[0],shield=shields[0],data=armor?.data||{};
  const trained=item=>typeof item?.data?.trained==='boolean'?item.data.trained:d.armorTraining?.[item?.data?.armor_type]!==false;
  const armorAC=item=>numeric(item?.data?.base_ac,item?.data?.armor_type==='shield'?2:10)-(itemAttunementActive(item)?0:numeric(item?.data?.magicBonus));
  let ac=armor?armorAC(armor):10+numeric(dex);
  if(!armor){
    if(traits.unarmoredDefense.includes('barbarian'))ac=Math.max(ac,10+dex+mod(effectiveAbilityScore(d,'con')));
    if(!shield&&traits.unarmoredDefense.includes('monk'))ac=Math.max(ac,10+dex+mod(effectiveAbilityScore(d,'wis')));
  }
  if(armor&&data.add_dex!==false)ac+=data.armor_type==='medium'?Math.min(numeric(dex),numeric(data.max_dex,2)):numeric(dex);
  if(shield&&(edition==='2014'||trained(shield)))ac+=armorAC(shield);
  return {ac,armor,shield,multipleArmor:suits.length>1,multipleShields:shields.length>1,
    untrained:!!(armor&&!trained(armor)||edition==='2014'&&shield&&!trained(shield)),
    stealthDisadvantage:!!armor?.data?.stealth_disadvantage,speedPenalty:armor&&data.armor_type==='heavy'&&!traits.ignoreHeavyArmorSpeedPenalty&&numeric(data.str_req)>effectiveAbilityScore(d,'str')?10:0};
}
function maximumHP(d,edition) {
  ensureBars(d);const factor=edition==='2014'&&d.exhaustion>=4?0.5:1;
  const traits=mechanicalTraits(d),previousBonus=numeric(d.hpTraitBonus),bonus=numeric(traits.hpPerLevel)*positive(d.level)+numeric(traits.hpFlat);
  if(!Number.isFinite(d.hpBaseMax))d.hpBaseMax=d.bars.bar_1.max;
  else if(Number.isFinite(d.hpDerivedMax)&&d.bars.bar_1.max!==d.hpDerivedMax)d.hpBaseMax=d.bars.bar_1.max/factor+positive(d.hpMaxReduction)-previousBonus;
  const maximum=Math.max(0,Math.floor((positive(d.hpBaseMax)+bonus-positive(d.hpMaxReduction))*factor));
  d.bars.bar_1.max=maximum;d.hpDerivedMax=maximum;d.hpTraitBonus=bonus;d.bars.bar_1.value=Math.min(d.bars.bar_1.value,maximum);
}
function refreshClassHP(d,source=d) {
  // Class advancement explicitly opts into Constitution-derived HP. Preserve
  // the per-level minimum rather than applying an unconditional CON * level.
  if(!Number.isFinite(source.hpConModifier)||positive(source.classHitPointLevels)<1)return;
  const con=mod(effectiveAbilityScore(d,'con')),before=source.hpConModifier,levels=positive(source.classHitPointLevels);
  const classes=Object.values(source.advancementLedger?.parents||{}).filter(parent=>parent?.type==='class'&&!parent.item?.data?.isSubclass&&parent.hpRolls);
  const rolls=classes.flatMap(parent=>Object.entries(parent.hpRolls).filter(([level])=>positive(level)<=positive(parent.classLevel)).map(([,value])=>numeric(value)));
  const delta=rolls.length===levels?rolls.reduce((sum,roll)=>sum+Math.max(1,roll+con)-Math.max(1,roll+before),0):(con-before)*levels;
  d.hpBaseMax=Math.max(levels,numeric(d.hpBaseMax,d.bars.bar_1.max)+delta);d.hpConModifier=con;
}
export function heal(d,amount) {
  ensureBars(d);const death=deathState(d);amount=positive(amount);
  if(!death.dead&&amount>0){const before=d.bars.bar_1.value;d.bars.bar_1.value=Math.min(d.bars.bar_1.max,before+amount);if(d.bars.bar_1.value>before)Object.assign(death,{success:0,fail:0,stable:false,unconscious:false,knockedOut:false});}
  return syncHP(d);
}
export function grantTemporaryHP(d,amount,{replace=true}={}){ensureBars(d);if(replace)d.bars.bar_2.value=positive(amount);return syncHP(d);}
export function stabilize(d) {
  ensureBars(d);const death=deathState(d);if(!death.dead&&d.bars.bar_1.value===0)Object.assign(death,{success:0,fail:0,stable:true,unconscious:true});return d;
}
export function deathSave(d,{natural,total}) {
  ensureBars(d);const death=deathState(d);
  if(d.deathSavesEnabled===false||death.dead||death.stable||d.bars.bar_1.value>0)throw new RuleError('death_save_unavailable');
  if(!Number.isInteger(natural)||natural<1||natural>20||!Number.isFinite(total))throw new RuleError('invalid_roll');
  if(natural===20)return heal(d,1);
  if(natural===1)death.fail=Math.min(3,death.fail+2);else if(total>=10)death.success=Math.min(3,death.success+1);else death.fail=Math.min(3,death.fail+1);
  if(death.fail>=3){death.dead=true;endConcentration(d);}else if(death.success>=3)stabilize(d);return d;
}
export function concentrationDC(amount,edition='2014') {
  const dc=Math.max(10,Math.floor(Math.max(0,numeric(amount))/2));return edition==='2024'?Math.min(30,dc):dc;
}
export function endConcentration(d) {
  const source=d.concentration?.sourceId;
  for(const effect of d.effects||[])if(effect.data?.concentration&&(!source||effect.id===source))effect.enabled=false;
  d.concentration={active:false,sourceId:'',pendingDC:0,pendingChecks:[]};return d;
}
export function startConcentration(d,sourceId) {
  if(typeof sourceId!=='string'||!sourceId)throw new RuleError('invalid_source');if(incapacitated(d))throw new RuleError('incapacitated');
  endConcentration(d);for(const effect of d.effects||[])if(effect.data?.concentration)effect.enabled=effect.id===sourceId;
  d.concentration={active:true,sourceId,pendingDC:0,pendingChecks:[]};return d;
}
export function concentrationSave(d,{total}) {
  if(!d.concentration?.active||!d.concentration.pendingDC)throw new RuleError('concentration_save_unavailable');if(!Number.isFinite(total))throw new RuleError('invalid_roll');
  if(total<d.concentration.pendingDC||incapacitated(d))return endConcentration(d);
  d.concentration.pendingChecks?.shift();d.concentration.pendingDC=d.concentration.pendingChecks?.[0]?.dc||0;return d;
}
export function hitDicePools(d) {
  const normalized=(pool,index)=>({...pool,id:String(pool.id??index),max:positive(pool.max),value:Math.min(positive(pool.max),positive(pool.value))});
  const pools=(Array.isArray(d.hitDicePools)?d.hitDicePools:[]).filter(pool=>pool&&/^d(?:6|8|10|12)$/.test(pool.die)).map(normalized);if(pools.length)return pools;
  if(positive(d.hitDice?.max)&&/^d(?:6|8|10|12)$/.test(d.hitDice.die))return [normalized({...d.hitDice,id:'default'},0)];
  const match=String(d.hitdice||'').match(/^\s*(\d+)\s*\/\s*(\d+)\s*(d(?:6|8|10|12))\s*$/i);
  return match?[normalized({id:'default',value:positive(match[1]),max:positive(match[2]),die:match[3].toLowerCase()},0)]:[];
}
function saveHitDice(d,pools) {
  if(Array.isArray(d.hitDicePools)&&d.hitDicePools.length)d.hitDicePools=pools;
  else if(pools.length===1){const {value,max,die}=pools[0];d.hitDice={value,max,die};if(typeof d.hitdice==='string')d.hitdice=`${value} / ${max} ${die}`;}
}
export function restEligibility(d,edition=d.rulesEdition||'2014',options={},short=false) {
  ensureBars(d);if(options.eligible===false)throw new RuleError('rest_ineligible');if(d.death?.dead)throw new RuleError('rest_dead');
  if(d.bars.bar_1.value<1&&(!short||edition==='2024'))throw new RuleError('rest_zero_hp');
  if(!short&&options.validateTime&&Number.isFinite(options.now)&&Number.isFinite(d.lastLongRest)){
    // lastLongRest/now record completion. In 2024 the 16-hour wait is BEFORE
    // starting the next rest; its own duration must not count toward that wait.
    const hours=typeof options.durationHours==='number'&&Number.isFinite(options.durationHours)&&options.durationHours>0?options.durationHours:8;
    const start=Number.isFinite(options.startedAt)?options.startedAt:options.now-hours*3600000;
    if(start>options.now)throw new RuleError('rest_ineligible');
    if((edition==='2024'?start:options.now)-d.lastLongRest<(edition==='2024'?16:24)*3600000)throw new RuleError('rest_too_soon');
  }
  return d;
}
function recoverUses(d,rest) {
  refreshUses(d);
  const recover=(uses,data)=>{
    if(!uses||typeof uses!=='object')return false;
    const rule=data.recovery?.[rest];
    if(rule?.mode==='all')uses.value=positive(uses.max);
    else if(rule?.mode==='amount')uses.value=Math.min(positive(uses.max),positive(uses.value)+positive(rule.amount));
    else if(!['short','long'].some(key=>['all','amount'].includes(data.recovery?.[key]?.mode))&&(data.recharge===rest||rest==='long'&&data.recharge==='short'))uses.value=positive(uses.max);
    else return false;
    return true;
  };
  for(const list of ['features','inventory','weapons','equipment','spells'])for(const item of Array.isArray(d[list])?d[list]:[])if(recover(item?.data?.uses,item?.data||{}))item.data.usesSpent=Math.max(0,positive(item.data.uses.max)-positive(item.data.uses.value));
  for(const resource of Object.values(d.resources||{}))if(resource&&typeof resource==='object')recover(resource,resource);
}
/** Evaluate only the bounded declarative resource AST; unsupported context stays manual. */
export function evaluateNumericProfile(profile,d,{baseAbilities=false}={}){
  let count=0;
  const evaluate=(node,depth=0)=>{
    if(++count>80||depth>12||!node||typeof node!=='object'||Array.isArray(node))return null;
    let value;
    if(node.type==='constant')value=node.value;
    else if(node.type==='abilityModifier'&&ABILITIES.includes(node.ability))value=mod(baseAbilities?get(d,`abilities.${node.ability}.score`,10):effectiveAbilityScore(d,node.ability));
    else if(node.type==='proficiency')value=d.prof;
    else if(node.type==='classLevel'){
      if(typeof node.classId!=='string'||blocked.has(node.classId))return null;
      const parent=Object.values(d.advancementLedger?.parents||{}).find(parent=>parent?.type==='class'&&!parent.item?.data?.isSubclass&&(parent.item?.data?.identifier===node.classId||parent.item?.data?.classIdentifier===node.classId));
      value=parent?.classLevel??d.classLevels?.[node.classId];
    }else if(node.type==='scale'){
      if(typeof node.classId!=='string'||typeof node.identifier!=='string'||[node.classId,node.identifier].some(id=>blocked.has(id)))return null;
      const scale=d.scales?.[node.classId]?.[node.identifier];value=typeof scale==='number'?scale:scale?.value;
    }else if(['add','subtract','multiply','divide','max','min'].includes(node.type)&&Array.isArray(node.args)&&node.args.length>0&&node.args.length<=12){
      const args=node.args.map(arg=>evaluate(arg,depth+1));if(args.some(value=>value===null))return null;
      if(node.type==='add')value=args.reduce((sum,n)=>sum+n,0);
      if(node.type==='subtract')value=args.slice(1).reduce((sum,n)=>sum-n,args[0]);
      if(node.type==='multiply')value=args.reduce((product,n)=>product*n,1);
      if(node.type==='divide'){if(args.slice(1).some(n=>n===0))return null;value=args.slice(1).reduce((result,n)=>result/n,args[0]);}
      if(node.type==='max')value=Math.max(...args);if(node.type==='min')value=Math.min(...args);
    }
    return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e6?value:null;
  };
  return evaluate(profile);
}
export function evaluateUsesProfile(profile,d){const value=evaluateNumericProfile(profile,d);return value===null?null:Math.max(0,Math.floor(value));}
function refreshUses(d){
  for(const key of ['features','spells','weapons','inventory','equipment'])for(const item of Array.isArray(d[key])?d[key]:[]){
    const data=item?.data;if(!data?.usesProfile)continue;
    const maximum=evaluateUsesProfile(data.usesProfile,d);if(maximum===null)continue;
    const uses=data.uses&&typeof data.uses==='object'?data.uses:{};
    const spent=positive(uses.max)>0?Math.max(0,positive(uses.max)-positive(uses.value)):positive(data.usesSpent);
    data.uses={...uses,max:maximum,value:Math.max(0,maximum-spent)};data.usesSpent=spent;
  }
}
export function consumeItem(item,{amount=1,quantity=false}={}){
  if(!item||!Number.isInteger(amount)||amount<1)throw new RuleError(quantity?'item_quantity_unavailable':'resource_unavailable');
  if(quantity){const value=positive(item.quantity??item.data?.quantity??1);if(value<amount)throw new RuleError('item_quantity_unavailable');item.quantity=value-amount;}
  else {const uses=item.data?.uses;if(!uses||typeof uses!=='object'||positive(uses.value)<amount)throw new RuleError('resource_unavailable');uses.value=positive(uses.value)-amount;item.data.usesSpent=Math.max(0,positive(uses.max)-uses.value);}
  return item;
}
export function spendHitDie(d,poolId,roll,{edition=d.rulesEdition||'2014'}={}) {
  restEligibility(d,edition,{},true);const pools=hitDicePools(d),pool=pools.find(x=>x.id===String(poolId)||x.die===poolId)||(poolId==='default'&&pools.length===1?pools[0]:null);
  if(!pool||positive(pool.value)<1)throw new RuleError('hit_die_unavailable');if(!Number.isInteger(roll)||roll<1||roll>Number(pool.die.slice(1)))throw new RuleError('invalid_roll');
  pool.value=positive(pool.value)-1;saveHitDice(d,pools);return heal(d,Math.max(edition==='2024'?1:0,roll+mod(effectiveAbilityScore(d,'con'))));
}
export function finishShortRest(d,edition=d.rulesEdition||'2014',options={}) {
  restEligibility(d,edition,options,true);recoverUses(d,'short');if(d.pactSlots&&typeof d.pactSlots==='object')d.pactSlots.value=positive(d.pactSlots.max);return d;
}
export const shortRest=finishShortRest;
export function longRest(d,edition=d.rulesEdition||'2014',options={}) {
  restEligibility(d,edition,options);if(edition==='2024'||options.foodAndDrink!==false)d.exhaustion=Math.max(0,numeric(d.exhaustion)-1);
  if(edition==='2024'){
    d.hpMaxReduction=0;
    for(const [ability,score] of Object.entries(d.abilityScoreBases||{}))if(ABILITIES.includes(ability)&&Number.isFinite(score)&&score>numeric(get(d,`abilities.${ability}.score`,10),10))set(d,`abilities.${ability}.score`,score);
  }
  refreshClassHP(d);
  maximumHP(d,edition);heal(d,d.bars.bar_1.max);d.bars.bar_2.value=0;
  const pools=hitDicePools(d),maximum=pools.reduce((sum,p)=>sum+positive(p.max),0);let recovery=edition==='2024'?maximum:Math.max(1,Math.floor(maximum/2));
  const order=options.hitDiceOrder||pools.map(p=>p.id);
  const rank=id=>{const index=order.indexOf(id);return index<0?order.length:index;};
  for(const pool of [...pools].sort((a,b)=>rank(a.id)-rank(b.id))){const recovered=Math.min(recovery,Math.max(0,positive(pool.max)-positive(pool.value)));pool.value=positive(pool.value)+recovered;recovery-=recovered;}
  saveHitDice(d,pools);for(const slot of Object.values(d.slots||{}))if(slot&&typeof slot==='object')slot.value=positive(slot.max);
  if(d.pactSlots&&typeof d.pactSlots==='object')d.pactSlots.value=positive(d.pactSlots.max);recoverUses(d,'long');d.casting={};if(Number.isFinite(options.now))d.lastLongRest=options.now;return syncHP(d);
}
export function derive(raw, type, schema, edition) {
  raw??={};
  const d = defaults(schema, raw);
  d.rulesEdition = edition;
  d.acMode=['manual','equipment'].includes(raw.acMode)?raw.acMode:type==='character'?'equipment':'manual';
  // Earlier sheets persisted the schema's manual default without recording a
  // choice. Equipped armor opts those character drafts into the corrected
  // default; a recorded manual choice and the stored manual AC remain intact.
  if(type==='character'&&d.acMode==='manual'&&raw.acModeExplicit!==true&&[...(d.inventory||[]),...(d.equipment||[])].some(item=>item?.equipped===true&&item.type==='armor'))d.acMode='equipment';
  d.armorTraining={light:true,medium:true,heavy:true,shield:true,...structuredClone(raw.armorTraining||{})};
  d.mechanicalTraits=structuredClone(raw.mechanicalTraits||{});
  d.abilityScoreBases=structuredClone(raw.abilityScoreBases||{});
  ensureBars(d);
  if(!Number.isFinite(raw.hpBaseMax))d.hpBaseMax=d.bars.bar_1.max;
  if(!Number.isFinite(raw.hpDerivedMax))delete d.hpDerivedMax;
  if(!Number.isFinite(raw.hpConModifier))delete d.hpConModifier;
  if(!Number.isFinite(raw.lastLongRest))delete d.lastLongRest;
  d.level = Math.max(1,Math.min(20,Math.trunc(numeric(d.level,1))));
  d.exhaustion = Math.max(0,Math.min(6,integer(d.exhaustion)));
  if (type === 'character') d.prof = 2 + Math.floor((d.level-1)/4);
  for (const ability of ABILITIES) {
    set(d,`abilities.${ability}.effectiveScore`,effectiveAbilityScore(d,ability));
    set(d,`abilities.${ability}.mod`,mod(get(d,`abilities.${ability}.effectiveScore`,10)));
    set(d,`saves.${ability}.mod`,get(d,`abilities.${ability}.mod`,0) + (get(d,`saves.${ability}.prof`,false) ? numeric(d.prof) : 0));
  }
  for (const skill of Object.keys(SKILLS)) {
    // Optional links retain the original ability until the owner chooses one.
    if(!ABILITIES.includes(get(d,`skills.${skill}.ability`)))delete d.skills[skill].ability;
    if(get(d,`skills.${skill}.expert`,false))set(d,`skills.${skill}.prof`,true);
    set(d,`skills.${skill}.mod`,skillModifier(d,skill));
  }
  // Only class advancement opts into retroactive Constitution changes. Manual
  // HP sheets and monster stat blocks keep their recorded maximum.
  refreshClassHP(d,raw);
  refreshUses(d);
  for (const skill of ['perception','investigation','insight']) {
    const context=rollContext(d,{id:`roll.skill.${skill}`},{edition});
    d[`passive_${skill}`]=10+flatModifiers(modifiers(d,['roll.check',`roll.skill.${skill}`]),get(d,`skills.${skill}.mod`,0))+(context.advantage!==context.disadvantage?(context.advantage?5:-5):0);
  }
  const dex = get(d,'abilities.dex.mod',0);
  d.init = dex + numeric(d.init_misc) - (edition === '2024' ? d.exhaustion*2 : 0);
  d.spell ??= {};
  d.spell.mod = get(d,`abilities.${d.spell.ability || 'int'}.mod`,0);
  d.spell.attack = flatModifiers(modifiers(d,'spell.attack'),numeric(d.prof) + d.spell.mod);
  d.spell.dc = spellSaveDC(d);
  d.effective_ac=flatModifiers(modifiers(d,['stat.ac','stat.armor_class']),d.acMode==='equipment'?armorState(d,edition).ac:numeric(d.ac,10));
  // Conditional AC templates have not also been copied into modifiers.
  for(const change of templateChanges(d))if(change.target==='ac'&&change.template.requirements&&Object.keys(change.template.requirements).length)d.effective_ac=applyValue(d.effective_ac,change,d);
  d.effectiveMovement=Object.fromEntries(Object.entries(movementState(d)).map(([kind,speed])=>[kind,adjustSpeed(d,numeric(speed),edition)]));
  d.effectiveSenses=sensesState(d);
  maximumHP(d,edition);
  const death=deathState(d);
  // Explicit overrides let important monsters use death saves as PCs do.
  if(raw.deathSavesEnabled===undefined)d.deathSavesEnabled=type!=='monster';
  if(d.exhaustion>=6||death.fail>=3||edition==='2024'&&d.bars.bar_1.max===0)death.dead=true;
  if(death.dead)d.bars.bar_1.value=0;
  if(d.bars.bar_1.value===0)death.unconscious=true;
  else if(!death.knockedOut)Object.assign(death,{success:0,fail:0,stable:false,unconscious:false});
  if(!death.dead&&d.bars.bar_1.value===0&&death.success>=3)stabilize(d);
  if(incapacitated(d))endConcentration(d);
  syncHP(d);
  d.token ??= {};
  d.token.display ??= {name:true,bar_1:true,bar_2:false};
  d.token.size ??= 1;
  return d;
}
export function edit(d, path, value) {
  const bar = {'sheet.hp.value':'bars.bar_1.value','sheet.hp.max':'bars.bar_1.max','sheet.hp.temp':'bars.bar_2.value'}[path];
  if(path==='sheet.hp.max') {
    const factor=d.rulesEdition==='2014'&&d.exhaustion>=4?0.5:1;
    d.hpBaseMax=positive(value)/factor+positive(d.hpMaxReduction)-numeric(d.hpTraitBonus);d.hpDerivedMax=positive(value);
  }
  set(d,bar || path,value);
}
export function incomingDamage(d,amount,damageType='') {
  amount=Math.max(0,Math.floor(numeric(amount)));
  if(damageType&&!DAMAGE_TYPES.includes(damageType))throw new RuleError('invalid_damage_type');
  const active=modifiers(d,['damage.received',...(damageType?[`damage.received.${damageType}`]:[])]),traits=damageTraits(d);
  const petrified=conditionSet(d).has('petrified');
  if(active.some(x=>x.operation==='immunity')||damageType&&traits.immunities?.includes(damageType)||petrified&&d.rulesEdition!=='2024'&&damageType==='poison')return 0;
  amount=Math.max(0,amount-active.filter(x=>x.operation==='reduce').reduce((sum,x)=>sum+Math.max(0,numeric(x.value)),0));
  if(petrified||active.some(x=>x.operation==='resistance')||damageType&&traits.resistances?.includes(damageType))amount=Math.floor(amount/2);
  if(active.some(x=>x.operation==='vulnerability')||damageType&&traits.vulnerabilities?.includes(damageType))amount*=2;
  return Math.max(0,Math.floor(amount));
}
export function damage(d,amount,{damageType='',critical=false,edition=d.rulesEdition||'2014',nonlethal=false,melee=false}={}) {
  ensureBars(d);const death=deathState(d),before=d.bars.bar_1.value;
  amount=incomingDamage(d,amount,damageType);if(!amount)return syncHP(d);
  const absorbed=Math.min(d.bars.bar_2.value,amount),remaining=amount-absorbed;
  d.bars.bar_2.value-=absorbed;d.bars.bar_1.value=Math.max(0,before-remaining);
  d.lastDamage={amount,absorbed,hpLoss:Math.min(before,remaining),damageType};
  if(!death.dead&&nonlethal&&melee&&before>0&&d.bars.bar_1.value===0) {
    if(edition==='2024'){d.bars.bar_1.value=1;death.unconscious=true;death.knockedOut=true;}
    else stabilize(d);
  } else if(!death.dead&&d.bars.bar_1.value===0) {
    death.unconscious=true;
    if(d.deathSavesEnabled===false||(before>0?remaining-before:amount)>=d.bars.bar_1.max)death.dead=true;
    else if(before===0){death.stable=false;death.fail=Math.min(3,death.fail+(critical?2:1));if(death.fail>=3)death.dead=true;}
  }
  if(incapacitated(d))endConcentration(d);
  else if(d.concentration?.active) {
    const dc=concentrationDC(amount,edition);d.concentration.pendingChecks??=[];
    d.concentration.pendingChecks.push({dc,damage:amount});d.concentration.pendingDC=d.concentration.pendingChecks[0].dc;
  }
  return syncHP(d);
}
function adjustSpeed(d,speed,edition){
  const level=numeric(d.exhaustion),conditions=conditionSet(d);
  if(level>=6||edition==='2014'&&level>=5||['grappled','restrained','paralyzed','petrified','unconscious'].some(x=>conditions.has(x))||edition==='2014'&&conditions.has('stunned'))return 0;
  const adjusted=Math.max(0,speed-armorState(d,edition).speedPenalty);
  return Math.max(0,edition==='2024'?adjusted-level*5:level>=2?Math.floor(adjusted/2):adjusted);
}
export function effectiveSpeed(d,edition=d.rulesEdition||'2014'){return adjustSpeed(d,movementState(d).walk,edition);}
// SRD library weapons opt into ability-based rolls; older manual entries retain
// their stored bonuses until the player chooses an attack ability.
export function weaponBonuses(d,item,{offhand=false,addOffhandAbility=false}={}) {
  const data=item?.data || {}, mode=data.attack_ability || 'none';
  const abilityMod=ability=>numeric(get(d,`abilities.${ability}.mod`,mod(get(d,`abilities.${ability}.score`,10))));
  let ability=ABILITIES.includes(mode)?mode:'none';
  if(mode==='auto') {
    ability=data.attack_type==='ranged'?'dex':'str';
    if(data.props?.finesse)ability=abilityMod('dex')>abilityMod('str')?'dex':'str';
  }
  const abilityModifier=ability==='none'?0:abilityMod(ability);
  const automaticProficiency=d.weaponProficiencyMode==='class'&&data.proficiencyMode!=='manual'&&(['simple','martial'].includes(data.weaponGroup)||!!data.baseWeapon);
  const proficient=automaticProficiency?(d.weaponProficiencies||[]).some(id=>id===data.weaponGroup||id===data.baseWeapon):data.proficient!==false, proficiencyBonus=proficient?numeric(d.prof):0;
  const inactiveMagic=itemAttunementActive(item)?0:numeric(data.magicBonus);
  return {ability,abilityModifier,proficient,proficiencyBonus,
    attackBonus:flatModifiers(data.attack_type==='ranged'?modifiers(d,'weapon.attack.ranged'):[],abilityModifier+proficiencyBonus+numeric(data.attack_bonus)-inactiveMagic),
    damageBonus:(offhand&&!addOffhandAbility?Math.min(0,abilityModifier):abilityModifier)+numeric(data.damage_bonus)-inactiveMagic};
}
function actionCategory(action) {
  const id=action.id||'';return /damage|healing|temporary/.test(id)?'roll.damage':id.includes('attack')?'roll.attack':id.includes('save')?'roll.save':'roll.check';
}
export function automaticFailure(d,action) {
  return /(?:^|\.)save\.(str|dex)$/.test(String(action.id||''))&&['paralyzed','petrified','stunned','unconscious'].some(id=>conditionSet(d).has(id));
}
export function rollContext(d,action,options={}) {
  const edition=options.edition||d.rulesEdition||'2014',id=action.id||'',category=actionCategory(action),conditions=conditionSet(d),target=new Set((options.targetConditions||[]).filter(x=>CONDITIONS.includes(x)));
  const changes=modifiers(d,[category,id,...(options.concentration?['concentration']:[])]);let advantage=options.mode==='advantage'||edition==='2014'&&options.inspiration===true||changes.some(x=>x.operation==='advantage'),disadvantage=options.mode==='disadvantage'||changes.some(x=>x.operation==='disadvantage');
  const armor=armorState(d,edition);
  const traits=mechanicalTraits(d);
  if(id==='roll.initiative'&&traits.initiativeAdvantage===true)advantage=true;
  const saveAgainst=Array.isArray(options.saveAgainst)?options.saveAgainst:[options.saveAgainst];
  if(category==='roll.save'&&saveAgainst.some(id=>id&&traits.saveAdvantages?.includes(id)))advantage=true;
  if(options.concentration&&templateChanges(d).some(change=>change.target==='concentration'&&change.operation==='advantage'))advantage=true;
  if(edition==='2014'&&d.exhaustion>=1&&category==='roll.check')disadvantage=true;
  if(edition==='2014'&&d.exhaustion>=3&&(category==='roll.attack'||category==='roll.save'))disadvantage=true;
  if((conditions.has('poisoned')||conditions.has('frightened')&&options.fearSourceVisible)&&(category==='roll.check'||category==='roll.attack'))disadvantage=true;
  const skill=id.startsWith('roll.skill.')?id.slice(11):null,ability=skill?skillAbility(d,skill,options.skillAbility):null;
  if(armor?.untrained&&(id==='weapon.attack'&&['str','dex'].includes(weaponBonuses(d,options.item).ability)||/(?:check|save)\.(str|dex)$/.test(id)||skill&&['str','dex'].includes(ability)||id==='roll.initiative'))disadvantage=true;
  if(skill==='stealth'&&ability==='dex'&&armor?.stealthDisadvantage)disadvantage=true;
  if(id==='roll.save.dex'&&conditions.has('restrained'))disadvantage=true;
  if(id==='roll.initiative'&&edition==='2024'){if(conditions.has('surprised')||conditions.has('incapacitated'))disadvantage=true;if(conditions.has('invisible'))advantage=true;}
  if(category==='roll.attack') {
    if(id==='weapon.attack'&&options.item?.data?.props?.heavy){
      if(edition==='2014'&&['small','tiny','sm'].includes(String(d.size||'').toLowerCase()))disadvantage=true;
      if(edition==='2024'&&effectiveAbilityScore(d,options.item.data.attack_type==='ranged'?'dex':'str')<13)disadvantage=true;
    }
    if(['blinded','prone','restrained'].some(x=>conditions.has(x)))disadvantage=true;
    if(conditions.has('invisible')&&(edition==='2014'||options.targetCanSeeAttacker!==true))advantage=true;
    if(target.has('invisible')&&(edition==='2014'||options.canSeeTarget!==true))disadvantage=true;
    if(['blinded','paralyzed','petrified','restrained','stunned','unconscious'].some(x=>target.has(x)))advantage=true;
    if(target.has('prone')||target.has('unconscious'))if(Number.isFinite(options.distance)){if(options.distance<=5)advantage=true;else disadvantage=true;}
  }
  return {advantage,disadvantage,immune:category==='roll.save'&&saveAgainst.includes('magicalSleep')&&traits.magicalSleepImmunity===true?'magicalSleep':'',automaticFailure:automaticFailure(d,action),incapacitated:incapacitated(d),critical:category==='roll.attack'&&Number.isFinite(options.distance)&&options.distance<=5&&(target.has('paralyzed')||target.has('unconscious'))};
}
function safeFormula(formula) {
  if(typeof formula!=='string'||!formula.trim()||formula.length>180||!/^[\d\sdDkhlo!r<>=+*\/%().,-]+$/.test(formula))throw new RuleError('invalid_formula');return formula;
}
export function criticalFormula(formula) {
  safeFormula(formula);
  return formula.replace(/\b(\d{1,3})d(\d{1,4})(?:kh|kl|dh|dl)?\d*/gi,die=>{
    const match=die.match(/^(\d+)d(\d+)(.*)$/i);if(Number(match[1])>50)throw new RuleError('invalid_formula');
    // Repeat kept-dice pools instead of keeping only half the critical dice.
    return match[3]?`(${die} + ${die})`:`${Number(match[1])*2}d${match[2]}`;
  });
}
export function spellRollKind(item) {
  const profile=spellProfile(item?.data);if(profile?.manual||profile?.applicationManual)return 'manual';
  return ['damage','healing','temporary'].includes(profile?.kind)?profile.kind:item?.data?.healingFormula?'healing':'damage';
}
export function spellSaveDC(d,item){
  const ability=item?.data?.spell_ability,abilityModifier=ABILITIES.includes(ability)?get(d,`abilities.${ability}.mod`,mod(get(d,`abilities.${ability}.score`,10))):numeric(d.spell?.mod);
  return flatModifiers(modifiers(d,'spell.dc'),8+numeric(d.prof)+abilityModifier);
}
function spellProfile(data) {
  const profile=data?.formulaProfile;
  // Optional metadata may have been expanded by an older schema editor.
  return profile&&(profile.version||profile.kind)?profile:null;
}
function profilePart(part) {
  const terms=[];
  for(const die of part?.dice||[]){if(!Number.isInteger(die.number)||die.number<1||die.number>50||!Number.isInteger(die.faces)||die.faces<2||die.faces>1000)throw new RuleError('invalid_formula');terms.push(`${die.number}d${die.faces}`);}
  if(numeric(part?.constant))terms.push(String(numeric(part.constant)));return terms;
}
export function spellFormula(d,item,{slotLevel,critical=false}={}) {
  const data=item?.data||{},profile=spellProfile(data);
  if(!profile){const formula=safeFormula(data.healingFormula||data.damage||'');return critical&&!data.healingFormula?criticalFormula(formula):formula;}
  if(profile.version!==1||!['damage','healing','temporary'].includes(profile.kind))throw new RuleError('invalid_formula');
  if(slotLevel!==undefined&&(!Number.isInteger(slotLevel)||slotLevel<integer(data.level)||slotLevel>9))throw new RuleError('spell_unknown_level');
  const terms=profilePart(profile.base);
  if(profile.base?.spellModifier)terms.push(String(ABILITIES.includes(data.spell_ability)?get(d,`abilities.${data.spell_ability}.mod`,0):numeric(d.spell?.mod)));
  const scaling=profile.scaling;
  if(scaling&&!profile.scalingManual) {
    let steps=0;if(scaling.mode==='cantrip')steps=(scaling.thresholds||[5,11,17]).filter(level=>numeric(d.level)>=level).length;
    else if(scaling.mode==='slot')steps=Math.floor(Math.max(0,integer(slotLevel,integer(data.level))-integer(data.level))/Math.max(1,integer(scaling.interval,1)));
    if(steps){for(const die of scaling.dice||[])terms.push(...profilePart({dice:[{...die,number:die.number*steps}]}));if(numeric(scaling.constant))terms.push(String(numeric(scaling.constant)*steps));}
  }
  let formula=terms.join(' + ')||'0';if(critical&&profile.kind==='damage'&&profile.critical!==false)formula=criticalFormula(formula);return safeFormula(formula);
}
export function spellCast(d,item,{slotLevel,ritual=false,free=false,pool='slots',turnKey,actionType,castMode='normal',commit=true,edition=d.rulesEdition||'2014'}={}) {
  ensureBars(d);const data=item?.data||{},level=integer(data.level,-1);
  actionType??=data.actionType||'action';
  if(!['action','bonus','reaction','long'].includes(actionType))throw new RuleError('spell_cast_restricted');
  if(!Number.isInteger(Number(data.level))||level<0||level>9||slotLevel!==undefined&&!Number.isInteger(slotLevel))throw new RuleError('spell_unknown_level');
  if(incapacitated(d)||armorState(d,edition).untrained)throw new RuleError('incapacitated');
  if(ritual&&(!data.ritual||level===0))throw new RuleError('spell_ritual_unavailable');
  const innate=castMode==='innate';
  if(!['normal','innate'].includes(castMode)||innate&&(ritual||!data.uses||typeof data.uses!=='object'||positive(data.uses.max)<1||positive(data.uses.value)<1))throw new RuleError('resource_unavailable');
  const consumes=level>0&&!ritual&&!free&&!innate,castLevel=integer(slotLevel,pool==='pact'&&consumes?integer(d.pactSlots?.level,level):level);if(castLevel<level||castLevel>9)throw new RuleError('spell_unknown_level');
  if(ritual&&castLevel!==level)throw new RuleError('spell_ritual_unavailable');
  if(innate&&castLevel!==level)throw new RuleError('spell_unknown_level');
  const slot=pool==='pact'?d.pactSlots:d.slots?.[`l${castLevel}`];if(consumes&&(!['slots','spell','pact'].includes(pool)||!slot||positive(slot.value)<1||pool==='pact'&&integer(slot.level)!==castLevel))throw new RuleError('spell_slot_unavailable');
  const previous=turnKey&&d.casting?.turnKey===turnKey?(d.casting.spells||[]):[];
  if(turnKey&&edition==='2024'&&consumes&&previous.some(spell=>spell.slotUsed))throw new RuleError('spell_cast_restricted');
  if(turnKey&&edition==='2014'&&(previous.some(spell=>spell.actionType==='bonus')&&!(level===0&&actionType==='action')||actionType==='bonus'&&previous.some(spell=>spell.level!==0||spell.actionType!=='action')))throw new RuleError('spell_cast_restricted');
  if(data.concentration&&(typeof item.id!=='string'||!item.id))throw new RuleError('invalid_source');
  if(!commit)return d;
  if(consumes)slot.value=positive(slot.value)-1;
  if(innate)consumeItem(item);
  if(turnKey)d.casting={turnKey,spells:[...previous,{level,actionType,slotUsed:consumes}].slice(-24)};
  if(data.concentration)startConcentration(d,item.id);return d;
}
export function rollFormula(action,d,options={}) {
  const {item,mode='normal',extraModifier=0,extraDice='',edition=d.rulesEdition||'2014',critical=false,slotLevel,twoHanded=false}=options;
  let formula = action.formula;
  if(action.id?.startsWith('roll.skill.')&&Object.hasOwn(SKILLS,action.id.slice(11)))formula=`1d20 + ${skillModifier(d,action.id.slice(11),options.skillAbility)}`;
  else if(action.id==='weapon.attack')formula=`1d20 + ${weaponBonuses(d,item,options).attackBonus}`;
  else if(action.id==='spell.attack')formula=`1d20 + ${numeric(d.prof)+(ABILITIES.includes(item?.data?.spell_ability)?get(d,`abilities.${item.data.spell_ability}.mod`,0):numeric(d.spell?.mod))}`;
  else if(action.id?.startsWith('spell.')&&/damage|healing|temporary/.test(action.id))formula=spellFormula(d,item,{slotLevel});
  else if(/^feature\.(damage|healing|temporary)$/.test(action.id)){
    const scale=action.id==='feature.damage'&&item?.data?.breathWeapon?.scale;
    if(scale){
      const tier=Object.keys(scale).map(Number).filter(level=>Number.isInteger(level)&&level>=0&&level<=numeric(d.level)).sort((a,b)=>b-a)[0],die=scale[tier];
      formula=safeFormula(profilePart({dice:die?[die]:[]}).join(' + ')||'');
    }else formula=spellProfile(item?.data)?spellFormula(d,item,{slotLevel}):safeFormula(action.id==='feature.healing'?item?.data?.healingFormula||item?.data?.damage||'':item?.data?.damage||'');
  }
  else if (formula === '@item.data.damage') {
    formula = String(twoHanded&&item?.data?.versatile?item.data.versatile:item?.data?.damage??'');
    if (!formula || formula.length > 120 || /[@{}\[\];]/.test(formula)) throw Error('Invalid damage formula');
  } else formula = formula.replace(/@(sheet|item)\.([a-zA-Z0-9_.]+)/g,(_,scope,path) => String(numeric(get(scope === 'sheet' ? d : item,path,0))));
  if(action.id==='weapon.damage') {
    const extra=weaponBonuses(d,item,options).damageBonus;
    if(extra)formula+=` + (${extra})`;
  }
  const d20 = /\b1d20\b/.test(formula);
  const category=actionCategory(action),active=modifiers(d,[category,action.id]);
  const context=rollContext(d,action,{...options,mode,edition}),{advantage,disadvantage}=context;
  if(category==='roll.attack'&&context.incapacitated)throw new RuleError('incapacitated');
  if (d20 && advantage !== disadvantage) formula = formula.replace('1d20',advantage ? '2d20kh1' : '2d20kl1');
  // Initiative already includes the edition-specific exhaustion penalty.
  const exhaustion = d20 && edition === '2024' && action.id !== 'roll.initiative' ? numeric(d.exhaustion)*2 : 0;
  const extra = numeric(extraModifier)-exhaustion;
  if (extra) formula += ` + (${extra})`;
  for(const change of active) {
    if(change.operation==='add')formula+=` + (${numeric(change.value)})`;
    if(change.operation==='subtract')formula+=` - (${numeric(change.value)})`;
    if(change.operation==='add_dice') {
      const dice=String(change.value).trim();
      if(!/^\d{1,2}d\d{1,3}$/i.test(dice))throw Error('Invalid modifier dice');
      formula+=' + '+dice;
    }
  }
  if (extraDice.trim()) {
    if (!/^\s*\d{1,2}d\d{1,3}(?:\s*[, +]\s*\d{1,2}d\d{1,3})*\s*$/i.test(extraDice)) throw Error('Invalid extra dice');
    formula += ' + ' + extraDice.trim().split(/\s*[, +]\s*/).join(' + ');
  }
  const profile=spellProfile(item?.data);
  if(critical&&category==='roll.damage'&&!/healing|temporary/.test(action.id||'')&&!(action.id==='feature.damage'&&item?.data?.breathWeapon)&&(!profile||profile.kind==='damage'&&profile.critical!==false))formula=criticalFormula(formula);
  return formula;
}
