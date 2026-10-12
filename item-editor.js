import {get,numeric} from './rules.js';
import {icon} from './icons.js';

const el=(doc,tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const typeKeys={weapon:'dnd5e.ui.arma',armor:'dnd5e.ui.armadura',equipment:'dnd5e.ui.equipamento',consumable:'dnd5e.ui.consumivel',spell:'dnd5e.ui.magia',feat:'dnd5e.ui.talento',feature:'dnd5e.ui.caracteristica',race:'dnd5e.ui.raca',background:'dnd5e.ui.antecedente',class:'dnd5e.ui.classe',effect:'dnd5e.ui.efeito'};
const glyphs={weapon:'swords',armor:'shield',equipment:'backpack',consumable:'flask',spell:'book',feat:'star',feature:'leaf',race:'token',background:'scroll',class:'shield',effect:'sun'};

// One editor for library documents and copies embedded in an actor's sheet.
export function itemEditor(env){
  const {doc,t,layout,type,field,button,changed:write,modifiers,resource}=env;
  const changed=(path,value)=>{if(type==='weapon'&&path==='sheet.proficient')write('sheet.proficiencyMode','manual');write(path,value);};
  const root=el(doc,'section','gw5-item-editor');root.dataset.itemType=type;
  const all=[];function collect(node){if(node.path||node.type==='resourceField')all.push(node.path==='sheet.attack_type'?{...node,labelKey:'weaponAttackType'}:node);else for(const child of node.children||[])collect(child);}collect(layout.body);
  if(type==='weapon')all.push({type:'selectField',path:'sheet.attack_ability',labelKey:'weaponAbility',options:[{value:'none',labelKey:'weaponAbilityManual'},{value:'auto',labelKey:'weaponAbilityAuto'},...['str','dex','con','int','wis','cha'].map(value=>({value,labelKey:{str:'dnd5e.ui.forca',dex:'dnd5e.ui.destreza',con:'dnd5e.ui.constituicao',int:'dnd5e.ui.inteligencia',wis:'dnd5e.ui.sabedoria',cha:'dnd5e.ui.carisma'}[value]}))]},{type:'checkboxField',path:'sheet.proficient',labelKey:'weaponProficient'});
  if(type==='spell')all.push({type:'textField',path:'sheet.healingFormula',labelKey:'healingFormula'},{type:'selectField',path:'sheet.spell_ability',labelKey:'spellAbility',options:[{value:'default',labelKey:'defaultSpellAbility'},...['str','dex','con','int','wis','cha'].map(value=>({value,labelKey:{str:'dnd5e.ui.forca',dex:'dnd5e.ui.destreza',con:'dnd5e.ui.constituicao',int:'dnd5e.ui.inteligencia',wis:'dnd5e.ui.sabedoria',cha:'dnd5e.ui.carisma'}[value]}))]});
  if(type==='effect')all.push({type:'selectField',path:'sheet.duration.expires',labelKey:'expiryTiming',options:[{value:'',labelKey:'expiryManual'},{value:'start',labelKey:'expiryStart'},{value:'end',labelKey:'expiryEnd'}]});
  if(['weapon','armor','equipment','consumable'].includes(type))all.push({type:'checkboxField',path:'sheet.requiresAttunement',labelKey:'requiresAttunement'},{type:'numberField',path:'sheet.magicBonus',labelKey:'magicBonus'});
  const definitions=new Map(all.filter(node=>node.path).map(node=>[node.path,node]));
  const caption=type==='race'&&env.edition()==='2024'?t('species'):t(typeKeys[type]||'items');
  const hero=el(doc,'header','gw5-item-hero'),glyph=el(doc,'div','gw5-item-emblem');glyph.append(icon(doc,glyphs[type]||'star'));
  const identity=el(doc,'div','gw5-item-identity-block'),eyebrow=el(doc,'span','gw5-item-kind',caption),name=field({type:'textField',path:'core.name',labelKey:'name'},env.data(),changed);name.classList.add('gw5-item-name-field');name.querySelector('input').value=env.name();
  const summary=el(doc,'p','gw5-item-summary');identity.append(eyebrow,name,summary);
  const edition=field({type:'selectField',path:'sheet.rulesEdition',labelKey:'documentEdition',options:[{value:'2014',labelKey:'edition2014'},{value:'2024',labelKey:'edition2024'}]},env.data(),changed);edition.classList.add('gw5-item-edition');edition.querySelector('select').value=env.edition();hero.append(glyph,identity,edition);root.append(hero);
  const facts=el(doc,'dl','gw5-item-facts');root.append(facts);
  const values=type==='weapon'?[['sheet.damage','damage'],['sheet.range','range'],['sheet.weight','weight'],['sheet.cost','dnd5e.ui.custo']]:type==='armor'?[['sheet.base_ac','armorClass'],['sheet.str_req','dnd5e.ui.forca.minima'],['sheet.weight','weight'],['sheet.cost','dnd5e.ui.custo']]:type==='spell'?[['sheet.level','spellLevel'],['sheet.casting_time','castingTime'],['sheet.range','range'],['sheet.duration','duration']]:type==='effect'?[['sheet.category','dnd5e.ui.categoria'],['sheet.duration','duration']]:type==='class'?[['sheet.hit_die','dnd5e.ui.dado.de.vida'],['sheet.primary_ability','dnd5e.ui.atributo.primario']]:type==='race'?[['sheet.size','size'],['sheet.speed','speed']]:type==='feat'?[['sheet.prerequisite','dnd5e.ui.pre.requisito']]:type==='background'?[['sheet.feature_name','dnd5e.ui.caracteristica.de.antecedente']]:type==='feature'?[['sheet.source','dnd5e.ui.origem.classe.raca.etc'],['sheet.level','level']]:[['sheet.quantity','quantity'],['sheet.weight','weight'],['sheet.cost','dnd5e.ui.custo']];
  const outputs=[];
  for(const [path,label] of values){const fact=el(doc,'div'),out=el(doc,'dd');fact.append(el(doc,'dt','',t(label)),out);facts.append(fact);outputs.push({path,out});}
  const nav=el(doc,'nav','gw5-item-tabs');nav.setAttribute('aria-label',t('itemSections'));nav.setAttribute('role','tablist');
  const body=el(doc,'div','gw5-item-body'),panels=new Map(),tabs=new Map();
  const modifier=all.find(node=>node.type==='modifierBuilder');
  const available=[['description','dnd5e.ui.descricao'],['details','itemDetails'],...(modifier?[['modifiers','dnd5e.ui.modificadores']]:[])];
  let active=env.state?.tab||'description';if(!available.some(([id])=>id===active))active='description';
  for(const [id,label] of available){const panel=el(doc,'div',`gw5-item-panel gw5-item-panel--${id}`),b=button(t(label),()=>activate(id));b.dataset.gw5ItemTab=id;b.setAttribute('role','tab');b.id='gw5-item-tab-'+crypto.randomUUID();panel.id=b.id+'-panel';b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);panels.set(id,panel);tabs.set(id,b);nav.append(b);body.append(panel);}
  function activate(id){active=id;if(env.state)env.state.tab=id;for(const [key,panel]of panels){panel.hidden=key!==id;const tab=tabs.get(key);tab.setAttribute('aria-selected',String(key===id));tab.tabIndex=key===id?0:-1;}}
  nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=[...tabs.keys()],index=event.key==='Home'?0:event.key==='End'?keys.length-1:(keys.indexOf(active)+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;activate(keys[index]);tabs.get(keys[index]).focus();});
  root.append(nav,body);
  const description=panels.get('description'),descriptionGrid=el(doc,'div','gw5-item-description-grid'),narrative=el(doc,'div','gw5-item-narrative'),aside=el(doc,'aside','gw5-item-reading-notes');descriptionGrid.append(narrative,aside);description.append(descriptionGrid);
  const descriptionNodes=all.filter(node=>node.type==='textArea'&&!['sheet.materials','sheet.equipment'].includes(node.path));
  if(!descriptionNodes.some(node=>node.path==='sheet.description'))descriptionNodes.unshift({type:'textArea',path:'sheet.description',labelKey:'dnd5e.ui.descricao'});
  for(const node of descriptionNodes){const f=field(node,env.data(),changed);f.classList.add('gw5-item-text');f.querySelector('textarea').rows=node.path==='sheet.description'?8:4;f.querySelector('textarea').placeholder=t('itemDescriptionPlaceholder');narrative.append(f);}
  const readingTitle=el(doc,'h3','',t('itemAtAGlance')),reading=el(doc,'dl','gw5-item-reading-facts');aside.append(readingTitle,reading);
  const readPaths={weapon:['sheet.category','sheet.attack_type','sheet.damage_type','sheet.versatile'],armor:['sheet.armor_type','sheet.max_dex','sheet.add_dex'],spell:['sheet.school','sheet.resolution','sheet.classes','sheet.materials'],equipment:['sheet.category'],consumable:['sheet.subtype','sheet.uses'],feat:['sheet.prerequisite'],feature:['sheet.recharge'],race:['sheet.languages','sheet.asi'],background:['sheet.skill_proficiencies','sheet.tool_proficiencies','sheet.languages'],class:['sheet.saving_throws','sheet.spellcasting_ability'],effect:['sheet.concentration']}[type]||[];
  const tags=el(doc,'div','gw5-item-tags');aside.append(tags);const help=el(doc,'p','gw5-item-drag-hint',t('itemCopyHelp'));aside.append(help);
  const details=panels.get('details'),detailGrid=el(doc,'div','gw5-item-detail-grid');details.append(detailGrid);
  const used=new Set(['core.name','sheet.description',...descriptionNodes.map(node=>node.path),...(modifier?[modifier.path]:[])]);
  function group(label,paths,cls=''){
    const nodes=paths.map(path=>typeof path==='string'?definitions.get(path):path).filter(node=>node&&!used.has(node.path||node.valuePath));if(!nodes.length)return;
    const box=el(doc,'section',`gw5-item-group-box ${cls}`),heading=el(doc,'h3','',t(label)),fields=el(doc,'div','gw5-item-field-grid');box.append(heading,fields);detailGrid.append(box);
    for(const node of nodes){used.add(node.path||node.valuePath);const rendered=node.type==='resourceField'?resource(node):field(node,env.data(),changed);if(node.type==='textArea'||node.type==='resourceField')rendered.classList.add('gw5-item-field-wide');fields.append(rendered);}return box;
  }
  const groups={
    weapon:[['itemCombat',['sheet.category','sheet.attack_type','sheet.damage','sheet.damage_type','sheet.versatile','sheet.range','sheet.attack_ability','sheet.proficient','sheet.attack_bonus','sheet.damage_bonus']],['dnd5e.ui.propriedades',all.filter(node=>node.path?.startsWith('sheet.props.')),'gw5-item-properties'],['itemPhysical',['sheet.weight','sheet.cost']]],
    armor:[['itemDefense',['sheet.armor_type','sheet.base_ac','sheet.add_dex','sheet.max_dex','sheet.str_req','sheet.stealth_disadvantage']],['itemPhysical',['sheet.weight','sheet.cost']]],
    equipment:[['itemPhysical',['sheet.category','sheet.quantity','sheet.weight','sheet.cost']]],
    consumable:[['itemConsumable',['sheet.subtype','sheet.quantity','sheet.uses','sheet.weight','sheet.cost']]],
    spell:[['dnd5e.ui.conjuracao',['sheet.level','sheet.school','sheet.casting_time','sheet.range','sheet.duration','sheet.classes']],['itemSpellResolution',['sheet.resolution','sheet.damage','sheet.concentration','sheet.ritual']],['dnd5e.ui.componentes',['sheet.components.v','sheet.components.s','sheet.components.m','sheet.materials'],'gw5-item-properties']],
    effect:[['itemEffectSetup',['sheet.category','sheet.duration.type','sheet.duration.value','sheet.concentration']]],
    feat:[['itemRequirements',['sheet.prerequisite']]],
    feature:[['itemFeatureSetup',['sheet.source','sheet.level',...all.filter(node=>node.type==='resourceField'),'sheet.recharge']]],
    race:[['itemAncestry',['sheet.subrace','sheet.size','sheet.speed','sheet.languages','sheet.asi','sheet.age_alignment']]],
    background:[['itemTraining',['sheet.skill_proficiencies','sheet.tool_proficiencies','sheet.languages','sheet.equipment','sheet.feature_name']]],
    class:[['itemClassSetup',['sheet.hit_die','sheet.primary_ability','sheet.saving_throws','sheet.spellcasting_ability']],['itemTraining',['sheet.armor_proficiencies','sheet.weapon_proficiencies','sheet.tool_proficiencies','sheet.skills']]],
  };
  for(const [label,paths,cls]of groups[type]||[]){const box=group(label,paths,cls);if(box&&type==='weapon'&&label==='itemCombat')box.append(el(doc,'p','gw5-item-modifier-help',t('weaponRollHelp')));}
  group('itemOtherDetails',all.filter(node=>!used.has(node.path||node.valuePath)&&node.type!=='modifierBuilder'));
  if(!detailGrid.childElementCount)detailGrid.append(el(doc,'p','gw5-empty',t('itemNoExtraDetails')));
  if(modifier){const box=el(doc,'section','gw5-item-group-box');box.append(el(doc,'h3','',t('dnd5e.ui.modificadores')),el(doc,'p','gw5-item-modifier-help',t('itemModifierHelp')),modifiers(modifier,env.data,changed));panels.get('modifiers').append(box);}
  function valueLabel(path){const value=get(env.data(),path,'');const choice=definitions.get(path)?.options?.find(option=>option.value===value);if(choice)return t(choice.labelKey||choice.label);if(typeof value==='boolean')return value?t('yes'):t('no');if(path==='sheet.uses'&&value&&typeof value==='object')return t('usesValue',{value:numeric(value.value),max:numeric(value.max)});if(path==='sheet.duration'&&value&&typeof value==='object')return value.type==='permanent'?t('permanent'):`${numeric(value.value)} ${t({rounds:'rounds',minutes:'minutes',session:'session'}[value.type]||'rounds')}`;if(path==='sheet.level'&&type==='spell'&&numeric(value)===0)return t('cantrips');if(path==='sheet.weight')return `${numeric(value)} ${t('weightUnit')}`;return String(value||value===0?value:'—');}
  function refresh(){
    eyebrow.textContent=type==='race'&&env.edition()==='2024'?t('species'):t(typeKeys[type]||'items');
    for(const {path,out}of outputs)out.textContent=valueLabel(path);
    summary.textContent=(type==='weapon'?['sheet.category','sheet.attack_type','sheet.damage_type']:type==='spell'?['sheet.school','sheet.level']:type==='armor'?['sheet.armor_type']:type==='effect'?['sheet.category']:[]).map(valueLabel).filter(value=>value&&value!=='—').join(' · ');
    reading.replaceChildren();for(const path of readPaths){if(!definitions.has(path)||valueLabel(path)==='—')continue;const item=el(doc,'div');item.append(el(doc,'dt','',t(definitions.get(path).labelKey)),el(doc,'dd','',valueLabel(path)));reading.append(item);}
    tags.replaceChildren();for(const node of all.filter(node=>node.type==='checkboxField'&&get(env.data(),node.path,false)))tags.append(el(doc,'span','',t(node.labelKey)));
  }
  root.addEventListener('input',refresh);root.addEventListener('change',refresh);refresh();activate(active);return root;
}
