"""Build traceable SRD item collections from pinned, licensed source data.

Development dependencies: PyYAML 6.0.3 and PyMuPDF 1.27.2.2. Run fetch_srd.py
first, then provide the official PDF files named 2014.pdf and 2024.pdf in the
same cache. Dependencies and source PDFs are not distributed in the system ZIP.
"""
from collections import Counter, defaultdict
from hashlib import sha1, sha256
from html.parser import HTMLParser
import html
import json
from pathlib import Path
import re
import sys
import unicodedata
import uuid
from dev_paths import srd_cache, srd_tools

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else srd_cache()
TOOLS = srd_tools()
if TOOLS.is_dir():
    sys.path.insert(0, str(TOOLS))
try:
    import yaml
    import pymupdf
except ImportError as error:
    raise SystemExit('The optional SRD converter needs PyYAML==6.0.3 and PyMuPDF==1.27.2.2. Install them in your development environment, or set GRAVEWRIGHT_SRD_TOOLS to a pip --target directory.') from error
sys.path.insert(0, str(Path(__file__).resolve().parent))
from advancement_data import normalize_catalog

COMMIT = '87e94dbd9f930135e0694cd7e7d49f210603cd2c'
SYSTEM = 'gravewright.5e-srd'
PACKS = {
    '2014': {'spells', 'items', 'classes', 'subclasses', 'classfeatures', 'backgrounds', 'races'},
    '2024': {'spells24', 'equipment24', 'classes24', 'origins24', 'feats24'},
}
PDF_URLS = {
    '2014': 'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf',
    '2024': 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf',
}
PDF_HASHES = {'2014':'2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0', '2024':'8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87'}
SCHOOLS = {'abj':'abjuration', 'con':'conjuration', 'div':'divination', 'enc':'enchantment', 'evo':'evocation', 'ill':'illusion', 'nec':'necromancy', 'trs':'transmutation'}
GROUP_LABELS = {'weapon':'Weapons', 'armor':'Armor and Shields', 'equipment':'Equipment and Tools', 'consumable':'Consumables', 'spell':'Spells', 'feat':'Feats', 'feature':'Features and Subclasses', 'race':'Species and Races', 'background':'Backgrounds', 'class':'Classes'}

def norm(value):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', value).casefold())

def number(value, fallback=0):
    try:
        value = float(value)
        return int(value) if value.is_integer() else value
    except (ValueError, TypeError):
        return fallback

def load(path):
    return yaml.load(path.read_text(encoding='utf-8'), Loader=yaml.CSafeLoader)

def read_pdf(edition, spell_names):
    """Extract official spell text in reading order, using actual title typography.

    PDF text, rather than Foundry lookup macros, is authoritative for spell prose.
    It also acts as a conservative name allowlist for the other licensed entries.
    """
    path = CACHE / f'{edition}.pdf'
    if sha256(path.read_bytes()).hexdigest() != PDF_HASHES[edition]:
        raise ValueError('Official PDF digest mismatch: ' + edition)
    spells, full, current, lines, start_page = {}, [], None, [], None
    def finish():
        if current is not None:
            text = '\n'.join(lines).strip()
            text = re.sub(r'([a-z])-\n([a-z])', r'\1\2', text)
            text = text.replace('\u00ad', '').replace('\u2010\u2011', '-').replace('\u2010', '-').replace('\u2011', '-')
            spells[current] = {'description': text, 'page': start_page}
    with pymupdf.open(path) as document:
        for page in document:
            width, height = page.rect.width, page.rect.height
            for side in (0, 1):
                clip = pymupdf.Rect(side * width / 2, 30, (side + 1) * width / 2, height - 45)
                full.append(page.get_text(clip=clip, sort=True))
                if not (113 <= page.number <= 193 if edition == '2014' else 106 <= page.number <= 174):
                    continue
                rows = []
                for block in page.get_text('dict', clip=clip)['blocks']:
                    for line in block.get('lines', []):
                        text = ' '.join(''.join(span['text'] for span in line['spans']).split())
                        if text:
                            rows.append((line['bbox'][1], line['bbox'][0], text, line['spans']))
                for _, _, text, spans in sorted(rows):
                    key = norm(text)
                    is_title = any('GillSans-SemiBold' in span['font'] and abs(span['size'] - 12) < .2 for span in spans)
                    if is_title:
                        finish()
                        current = key if key in spell_names else None
                        lines, start_page = [], page.number + 1
                    elif current is not None:
                        lines.append(text)
        finish()
    return norm('\n'.join(full)), spells, {'url':PDF_URLS[edition], 'sha256':sha256(path.read_bytes()).hexdigest()}


def read_spell_lists(edition, spell_names, official_spells):
    """Use the licensed PDF lists, not a guessed universal spell pool."""
    classes = {'bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'}
    result = defaultdict(set)
    if edition == '2024':
        for name, spell in official_spells.items():
            header = re.search(r'\(([A-Za-z,\s]+)\)', spell['description'][:220])
            if header:
                result[name].update(value.strip().lower() for value in header[1].split(',') if value.strip().lower() in classes)
    else:
        current = None
        with pymupdf.open(CACHE / '2014.pdf') as document:
            for index in range(104, 113):
                page = document[index]
                for side in (0, 1):
                    clip = pymupdf.Rect(side * page.rect.width / 2, 30, (side + 1) * page.rect.width / 2, page.rect.height - 45)
                    for raw in page.get_text(clip=clip, sort=True).split('\n'):
                        text = ' '.join(raw.split())
                        heading = re.fullmatch(r'(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells', text)
                        if heading:
                            current = heading[1].lower()
                        elif current and norm(text) in spell_names:
                            result[norm(text)].add(current)
    return {name: sorted(values) for name, values in result.items()}

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1
        if not self.skip:
            if tag in {'p','div','h1','h2','h3','h4','tr','ul','ol','br'}:
                self.parts.append('\n')
            if tag == 'li':
                self.parts.append('\n• ')
            if tag in {'td','th'}:
                self.parts.append(' | ')
    def handle_endtag(self, tag):
        if tag in {'script','style'} and self.skip:
            self.skip -= 1
        if not self.skip and tag in {'p','div','h1','h2','h3','h4','tr','li'}:
            self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
    def result(self):
        return re.sub(r'\n{3,}', '\n\n', '\n'.join(re.sub(r'[ \t\r\xa0]+',' ', line).strip(' |') for line in ''.join(self.parts).split('\n'))).strip()

def prose(raw, names, document):
    # Foundry links become plain labels. No embedded HTML, URLs or dice commands
    # survive in runtime content. Original reference macros are never executed.
    raw = html.unescape(raw)
    raw = re.sub(r'<section\b[^>]*\bclass=["\'][^"\']*\bsecret\b[^"\']*["\'][^>]*>.*?</section>', '', raw, flags=re.S|re.I)
    raw = re.sub(r'@Embed\[[^\]]*\](?:\{[^}]*\})?', '', raw, flags=re.S)
    raw = re.sub(r'@UUID\[([^\]]+)\]\{([^}]+)\}', r'\2', raw)
    raw = re.sub(r'@UUID\[([^\]]+)\]', lambda m:names.get(m[1].split('.')[-1], 'reference'), raw)
    raw = re.sub(r'&Reference\[([^\]]+)\](?:\{([^}]+)\})?', lambda m:m[2] or m[1].split()[0].split('=')[-1].replace('-', ' '), raw, flags=re.I)
    def inline(match):
        text = html.unescape(match[1])
        activities = list(document.get('system', {}).get('activities', {}).values())
        if text in {'/healing', '/damage'}:
            for activity in activities:
                parts = [activity['healing']] if text == '/healing' and activity.get('healing') else activity.get('damage', {}).get('parts', []) if text == '/damage' else []
                formulas = [damage_formula(part) for part in parts]
                if any(formulas):
                    return ' + '.join(filter(None, formulas)) + (' Hit Points' if text == '/healing' else ' damage')
            return 'healing (resolve the amount manually)' if text == '/healing' else 'damage (resolve the amount manually)'
        if text.startswith('lookup '):
            key = text.split()[1].lstrip('@')
            value = document if not key.startswith('item.') else document['system']
            for part in key.removeprefix('item.').split('.'):
                value = value.get(part) if isinstance(value, dict) else None
            if isinstance(value, (str, int, float)) and not isinstance(value, bool):
                return str(value)
            label = key.replace('item.', '').replace('abilities.', '').replace('classes.', '').replace('labels.', '')
            return label.replace('.', ' ').replace('_', ' ')
        if text.startswith('/award '):
            return text[7:]
        if text.startswith(('/r ', '/gmr ', '/roll ')):
            return text.split(' ',1)[1].split('#')[0]
        if text.startswith(('/damage ', '/healing ')):
            text = text.split(' ',1)[1]
            return re.sub(r'\b(?:type|average|format|activity)=[^ ]+', '', text).strip()
        if text.startswith('/'):
            return text[1:].replace('ability=', '').replace('skill=', '').replace('dc=', 'DC ').replace('dc ', 'DC ')
        return text.lstrip('@')
    raw = re.sub(r'\[\[(.*?)\]\]', inline, raw, flags=re.S)
    raw = re.sub(r'@(UUID|Embed|Reference)\[[^\]]*\]', '', raw)
    raw = re.sub(r'@([A-Za-z][A-Za-z0-9_.-]*)', lambda m:m[1].replace('abilities.', '').replace('classes.', '').replace('item.', '').replace('scale.', '').replace('.mod',' modifier').replace('.levels',' level').replace('.', ' ').replace('_', ' '), raw)
    parser = PlainText()
    parser.feed(raw)
    return parser.result()

def license_name(name, official):
    """Conservative SRD name check; unknown variants are excluded, not guessed."""
    if norm(name) in official:
        return 'literal-name'
    base = re.sub(r'\s*\+[123]$', '', name)
    base = re.sub(r'\s*\([^)]*\)', '', base)
    base = base.replace(' Armor', '')
    if base != name and len(norm(base)) >= 4 and norm(base) in official:
        return 'named-variant'
    parts = [part.strip() for part in re.split('[,:]', name)]
    if len(parts) > 1 and all(len(norm(part)) >= 3 and norm(part) in official for part in parts):
        return 'named-options'
    return None

def damage_formula(part):
    if not isinstance(part, dict):
        return ''
    if part.get('custom', {}).get('enabled'):
        value = str(part.get('custom', {}).get('formula') or '')
        return value if re.fullmatch(r'[0-9dD+*()/ .-]{1,120}', value) else ''
    count, faces, bonus = number(part.get('number')), number(part.get('denomination')), str(part.get('bonus') or '').strip()
    if not count or not faces:
        return bonus if re.fullmatch(r'\d+(?:\.\d+)?', bonus) else ''
    value = f'{count}d{faces}'
    if bonus and re.fullmatch(r'[0-9+*/(). -]+', bonus):
        value += ' + ' + bonus
    return value

def formula_terms(formula):
    """Translate a tiny, non-executable dice grammar into original typed data.

    Only @mod has a defined meaning here. Upstream context lookups, arithmetic,
    functions and arbitrary formula strings remain manual instead of becoming
    plausible-looking but incorrect rolls.
    """
    formula = str(formula or '').strip().replace(' ', '')
    if not formula:
        return {'dice': [], 'constant': 0, 'spellModifier': False}
    token = re.compile(r'([+-]?)(?:(\d+)d(\d+)|(\d+(?:\.\d+)?)|(@mod))', re.I)
    result, pos = {'dice': [], 'constant': 0, 'spellModifier': False}, 0
    for match in token.finditer(formula):
        if match.start() != pos or pos and not match[1]:
            return None
        sign = -1 if match[1] == '-' else 1
        if match[2]:
            count, faces = int(match[2]), int(match[3])
            if sign < 0 or not 0 < count <= 1000 or not 2 <= faces <= 1000:
                return None
            result['dice'].append({'number': count, 'faces': faces})
        elif match[4]:
            result['constant'] += sign * number(match[4])
        elif sign < 0 or result['spellModifier']:
            return None
        else:
            result['spellModifier'] = True
        pos = match.end()
    return result if pos == len(formula) else None

def part_terms(part):
    if not isinstance(part, dict):
        return None
    if part.get('custom', {}).get('enabled'):
        return formula_terms(part.get('custom', {}).get('formula'))
    count, faces = number(part.get('number')), number(part.get('denomination'))
    if count and (not faces or count != int(count) or faces != int(faces)):
        return None
    formula = f'{count}d{faces}' if count and faces else ''
    bonus = str(part.get('bonus') or '').strip()
    if bonus:
        formula += (' + ' if formula and not bonus.startswith(('+', '-')) else '') + bonus
    return formula_terms(formula)

def merge_terms(parts):
    result = {'dice': [], 'constant': 0, 'spellModifier': False}
    for part in parts:
        if part is None or result['spellModifier'] and part['spellModifier']:
            return None
        result['dice'].extend(part['dice'])
        result['constant'] += part['constant']
        result['spellModifier'] |= part['spellModifier']
    return result

def spell_formula_profile(source, description, name, edition):
    """Preserve explicit damage/healing semantics, without universal bonuses.

    A profile represents one damage instance, not all targets, rays or recurring
    applications. Official prose is retained for all non-numeric spell effects.
    """
    level = number(source.get('level'))
    # Upstream models these persistent weapons as summons rather than damage
    # activities. Their original SRD arithmetic is short and unambiguous. Check
    # the official prose before supplying the missing activity representation.
    if name in {'Flame Blade', 'Spiritual Weapon'} and level == 2:
        dice = '3d6' if name == 'Flame Blade' else '1d8'
        modifier = name == 'Spiritual Weapon' or edition == '2024'
        flat = ' '.join(description.split()).lower()
        if dice in flat and ('spellcasting ability modifier' in flat) == modifier:
            return {'version': 1, 'kind': 'damage', 'base': {'dice': [{'number': int(dice[0]), 'faces': int(dice[2:])}], 'constant': 0, 'spellModifier': modifier}, 'critical': True, 'scaling': {'mode': 'slot', 'dice': [{'number': 1, 'faces': int(dice[2:])}], 'constant': 0, 'interval': 2 if edition == '2014' else 1}}
    activities = list(source.get('activities', {}).values())
    activity = next((a for a in activities if a.get('damage', {}).get('parts')), None)
    kind = 'damage'
    if activity:
        parts = activity['damage']['parts']
    else:
        activity = next((a for a in activities if a.get('healing')), None)
        if not activity:
            return None
        parts = [activity['healing']]
        kind = 'temporary' if 'temphp' in parts[0].get('types', []) else 'healing'
    base = merge_terms([part_terms(part) for part in parts])
    if base is None or not (base['dice'] or base['constant'] or base['spellModifier']):
        return None
    profile = {'version': 1, 'kind': kind, 'base': base, 'critical': activity.get('type') == 'attack' and activity.get('damage', {}).get('critical', {}).get('allow') is not False}
    increments = []
    for part in parts:
        scaling = part.get('scaling', {})
        if scaling.get('mode') != 'whole':
            continue
        if scaling.get('formula'):
            increment = formula_terms(scaling['formula'])
        else:
            count = number(scaling.get('number'), number(part.get('number')) if level == 0 else 0)
            increment = formula_terms(f"{count}d{number(part.get('denomination'))}") if count else None
        if increment is None or increment['spellModifier']:
            # Do not silently keep only the supported part of a mixed increment.
            profile['scalingManual'] = True
            increments = []
            break
        increments.append(increment)
    if increments:
        increment = merge_terms(increments)
        if increment and (increment['dice'] or increment['constant']):
            profile['scaling'] = {'mode': 'cantrip' if level == 0 else 'slot', 'dice': increment['dice'], 'constant': increment['constant'], 'interval': 1}
            if level == 0:
                profile['scaling']['thresholds'] = [5, 11, 17]
            elif re.search(r'(?:for (?:every|each) two|for each 2) slot levels', description, re.I):
                profile['scaling']['interval'] = 2
    # These rolls are explicitly per projectile; more projectiles are not larger
    # damage dice in one attack. Preserve the unit for UI guidance.
    if name in {'Eldritch Blast', 'Scorching Ray'}:
        profile['unit'] = 'beam'
        profile.pop('scaling', None)
        profile['count'] = {'base': 1 if name == 'Eldritch Blast' else 3, 'scalingmode': 'cantrip' if level == 0 else 'slot', 'increment': 1}
        if level == 0:
            profile['count']['thresholds'] = [5, 11, 17]
        else:
            profile['count']['baseLevel'] = level
    elif name == 'Magic Missile':
        profile['unit'] = 'dart'
        profile.pop('scaling', None)
        profile['count'] = {'base': 3, 'scalingmode': 'slot', 'increment': 1, 'baseLevel': level}
    # Aid changes both current and maximum HP. Its numeric amount may be rolled,
    # but a generic healing application must not claim to implement that effect.
    if name in {'Aid', "Heroes' Feast", 'Heroism', 'Regenerate', 'Power Word Heal', 'Goodberry', 'Raise Dead', 'Revivify', 'Resurrection', 'True Resurrection'}:
        profile['manual'] = True
        profile['applicationManual'] = True
    return profile

def distance(value):
    if not isinstance(value, dict):
        return str(value or '')
    unit = value.get('units', '')
    if unit in {'self','touch','any','spec'}:
        return {'self':'Self','touch':'Touch','any':'Unlimited','spec':'Special'}[unit]
    if value.get('value') is None:
        return str(value.get('special') or '')
    return f"{value['value']}" + (f" / {value['long']}" if value.get('long') else '') + f' {unit}'

def duration(value):
    if not isinstance(value, dict):
        return str(value or '')
    unit = value.get('units', '')
    return {'inst':'Instantaneous','perm':'Permanent','spec':'Special'}.get(unit, f"{value.get('value') or ''} {unit}".strip())

def convert(document, source_pack, edition, description, names):
    source, kind = document['system'], document['type']
    data = {'rulesEdition':edition, 'description':description, 'source':f"SRD {'5.1' if edition=='2014' else '5.2.1'}", 'quantity':number(source.get('quantity'),1), 'weight':number(source.get('weight',{}).get('value') if isinstance(source.get('weight'),dict) else source.get('weight')), 'category':source.get('type',{}).get('value','') if isinstance(source.get('type'),dict) else '', 'uses':number(source.get('uses',{}).get('max')), 'range':distance(source.get('range')), 'rarity':source.get('rarity',''), 'properties':source.get('properties',[])}
    price = source.get('price', {})
    data['cost'] = f"{price.get('value',0)} {price.get('denomination','gp')}" if price else ''
    activities = list(source.get('activities', {}).values())
    if kind == 'spell':
        data.update(level=number(source.get('level')), school=SCHOOLS.get(source.get('school'),source.get('school','')), casting_time=source.get('activation',{}).get('type','action'), duration=duration(source.get('duration')), components={key:value in source.get('properties',[]) for key,value in [('v','vocal'),('s','somatic'),('m','material')]}, materials=source.get('materials',{}).get('value',''), concentration='concentration' in source.get('properties',[]), ritual='ritual' in source.get('properties',[]), resolution='none', higher_levels='')
        activation = source.get('activation', {})
        action_type = activation.get('type') or next((a.get('activation', {}).get('type') for a in activities if not a.get('activation', {}).get('override') and a.get('activation', {}).get('type')), '')
        if action_type in {'action', 'bonus', 'reaction'}:
            data['actionType'] = action_type
        elif action_type in {'minute', 'hour', 'day'}:
            data['actionType'] = 'long'
        if activation.get('value') not in (None, '', 1):
            data['casting_time'] = f"{activation['value']} {activation.get('type','action')}"
        # Official base values replace upstream formulas that require Foundry's
        # scaling context, which Gravewright intentionally does not evaluate.
        for field, caption in [('casting_time','Casting Time'),('range','Range'),('duration','Duration')]:
            match = re.search(r'^'+caption+r':\s*([^\n]+)', description, re.M)
            if match:
                data[field] = match[1].replace(' feet',' ft').replace(' foot',' ft')
        for activity in activities:
            if activity.get('type') == 'attack':
                data['resolution'] = 'attack_' + activity.get('attack',{}).get('type',{}).get('value','ranged')
                break
            if activity.get('type') == 'save':
                ability = activity.get('save',{}).get('ability','')
                if isinstance(ability,list): ability=ability[0] if ability else ''
                data['resolution'] = 'save_' + ability if ability else 'none'
                break
        damage_parts = next((a.get('damage',{}).get('parts',[]) for a in activities if a.get('damage',{}).get('parts')),[])
        if not damage_parts:
            heal = next((a['healing'] for a in activities if a.get('healing')),None)
            damage_parts = [heal] if heal else []
        data['damage'] = ' + '.join(filter(None, (damage_formula(part) for part in damage_parts)))
        data['damage_type'] = ', '.join(dict.fromkeys(t for part in damage_parts for t in part.get('types',[])))
        if data['damage_type'] in {'healing', 'temphp'}:
            data['healingFormula'], data['damage'] = data['damage'], ''
        profile = spell_formula_profile(source, description, document['name'], edition)
        if profile:
            data['formulaProfile'] = profile
            if profile['kind'] == 'damage' and (len({t for part in damage_parts for t in part.get('types', [])}) > 1 or document['name'] in {'Prismatic Spray', 'Prismatic Wall'}):
                # A single total cannot preserve per-type resistance, nor choose
                # a prismatic color's contextual effect. Roll the numeric part
                # but leave its application to the table.
                profile['applicationManual'] = True
            if document['name'] in {'Flame Blade', 'Spiritual Weapon'} and data['level'] == 2 and profile.get('critical'):
                # Their summon representation omits the attack activity in some
                # upstream editions. Keep the confirmed SRD attack/type usable
                # by the native attack button and typed-damage application.
                data['resolution'] = 'attack_melee'
                data['damage_type'] = 'fire' if document['name'] == 'Flame Blade' else 'force'
                if not data['damage']:
                    data['damage'] = '3d6' if document['name'] == 'Flame Blade' else '1d8'
        return kind, data
    if kind == 'weapon':
        base = source.get('damage',{}).get('base',{})
        data.update(damage=damage_formula(base), damage_type=', '.join(base.get('types',[])), versatile=damage_formula(source.get('damage',{}).get('versatile',{})), attack_type='ranged' if source.get('type',{}).get('value','').endswith('R') else 'melee', attack_bonus=number(source.get('magicalBonus')), damage_bonus=number(source.get('magicalBonus')), mastery=source.get('mastery',''), attack_ability='auto', proficient=True)
        types = base.get('types', [])
        data['damage_type'] = next((kind for kind in types if kind in {'slashing','piercing','bludgeoning'}), next(iter(types), ''))
        if len(types)>1: data['additionalDamageTypes'] = [kind for kind in types if kind != data['damage_type']]
        data['category'] = 'martial' if data['category'].startswith('martial') else 'simple'
        data['props'] = {field:token in source.get('properties', []) for field,token in {'finesse':'fin','light':'lgt','heavy':'hvy','thrown':'thr','two_handed':'two','versatile':'ver','reach':'rch','ammunition':'amm','loading':'lod','special':'spc'}.items()}
        if data['props']['versatile'] and not data['versatile']:
            data['versatile'] = {'battleaxe':'1d10','longsword':'1d10','quarterstaff':'1d8','spear':'1d8','trident':'1d8','warhammer':'1d10'}.get(source.get('type',{}).get('baseItem'), '')
        if not data['range']:
            data['range'] = next((distance(a.get('range')) for a in activities if distance(a.get('range'))), '5 ft')
        if data['props']['reach'] and data['range']=='5 ft':
            data['range']='10 ft'
    elif kind == 'equipment' and source.get('type',{}).get('value') in {'light','medium','heavy','shield'}:
        kind = 'armor'
        armor_kind = source['type']['value']
        data.update(base_ac=number(source.get('armor',{}).get('value'),10)+number(source.get('armor',{}).get('magicalBonus')), armor_type=armor_kind, add_dex=armor_kind in {'light','medium'}, max_dex=2 if armor_kind=='medium' else 99 if armor_kind=='light' else 0, str_req=number(source.get('strength')), stealth_disadvantage='stealthDisadvantage' in source.get('properties',[]))
        data['armorMagicalBonus'] = number(source.get('armor',{}).get('magicalBonus'))
    elif kind in {'tool','loot','container'}:
        kind = 'equipment'
        data['subtype'] = document['type']
    elif kind == 'consumable':
        data['subtype'] = {'potion':'potion','scroll':'scroll','ammo':'ammo','food':'food'}.get(data['category'], 'other')
        if edition == '2014' and document['name'] == 'Potion of Healing':
            # The official adventuring-gear table specifies 1/2 lb (SRD 5.1 p.69).
            data['weight'] = .5
            data['contentCorrections'] = ['Potion of Healing weight corrected to the official SRD adventuring-gear table.']
    elif kind in {'subclass','feat'}:
        kind = 'feat' if source_pack=='feats24' or document['name']=='Grappler' else 'feature'
        data['benefits'] = description
        requirements = source.get('requirements', '')
        data['prerequisite'] = requirements if isinstance(requirements,str) else ''
    advancement = source.get('advancement', [])
    advancement = list(advancement.values()) if isinstance(advancement, dict) else advancement
    advancement = [row for row in advancement if isinstance(row, dict)]
    def labeled(*labels):
        for label in labels:
            match = re.search(r'(?:^|\n)' + re.escape(label) + r':?\s*(?:\|\s*)?([^\n]+)', description, re.I)
            if match:
                return match[1].strip()
        return ''
    def traits(prefix):
        labels = []
        for row in advancement:
            if row.get('type') != 'Trait': continue
            config = row.get('configuration', {})
            for grant in config.get('grants', []):
                if grant.startswith(prefix + ':'): labels.append(grant.split(':')[-1].replace('*','choice').replace('-', ' ').title())
            for choice in config.get('choices', []):
                pool = [grant.split(':')[-1].replace('*','choice').replace('-', ' ').title() for grant in choice.get('pool', []) if grant.startswith(prefix + ':')]
                if pool: labels.append('Choose ' + str(choice.get('count',1)) + ': ' + ', '.join(pool))
        return ', '.join(dict.fromkeys(labels))
    if kind == 'class':
        data.update(hit_die=source.get('hd',{}).get('denomination',source.get('hitDice','')), spellcasting_ability=source.get('spellcasting',{}).get('ability') or 'none', primary_ability=', '.join(source.get('primaryAbility',{}).get('value',[])), saving_throws=labeled('Saving Throws','Saving Throw Proficiencies') or traits('saves'), armor_proficiencies=labeled('Armor Training','Armor') or traits('armor'), weapon_proficiencies=labeled('Weapon Proficiencies','Weapons') or traits('weapon'), tool_proficiencies=labeled('Tool Proficiencies','Tools') or traits('tool'), skills=labeled('Skill Proficiencies','Skills') or traits('skills'))
    elif kind == 'race':
        sizes = next((row.get('configuration',{}).get('sizes',[]) for row in advancement if row.get('type')=='Size'), [])
        size_names = {'tiny':'tiny','sm':'small','med':'medium','lg':'large'}
        data.update(size=size_names.get(sizes[0], '') if len(sizes)==1 else '', speed=number(source.get('movement',{}).get('walk')), languages=labeled('Languages') or traits('languages'), traits=description, asi=labeled('Ability Score Increase','Ability Scores'), age_alignment='; '.join(filter(None,[labeled('Age'),labeled('Alignment')])) )
        if len(sizes)>1: data['sizeChoices'] = [size_names.get(size,size) for size in sizes]
    elif kind == 'background':
        feature = next((row for row in advancement if row.get('type')=='ItemGrant'), {})
        feature_items = feature.get('configuration', {}).get('items', [])
        feature_name = ', '.join(names.get(item.get('uuid','').split('.')[-1], '') for item in feature_items)
        data.update(skill_proficiencies=labeled('Skill Proficiencies') or traits('skills'), tool_proficiencies=labeled('Tool Proficiencies','Tool Proficiency') or traits('tool'), languages=labeled('Languages') or traits('languages'), equipment=labeled('Equipment'), feature_name=feature_name or labeled('Feat','Feature'), feature_description=str(feature.get('hint') or ''))
    elif kind == 'feature':
        maximum = number(source.get('uses',{}).get('max'))
        spent = number(source.get('uses',{}).get('spent'))
        recovery = [row.get('period') for row in source.get('uses',{}).get('recovery', [])]
        requirement_level = re.search(r'\b(\d+)\b',str(source.get('requirements') or ''))
        data.update(uses={'value':max(0,maximum-spent), 'max':maximum}, level=number(source.get('prerequisites',{}).get('level'),int(requirement_level[1]) if requirement_level else 0), recharge='long' if 'lr' in recovery else 'short' if 'sr' in recovery else 'turn' if 'turn' in recovery else 'none')
        recovery_rules = {}
        for row in source.get('uses', {}).get('recovery', []):
            period = {'sr': 'short', 'lr': 'long'}.get(row.get('period'))
            if not period:
                continue
            if row.get('type') == 'recoverAll':
                recovery_rules[period] = {'mode': 'all'}
            elif row.get('type') == 'formula' and re.fullmatch(r'\d+', str(row.get('formula', '')).strip()):
                recovery_rules[period] = {'mode': 'amount', 'amount': int(row['formula'])}
            else:
                data['recoveryManual'] = True
        if 'short' in recovery_rules and 'long' not in recovery_rules and re.search(r'short\s+(?:rest\s+)?(?:or|and)\s+(?:a\s+)?long\s+rest', description, re.I):
            recovery_rules['long'] = dict(recovery_rules['short'])
        if recovery_rules or data.get('recoveryManual'):
            data['recovery'] = recovery_rules
        if not maximum and source.get('uses',{}).get('max'): data['usesGuidance'] = str(source['uses']['max']).lstrip('@').replace('.', ' ') + ' (configure manually for the character level)'
    return kind, data

def main():
    tree = json.loads((CACHE/'tree.json').read_text(encoding='utf-8'))
    assert tree['sha'] == COMMIT and not tree.get('truncated')
    source_files = [row for row in tree['tree'] if row['type']=='blob' and row['path'].startswith('packs/_source/') and row['path'].split('/')[2] in set.union(*PACKS.values()) and row['path'].endswith('.yml') and not row['path'].endswith('/_folder.yml')]
    records, names = [], {}
    for row in source_files:
        path = CACHE/COMMIT/row['path']
        raw, document = path.read_bytes(), load(path)
        if sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest() != row['sha']:
            raise ValueError('Cached source digest mismatch: ' + row['path'])
        names[str(document.get('_id'))] = document.get('name','reference')
        records.append((row, raw, document))
    output = ROOT/'compendiums'
    output.mkdir(exist_ok=True)
    report = {'upstream':{'repository':'https://github.com/foundryvtt/dnd5e','commit':COMMIT,'license':'MIT'}, 'official':{}, 'counts':{}, 'excluded':[], 'advancement':{}, 'changes':['Original data representation for Gravewright; no artwork, icons, automation code or premium packs.', 'Spell descriptions extracted from official SRD PDFs; other descriptions converted to plain text with runtime macros removed.', 'Conservative SRD-name filtering; uncertain variants omitted.', 'Descriptions remain English; interface localization does not translate game content.', 'Versioned typed formula profiles preserve spellcasting modifiers, healing, temporary HP and explicit cantrip/slot increments; unsupported contextual expressions remain manual.', 'Advancement references resolve only to licensed portable entries; unsupported references and contextual effects are explicitly audited. Original Dragonborn breath and Hill Dwarf toughness definitions derive solely from licensed parent SRD text.']}
    for edition in ['2014','2024']:
        spell_names = {norm(d['name']) for row,raw,d in records if row['path'].split('/')[2] in {'spells','spells24'} and d.get('type')=='spell' and d.get('system',{}).get('source',{}).get('rules')==edition}
        official, official_spells, pdf_meta = read_pdf(edition, spell_names)
        spell_lists = read_spell_lists(edition, spell_names, official_spells)
        report['official'][edition] = pdf_meta
        groups = defaultdict(list)
        documents = {}
        for row, raw, document in records:
            source_pack = row['path'].split('/')[2]
            if source_pack not in PACKS[edition]:
                continue
            system_source = document.get('system',{}).get('source',{})
            reason = None
            if system_source.get('rules') != edition:
                reason = 'different-edition'
            elif system_source.get('license') != 'CC-BY-4.0':
                reason = 'no-explicit-content-license'
            proof = license_name(document['name'], official)
            if not reason and proof is None:
                reason = 'name-not-confirmed-in-official-SRD'
            if reason:
                report['excluded'].append({'path':row['path'], 'name':document['name'], 'reason':reason})
                continue
            pdf_spell = official_spells.get(norm(document['name'])) if document['type']=='spell' else None
            if document['type']=='spell' and not pdf_spell:
                raise ValueError('Missing official spell text: '+document['name']+' '+edition)
            description = pdf_spell['description'] if pdf_spell else prose(document['system'].get('description',{}).get('value',''), names, document)
            kind, data = convert(document, source_pack, edition, description, names)
            if kind == 'weapon' and not data['damage'] and not description:
                report['excluded'].append({'path':row['path'],'name':document['name'],'reason':'empty-auxiliary-weapon'})
                continue
            if kind not in GROUP_LABELS:
                report['excluded'].append({'path':row['path'],'name':document['name'],'reason':'unmapped-type'})
                continue
            data['provenance'] = {'contentLicense':'CC-BY-4.0', 'sourceRepository':report['upstream']['repository'], 'sourceCommit':COMMIT, 'sourcePath':row['path'], 'sourceId':document.get('_id',''), 'sourceGitBlob':row['sha'], 'sourceSha256':sha256(raw).hexdigest(), 'officialSRD':pdf_meta['url'], 'officialPdfSha256':pdf_meta['sha256'], 'nameCheck':proof}
            if pdf_spell:
                data['provenance']['officialPage'] = pdf_spell['page']
                data['spellLists'] = spell_lists.get(norm(document['name']), [])
            entry = {'id':str(uuid.uuid5(uuid.NAMESPACE_URL, SYSTEM+'/'+edition+'/'+row['path'])), 'name':document['name'], 'type':kind, 'systemId':SYSTEM, 'data':data}
            groups[kind].append(entry)
            documents[entry['id']] = document
        entries = [entry for group in groups.values() for entry in group]
        report['advancement'][edition] = normalize_catalog(entries, documents, names, lambda raw, document: prose(raw, names, document))
        groups = defaultdict(list)
        for entry in entries:
            groups[entry['type']].append(entry)
        collection = {'name':f"SRD {'5.1' if edition=='2014' else '5.2.1'} · {edition}", 'language':'en', 'license':'CC-BY-4.0', 'packs':[]}
        for kind in GROUP_LABELS:
            entries = groups[kind]
            if entries:
                collection['packs'].append({'id':kind+'-'+edition,'label':GROUP_LABELS[kind], 'type':'spell_pack' if kind=='spell' else 'item_pack', 'entries':sorted(entries,key=lambda e:(e['name'].casefold(),e['id']))})
        report['counts'][edition] = {kind:len(rows) for kind,rows in groups.items()}
        (output/f'{edition}.json').write_text(json.dumps(collection,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    (output/'PROVENANCE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'counts':report['counts'],'excluded':len(report['excluded'])},ensure_ascii=False))

if __name__ == '__main__':
    main()
