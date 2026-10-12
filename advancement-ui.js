import {planAdvancement} from './advancement.js';

const ABILITY_LABELS={str:'dnd5e.ui.forca',dex:'dnd5e.ui.destreza',con:'dnd5e.ui.constituicao',int:'dnd5e.ui.inteligencia',wis:'dnd5e.ui.sabedoria',cha:'dnd5e.ui.carisma'};
const SKILL_IDS=['acrobatics','animal_handling','arcana','athletics','deception','history','insight','intimidation','investigation','medicine','nature','perception','performance','persuasion','religion','sleight_of_hand','stealth','survival'];
const SIZE_IDS={tiny:'tiny',sm:'small',small:'small',med:'medium',medium:'medium',lg:'large',large:'large',huge:'huge',grg:'gargantuan',gargantuan:'gargantuan'};
const ARMOR_IDS={lgt:'light',light:'light',med:'medium',medium:'medium',hvy:'heavy',heavy:'heavy',shl:'shield',shield:'shield'};
const TOOL_IDS=new Set(['alchemist','brewer','calligrapher','carpenter','cartographer','cobbler','cook','glassblower','jeweler','leatherworker','mason','painter','potter','smith','tinker','weaver','woodcarver','disg','forg','herb','navg','pois','thief','bagpipes','drum','dulcimer','flute','lute','lyre','horn','panflute','shawm','viol','card','dice','dragonchess','threeDragonAnte']);
const LANGUAGE_IDS=new Set(['common','commonSign','dwarvish','elvish','giant','gnomish','goblin','halfling','orc','abyssal','celestial','draconic','deep','infernal','primordial','sylvan','undercommon','aquan','auran','ignan','terran','cant','druidic']);
const DAMAGE_IDS=new Set(['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder']);
const CONDITION_IDS=new Set(['blinded','charmed','deafened','diseased','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','exhaustion']);
const capitalized=value=>value[0].toUpperCase()+value.slice(1);
const GENERIC_TITLES={'ability score improvement':'abilityImprovement','background ability score improvement':'abilityImprovement','skill proficiencies':'skills','saving throw proficiencies':'saves','weapon proficiencies':'weapons','tool proficiencies':'tools','armor training':'armor','armor proficiencies':'armor','background proficiencies':'traits','choose languages':'languages','languages':'languages','size':'size','hit points':'hitPoints','weapon mastery':'weaponMastery','class features':'features','grant items':'items','starting equipment':'startingEquipment'};
function optionLabel(option,choice,t){
  const raw=String(option.id??option.value??''),parts=raw.split(':'),id=parts.at(-1),fallback=option.label||option.name||raw;
  if(choice.kind==='AbilityOrFeat'&&raw==='ability')return t('advancement.abilityImprovement');
  if(choice.kind==='OptionalItem'&&raw==='no')return t('advancement.skip');
  if(choice.kind==='StartingEquipment'&&raw==='equipment')return t('advancement.startingEquipment');
  if(choice.kind==='StartingEquipment'&&raw==='wealth'&&/^\d+(?:\.\d+)? (?:cp|sp|ep|gp|pp)$/.test(fallback)){const [amount,coin]=fallback.split(' ');return t('currencyAmount',{amount,coin:t({cp:'dnd5e.ui.pc',sp:'dnd5e.ui.pp',ep:'dnd5e.ui.pe',gp:'dnd5e.ui.po',pp:'dnd5e.ui.pl'}[coin])});}
  if(parts[0]==='skills'&&SKILL_IDS.includes(id))return t('advancement.skill.'+id);
  if((parts[0]==='saves'||choice.type==='ability'||choice.kind==='SpellAbility')&&Object.hasOwn(ABILITY_LABELS,id))return t('advancement.ability.'+id);
  if(choice.kind==='Size'||parts[0]==='size'){if(SIZE_IDS[id])return t('advancement.size.'+SIZE_IDS[id]);}
  if(parts[0]==='armor'&&ARMOR_IDS[id])return t('advancement.armor.'+ARMOR_IDS[id]);
  if(parts[0]==='weapon'&&['sim','simple','mar','martial'].includes(id))return t('advancement.weapon.'+(['sim','simple'].includes(id)?'simple':'martial'));
  if(parts[0]==='tool'&&TOOL_IDS.has(id))return t('advancement.tool.'+id);
  if(parts[0]==='languages'&&LANGUAGE_IDS.has(id))return t('advancement.language.'+id);
  if(['dr','di','dv'].includes(parts[0])&&DAMAGE_IDS.has(id))return t('damageType'+capitalized(id));
  if(parts[0]==='ci'&&CONDITION_IDS.has(id))return t(id==='exhaustion'?'exhaustion':'condition'+capitalized(id));
  if(choice.kind==='SpellList'&&['bard','cleric','druid','paladin','ranger','sorcerer','warlock','wizard'].includes(id))return t('advancement.class.'+id);
  return fallback;
}
function choiceTitle(choice,t){
  const original=choice.title||'',known=GENERIC_TITLES[original.trim().toLowerCase()];
  if(known)return t('advancement.'+known);
  let category={AbilityScoreImprovement:'abilityImprovement',AbilityOrFeat:'abilityOrFeat',Size:'size',HitPoints:'hitPoints',Subclass:'subclass',SpellList:'spellList',StartingEquipment:'startingEquipment'}[choice.kind];
  if(choice.kind==='Trait'){
    const kinds=new Set((choice.options||[]).map(option=>String(option.id??option.value??'').split(':')[0]));
    category=kinds.size===1?({skills:'skills',saves:'saves',armor:'armor',weapon:'weapons',tool:'tools',languages:'languages'}[[...kinds][0]]||'traits'):'traits';
  }
  const label=category?t('advancement.'+category):'';
  return original?(label&&original!==label?`${original} · ${label}`:original):label||t('advancementChoice');
}
const WARNING_LABELS={missingGrant:'warningMissing',missingStartingItem:'warningMissing',replacementOptional:'warningReplacement',manualStartingWealth:'warningWealth',unsupportedAdvancement:'warningManual',unsupportedTrait:'warningManual',unsupportedGrant:'warningManual',manualStartingEquipment:'warningStartingEquipment',multiclassUnarmoredDefense2014:'warningUnarmored2014'};
function warningLabels(warnings,catalog,item,t){
  const result=[],seen=new Set(),read=id=>catalog instanceof Map?catalog.get(id):catalog?.[id];
  const safeName=value=>typeof value==='string'&&value.length<240&&!/Compendium\.|@|[<>\[\]{}]|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(value)&&value!=='Unresolved benefit';
  for(const warning of warnings){
    const reference=warning.item||warning.id,found=read(reference),name=found?.name||(safeName(warning.name)?warning.name:safeName(warning.item)?warning.item:item.name);
    const message=t(WARNING_LABELS[warning.code]?'advancement.'+WARNING_LABELS[warning.code]:'advancementManualNotice'),key=name+'\n'+message;
    if(!seen.has(key)){seen.add(key);result.push({name,message});}
  }
  return result;
}
const el=(doc,tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};

// Choices are a private draft. Cancel never writes part of an origin to the actor.
export async function chooseAdvancement({doc,t,modal,draft,item,catalog,options={},planner=planAdvancement,signal}){
  let answers={},level=Number(options.classLevel||1),plan=planner(draft,item,catalog,answers,{...options,classLevel:level});
  const classLevels=item.type==='class'&&options.promptLevel!==false;
  if(!classLevels&&!plan.choices.length)return plan;
  if(signal?.aborted)return null;
  const window=modal(t(options.update?'advancementUpdateTitle':'advancementTitle',{name:item.name}));window.classList.add('gw5-advancement-modal');options.onOpen?.(window);
  const form=el(doc,'form','gw5-modal-body gw5-advancement-form');window.append(form);
  return new Promise(resolve=>{
    let resolved=false;
    const finish=value=>{if(resolved)return;resolved=true;resolve(value);};
    window.addEventListener('close',()=>finish(null),{once:true});
    function draw(){
      form.replaceChildren(el(doc,'p','gw5-advancement-intro',t('advancementIntro')));
      if(classLevels){
        const label=el(doc,'label','gw5-field',t('classLevel')),input=el(doc,'input');input.type='number';input.min='1';input.max='20';input.step='1';input.value=String(level);input.name='classLevel';label.append(input);form.append(label);
        input.onchange=()=>{if(!input.validity.valid)return;try{const next=Number(input.value),updated=planner(draft,item,catalog,{}, {...options,classLevel:next});level=next;answers={};plan=updated;draw();}catch(error){input.value=String(level);notice.textContent=t('advancementError');}};
      }
      const collect=[];
      for(const choice of plan.choices){
        const fieldset=el(doc,'fieldset','gw5-advancement-choice');fieldset.dataset.choiceId=choice.id;fieldset.dataset.choiceKind=choice.kind||choice.type;
        const title=choiceTitle(choice,t);fieldset.append(el(doc,'legend','',title));
        const current=answers[choice.id]??choice.current;
        if(choice.type==='ability'||choice.type==='asi'){
          fieldset.append(el(doc,'p','gw5-advancement-hint',t('advancementPoints',{count:choice.points??choice.count??0})));
          const grid=el(doc,'div','gw5-advancement-abilities'),inputs=[];
          for(const ability of choice.abilities||Object.keys(ABILITY_LABELS).map(id=>({id,max:choice.cap||2}))){
            const id=ability.id||ability.value,text=t('advancement.ability.'+id),label=el(doc,'label','gw5-field',text),input=el(doc,'input');input.type='number';input.min='0';input.max=String(ability.max??choice.cap??2);input.step='1';input.value=String(current?.[id]||0);input.dataset.ability=id;input.setAttribute('aria-label',text);label.append(input);grid.append(label);inputs.push(input);
          }
          fieldset.append(grid);collect.push(()=>[choice.id,Object.fromEntries(inputs.map(input=>[input.dataset.ability,Number(input.value)]))]);
        }else if(choice.type==='number'){
          const label=el(doc,'label','gw5-field',t('advancementValue')),input=el(doc,'input');input.type='number';input.step='1';input.min=String(choice.min??0);input.max=String(choice.max??1000000);input.value=current==null?'':String(current);input.required=true;input.setAttribute('aria-label',title||t('advancementValue'));label.append(input);fieldset.append(label);
          if(choice.kind==='HitPoints'&&choice.max){const average=el(doc,'button','gw5-button',t('takeAverage'));average.type='button';average.onclick=()=>input.value=String(Math.floor(Number(choice.max)/2)+1);fieldset.append(average);}
          collect.push(()=>[choice.id,Number(input.value)]);
        }else if(choice.type==='select'){
          const label=el(doc,'label','gw5-field',t('advancementChoice')),select=el(doc,'select');select.required=true;select.setAttribute('aria-label',title||t('advancementChoice'));
          const placeholder=el(doc,'option','',t('chooseOption'));placeholder.value='';select.append(placeholder);
          for(const option of choice.options||[]){const entry=el(doc,'option','',optionLabel(option,choice,t));entry.value=String(option.id??option.value);select.append(entry);}select.value=String(Array.isArray(current)?current[0]||'':current||'');label.append(select);fieldset.append(label);collect.push(()=>[choice.id,select.value]);
        }else{
          fieldset.append(el(doc,'p','gw5-advancement-hint',t('advancementSelectCount',{count:choice.count})));
          const list=el(doc,'div','gw5-advancement-options'),inputs=[];
          for(const option of choice.options||[]){const label=el(doc,'label','gw5-checkbox'),input=el(doc,'input');input.type='checkbox';input.value=String(option.id??option.value);input.checked=Array.isArray(current)&&current.includes(input.value);label.append(input,el(doc,'span','',optionLabel(option,choice,t)));list.append(label);inputs.push(input);}
          fieldset.append(list);collect.push(()=>[choice.id,inputs.filter(input=>input.checked).map(input=>input.value)]);
        }
        if(choice.error)fieldset.append(el(doc,'p','gw5-notice',t('advancementInvalidChoice')));
        form.append(fieldset);
      }
      if(plan.warnings?.length){
        const warnings=el(doc,'div','gw5-advancement-warnings'),list=el(doc,'ul');warnings.append(el(doc,'strong','',t('advancementManual')));
        for(const warning of warningLabels(plan.warnings,catalog,item,t)){const row=el(doc,'li');row.append(el(doc,'strong','',warning.name),doc.createTextNode(' — '+warning.message));list.append(row);}
        warnings.append(list);form.append(warnings);
      }
      const notice=el(doc,'p','gw5-notice');notice.role='alert';form.append(notice);
      const footer=el(doc,'footer','gw5-row'),cancel=el(doc,'button','gw5-button',t('cancel')),apply=el(doc,'button','gw5-button',t('applyAdvancement'));cancel.type='button';cancel.onclick=()=>window.close();apply.type='submit';footer.append(cancel,apply);form.append(footer);
      form.onsubmit=event=>{
        event.preventDefault();if(!form.reportValidity())return;
        Object.assign(answers,Object.fromEntries(collect.map(read=>read())));
        try{plan=planner(draft,item,catalog,answers,{...options,classLevel:level});if(plan.choices.length){draw();form.querySelector('.gw5-advancement-choice')?.scrollIntoView({block:'nearest'});return;}finish(plan);window.close();}
        catch(error){notice.textContent=t(error.code==='invalid_advancement_choice'?'advancementInvalidChoice':'advancementError');}
      };
    }
    draw();
  });
}
