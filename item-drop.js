const ITEM='application/x-gravewright-item',COMPENDIUM='application/x-gravewright-compendium';
const EDITIONS=new Set(['2014','2024']);

// Resolve ownership from every declared collection, independently of the drop location.
export function itemDestination(layout,item,{edition,role,canEdit}){
  const sourceEdition=item?.data?.rulesEdition;
  // Both supported editions share item collections. Keep the item's original rules
  // in its owned copy; the character's edition only controls character calculations.
  if(!canEdit||typeof item?.type!=='string'||!EDITIONS.has(edition)||(sourceEdition!=null&&sourceEdition!==''&&!EDITIONS.has(sourceEdition)))return null;
  const destinations=[];
  const visit=(node,tab)=>{
    if(node.type==='itemList'&&node.path&&node.dropZone?.accepts?.some(type=>type.replace(/^item\./,'')===item.type)){
      if(node.path!=='sheet.effects'||role==='gm')destinations.push({path:node.path,tab});
    }
    for(const child of node.children||[])visit(child,tab);
  };
  const tabs=layout.body.tabs||[];
  for(const tab of tabs)visit(tab,tab.id);
  const target=destinations[0];if(!target)return null;
  const preferred={'sheet.weapons':'inventory','sheet.inventory':'inventory','sheet.spells':'spells','sheet.features':'bio','sheet.effects':'effects'}[target.path];
  return {...target,tab:tabs.some(tab=>tab.id===preferred)?preferred:target.tab};
}

const ARMOR_COLLECTIONS=['inventory','equipment'];
const EQUIP_COLLECTIONS=new Set([...ARMOR_COLLECTIONS,'weapons','attacks']);
const armorSlot=item=>item?.type==='armor'?(item.data?.armor_type==='shield'?'shield':'armor'):null;
const equippedArmor=(draft,slot)=>ARMOR_COLLECTIONS.some(path=>Array.isArray(draft?.[path])&&draft[path].some(item=>item?.equipped===true&&armorSlot(item)===slot));

// Return independent lists for the sheet's save queue; equipment slots cross collections.
export function equippedItems(draft,path,id,value){
  const collection=typeof path==='string'?path.replace(/^sheet\./,''):'';
  if(!EQUIP_COLLECTIONS.has(collection)||!Array.isArray(draft?.[collection]))return {};
  const index=draft[collection].findIndex(item=>item?.id===id);if(index<0)return {};
  const enabled=value===true,slot=ARMOR_COLLECTIONS.includes(collection)?armorSlot(draft[collection][index]):null;
  const updates={};
  for(const key of new Set([collection,...(enabled&&slot?ARMOR_COLLECTIONS:[])])){
    const list=draft[key];if(!Array.isArray(list))continue;
    let changed=false;
    const next=list.map((item,itemIndex)=>{
      const target=key===collection&&itemIndex===index;
      const unequip=enabled&&slot&&!target&&item?.equipped===true&&armorSlot(item)===slot;
      if(!target&&!unequip)return item;
      const equipped=target?enabled:false;if(item.equipped===equipped)return item;
      changed=true;return {...item,equipped};
    });
    if(changed)updates[`sheet.${key}`]=structuredClone(next);
  }
  return updates;
}

export function ownedItem(item,draft){
  const quantity=Number(item.data?.quantity);
  const slot=armorSlot(item),equipped=!!draft&&!!slot&&!equippedArmor(draft,slot);
  return {id:crypto.randomUUID(),source:item.id,name:item.name,type:item.type,data:structuredClone(item.data),quantity:Number.isFinite(quantity)?Math.max(1,Math.min(1000000,quantity)):1,equipped,attuned:false,prepared:false,enabled:true};
}

export function attunedItems(draft,path,id,value){
  const collection=String(path).replace(/^sheet\./,''),keys=['inventory','weapons','equipment','attacks'];
  if(!keys.includes(collection)||!Array.isArray(draft?.[collection]))return {};
  const entry=draft[collection].find(item=>item.id===id);if(!entry||entry.data?.requiresAttunement!==true)return {};
  if(value===true&&entry.attuned!==true&&keys.flatMap(key=>Array.isArray(draft[key])?draft[key]:[]).filter(item=>item.attuned===true&&item.data?.requiresAttunement===true).length>=3)throw Object.assign(Error('attunementLimit'),{code:'attunementLimit'});
  return {[`sheet.${collection}`]:structuredClone(draft[collection].map(item=>item.id===id?{...item,attuned:value===true}:item))};
}

export function acceptsItemDrop(transfer,context){
  return !!transfer&&(transfer.types.includes(ITEM)||(context.role==='gm'&&transfer.types.includes(COMPENDIUM)));
}

// Sheet copies come from live authorized reads; a drop never creates a library item.
export async function droppedItem(transfer,{api,context,accepts,t}){
  const fail=()=>{throw Object.assign(Error(t('itemDropUnsupported')),{code:'unsupported_item'});};
  if(transfer.types.includes(ITEM)){
    const ref=JSON.parse(transfer.getData(ITEM));
    if(ref.tableId!==context.tableId||typeof ref.id!=='string')fail();
    const item=await api.items.get(ref.id);if(!item.canOpen||!accepts(item))fail();return item;
  }
  if(context.role!=='gm'||!transfer.types.includes(COMPENDIUM))fail();
  const ref=JSON.parse(transfer.getData(COMPENDIUM));
  if(ref.campaign!==context.tableId||ref.kind!=='item'||typeof ref.id!=='string'||typeof ref.packId!=='string')fail();
  const raw=await api.compendiums.read({packId:ref.packId,id:ref.id});
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||(raw.kind!==undefined&&raw.kind!=='item'))fail();
  const document=raw.type?raw:raw.data;
  if(!document||typeof document.type!=='string'||typeof document.name!=='string'||!document.name.trim()||!document.data||typeof document.data!=='object'||Array.isArray(document.data))fail();
  const item={...structuredClone(document),id:typeof raw.id==='string'&&raw.id?raw.id:ref.id,canOpen:true,canEdit:false};
  if(!accepts(item))fail();
  return item;
}
