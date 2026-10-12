"""Portable, non-executable advancement data for already licensed SRD entries.

This converter never widens the builder's content allowlist. References resolve
only against accepted entries; exceptional derived definitions use the licensed
parent's own SRD prose, not the excluded upstream document.
"""
from collections import Counter
from copy import deepcopy
import ast
import math
import re
import uuid

ABILITIES = ('str', 'dex', 'con', 'int', 'wis', 'cha')
SKILLS = dict(zip(
    ('acr', 'ani', 'arc', 'ath', 'dec', 'his', 'ins', 'itm', 'inv', 'med', 'nat', 'prc', 'prf', 'per', 'rel', 'slt', 'ste', 'sur'),
    ('acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival')))
SIZES = {'tiny': 'tiny', 'sm': 'small', 'med': 'medium', 'lg': 'large', 'huge': 'huge', 'grg': 'gargantuan'}
DAMAGE_TYPES = {'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'}
CONDITIONS = {'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'diseased'}


def numeric(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return (int(number) if number.is_integer() else number) if math.isfinite(number) and abs(number) <= 1e6 else None
    except (TypeError, ValueError):
        return None


def formula_profile(value):
    """Parse a small arithmetic grammar into an AST, without eval or macros."""
    text = str(value or '').strip()
    if not text or len(text) > 180:
        return None
    variables = {}
    pattern = r'@(prof\b|abilities\.(str|dex|con|int|wis|cha)\.mod\b|classes\.([a-z][a-z0-9-]*)\.levels\b|scale\.([a-z][a-z0-9-]*)\.([a-z0-9_-]+)\b|details\.level\b|attributes\.movement\.(walk|fly|climb|swim|burrow)\b)'

    def replace(match):
        key = 'v' + str(len(variables))
        if match[1] == 'prof':
            node = {'type': 'proficiency'}
        elif match[2]:
            node = {'type': 'abilityModifier', 'ability': match[2]}
        elif match[3]:
            node = {'type': 'classLevel', 'classId': match[3]}
        elif match[4]:
            node = {'type': 'scale', 'classId': match[4], 'identifier': match[5]}
        elif match[6]:
            node = {'type': 'movement', 'mode': match[6]}
        else:
            node = {'type': 'level'}
        variables[key] = node
        return key

    text = re.sub(pattern, replace, text)
    if '@' in text:
        return None
    try:
        tree = ast.parse(text, mode='eval')
    except (SyntaxError, ValueError, RecursionError):
        return None

    def convert(node, depth=0):
        if depth > 12:
            raise ValueError('too-deep')
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and numeric(node.value) is not None:
            return {'type': 'constant', 'value': numeric(node.value)}
        if isinstance(node, ast.Name) and node.id in variables:
            return variables[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = convert(node.operand, depth + 1)
            return value if isinstance(node.op, ast.UAdd) else {'type': 'multiply', 'args': [{'type': 'constant', 'value': -1}, value]}
        operations = {ast.Add: 'add', ast.Sub: 'subtract', ast.Mult: 'multiply', ast.Div: 'divide'}
        if isinstance(node, ast.BinOp) and type(node.op) in operations:
            return {'type': operations[type(node.op)], 'args': [convert(node.left, depth + 1), convert(node.right, depth + 1)]}
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {'min', 'max', 'floor', 'ceil'} and not node.keywords and 1 <= len(node.args) <= 8:
            if node.func.id in {'floor', 'ceil'} and len(node.args) != 1:
                raise ValueError('arity')
            return {'type': node.func.id, 'args': [convert(arg, depth + 1) for arg in node.args]}
        raise ValueError('unsupported')

    try:
        return convert(tree.body)
    except (ValueError, RecursionError):
        return None


def trait(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_:*+-]+', value):
        return None
    parts = value.split(':')
    if parts[0] == 'skills' and len(parts) == 2:
        parts[1] = SKILLS.get(parts[1], parts[1])
    return ':'.join(parts)


def rows(document):
    value = document.get('system', {}).get('advancement', [])
    return [row for row in (value.values() if isinstance(value, dict) else value) if isinstance(row, dict)]


def source_id(reference):
    if isinstance(reference, dict):
        reference = reference.get('uuid', '')
    match = re.fullmatch(r'Compendium\.dnd5e\.([a-zA-Z0-9_-]+)\.(?:Item\.)?([a-zA-Z0-9_-]+)', str(reference))
    return (match[1], match[2]) if match else None


def equipment_pool(kind, selector, edition, entries, documents):
    """Expand mundane starting choices only; magic items are never alternatives."""
    focus = {'holy': {'amulet', 'emblem', 'reliquary'},
             'arcane': {'crystal', 'orb', 'rod', 'staff', 'wand'},
             'druidic': {'sprig-of-mistletoe', 'totem', 'wooden-staff', 'yew-wand'}}
    aliases = {'sim': 'simple', 'mar': 'martial', 'artisan': 'art', 'musical': 'music'}
    selector = aliases.get(selector, selector)
    result = []
    for candidate in entries:
        if candidate['data']['rulesEdition'] != edition:
            continue
        source = documents[candidate['id']].get('system', {})
        if source.get('rarity') or numeric(source.get('magicalBonus')) or numeric((source.get('armor') or {}).get('magicalBonus')):
            continue
        source_type = source.get('type') or {}
        value = source_type.get('value', '') if isinstance(source_type, dict) else ''
        matches = (kind == 'weapon' and candidate['type'] == 'weapon' and
                   (value.startswith(selector) if selector in {'simple', 'martial'} else value == selector))
        matches = matches or kind == 'tool' and documents[candidate['id']].get('type') == 'tool' and value == selector
        matches = matches or kind == 'armor' and candidate['type'] == 'armor' and value == selector
        matches = matches or kind == 'focus' and source.get('identifier') in focus.get(selector, set())
        if matches:
            result.append(candidate['id'])
    return sorted(set(result))


def _derived(entries, documents):
    aliases, additions = {}, []
    for parent in list(entries):
        data = parent['data']
        if data.get('rulesEdition') != '2014' or parent['type'] != 'race':
            continue
        document = documents[parent['id']]
        identifier = document['system'].get('identifier')
        if identifier not in {'dragonborn', 'hill-dwarf'}:
            continue
        description = data.get('description', '')

        def make(slug, name, text, mechanics):
            entry_id = str(uuid.uuid5(uuid.NAMESPACE_URL, parent['id'] + '/derived/' + slug))
            child_data = {'rulesEdition': '2014', 'description': text, 'benefits': text, 'identifier': slug, 'level': 0, **mechanics}
            child_data['provenance'] = {**deepcopy(data['provenance']), 'derivedFrom': parent['id'], 'derivation': 'Original typed definition from licensed parent SRD text.', 'nameCheck': 'derived-parent-SRD-rule'}
            child = {'id': entry_id, 'name': name, 'type': 'feature', 'systemId': parent['systemId'], 'data': child_data}
            additions.append(child)
            documents[entry_id] = {'_id': entry_id, 'name': name, 'type': 'feat', 'system': {'identifier': slug, 'source': {'rules': '2014', 'license': 'CC-BY-4.0'}, 'description': {'value': text}}, 'effects': []}
            return child

        if identifier == 'dragonborn':
            # Every tuple must literally occur in the licensed parent table.
            options = re.findall(r'(Black|Blue|Brass|Bronze|Copper|Gold|Green|Red|Silver|White)\s*(?:\|\s*)?(Acid|Cold|Fire|Lightning|Poison)\s*(?:\|\s*)?(5 by 30 ft\. line|15 ft\. cone)\s*\((Dex|Con)\. save\)', description, re.I)
            pool = next((row.get('configuration', {}).get('pool', []) for row in rows(document) if row.get('type') == 'ItemChoice'), [])
            if len(options) != 10 or len(pool) != 10:
                raise ValueError('Licensed Dragonborn ancestry table could not be verified')
            for (color, damage, shape, save), reference in zip(options, pool):
                text = (f'{color} ancestry: {shape}; {damage.lower()} damage; {save.upper()} saving throw. '
                        'Use an action; save DC = 8 + Constitution modifier + proficiency bonus. '
                        'Damage: 2d6, increasing to 3d6 at level 6, 4d6 at level 11, and 5d6 at level 16; half damage on a successful save. '
                        f'Regain the use after a short or long rest. Resistance to {damage.lower()} damage.')
                child = make('breath-weapon-' + color.lower(), color.title() + ' Breath Weapon', text, {
                    'uses': {'value': 1, 'max': 1}, 'recharge': 'short', 'recovery': {'short': {'mode': 'all'}, 'long': {'mode': 'all'}},
                    'damage_type': damage.lower(), 'damage': '2d6', 'damageTraits': {'resistances': [damage.lower()]},
                    'breathWeapon': {'ancestry': color.lower(), 'shape': 'line' if 'line' in shape else 'cone', 'size': 30 if 'line' in shape else 15,
                                    'width': 5 if 'line' in shape else 0, 'saveAbility': save.lower(), 'dcAbility': 'con', 'onSave': 'half',
                                    'scale': {'0': {'number': 2, 'faces': 6}, '6': {'number': 3, 'faces': 6}, '11': {'number': 4, 'faces': 6}, '16': {'number': 5, 'faces': 6}}},
                })
                aliases['2014', source_id(reference)] = child
        elif identifier == 'hill-dwarf':
            text = 'Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.'
            if text.lower() not in description.lower():
                raise ValueError('Licensed Hill Dwarf toughness text could not be verified')
            child = make('dwarven-toughness', 'Dwarven Toughness', text, {'mechanicalTraits': {'hpPerLevel': 1}})
            aliases['2014', ('races', 'G7hkETvAYFLSLIVW')] = child
    entries.extend(additions)
    return aliases, additions


def normalize_catalog(entries, documents, names, clean):
    """Mutate typed entry data; return an auditable coverage/exception report."""
    aliases, additions = _derived(entries, documents)
    index = {}
    for entry in entries:
        p = entry['data']['provenance']
        pack = p['sourcePath'].split('/')[2]
        if 'derivedFrom' not in p:
            index[entry['data']['rulesEdition'], (pack, p['sourceId'])] = entry
    index.update(aliases)
    availability = {}
    for candidate in entries:
        doc = documents[candidate['id']]
        source = doc.get('system', {})
        if candidate['type'] == 'class':
            availability[candidate['data']['rulesEdition'], candidate['name'].casefold()] = {'classId': source.get('identifier')}
        elif doc.get('type') == 'subclass':
            availability[candidate['data']['rulesEdition'], candidate['name'].casefold()] = {'classId': source.get('classIdentifier'), 'subclassId': source.get('identifier')}
    class_sources = {}
    for parent in entries:
        if parent['type'] != 'class':
            continue
        parent_source = documents[parent['id']].get('system', {})
        for advance in rows(documents[parent['id']]):
            config = advance.get('configuration') or {}
            references = config.get('pool', []) if advance.get('type') == 'ItemChoice' else [item.get('uuid') for item in config.get('items', [])]
            for reference in references:
                child = index.get((parent['data']['rulesEdition'], source_id(reference)))
                if child:
                    class_sources.setdefault(child['id'], set()).add(parent_source.get('identifier'))
    report = {'entries': len(entries), 'derived': [{'id': e['id'], 'name': e['name'], 'parentId': e['data']['provenance']['derivedFrom']} for e in additions], 'advancements': Counter(), 'unresolved': [], 'manualEffects': [], 'effectTemplates': 0, 'passiveEffects': 0}

    for entry in entries:
        document = documents[entry['id']]
        source, data, edition = document.get('system', {}), entry['data'], entry['data']['rulesEdition']
        warnings = []

        def warning(row, reference, reason='not-in-licensed-catalog', runtime=True):
            identity = source_id(reference)
            name = names.get(identity[1], '') if identity else ''
            item = {'advancementId': row.get('_id', ''), 'type': row.get('type', ''), 'name': name or 'Unresolved benefit', 'reason': reason}
            if runtime:
                warnings.append(item)
            report['unresolved'].append({'entryId': entry['id'], 'entryName': entry['name'], 'edition': edition, **item, 'reference': reference})
            return {'name': item['name'], 'reason': reason}

        def resolve(reference, row):
            found = index.get((edition, source_id(reference)))
            return found if found else None

        data['identifier'] = source.get('identifier') or data.get('identifier', '')
        if source.get('classIdentifier'):
            data['classIdentifier'] = source['classIdentifier']
        if document.get('type') == 'subclass':
            data['subclass'] = True
        if isinstance(source.get('type'), dict):
            data['sourceType'] = source['type'].get('value', '')
            data['sourceSubtype'] = source['type'].get('subtype', '')
            if source['type'].get('value') == 'feat':
                data['featCategory'] = source['type'].get('subtype', '')
        if source.get('prerequisites') is not None or source.get('requirements'):
            prerequisites = source.get('prerequisites') or {}
            data['prerequisiteLevel'] = max(0, int(numeric(prerequisites.get('level')) or 0))
            data['repeatable'] = bool(prerequisites.get('repeatable'))
            data['requirements'] = clean(str(source.get('requirements') or ''), document)
            classes = class_sources.get(entry['id'], set()) - {None, ''}
            alternatives = []
            parts = [part.strip() for part in data['requirements'].split(',')]
            for part in parts:
                branch = re.fullmatch(r'(.+?)\s+(\d+)', part)
                found = availability.get((edition, branch[1].casefold())) if branch else None
                if found and found.get('classId'):
                    alternatives.append({**found, 'level': int(branch[2])})
            # Upstream shared features list availability as comma-separated
            # alternatives (Fighter 1, Champion 10, Ranger 2), not conjunctions.
            alternative_list = len(parts) > 1 and len(alternatives) == len(parts)
            if alternative_list:
                data['prerequisiteAlternatives'] = alternatives
            elif len(classes) == 1:
                data['prerequisiteClass'] = next(iter(classes))
            class_requirement = re.search(r'\b(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard) (\d+)\b', data['requirements'])
            if class_requirement and not alternative_list:
                data['prerequisiteClass'] = class_requirement[1].lower()
                data['prerequisiteLevel'] = max(data['prerequisiteLevel'], int(class_requirement[2]))
            data['prerequisiteItems'] = [value for value in prerequisites.get('items', []) if isinstance(value, str) and re.fullmatch(r'[a-z0-9-]+', value)]
            for candidate in entries:
                if alternative_list:
                    break
                cd = candidate['data']
                if cd['rulesEdition'] != edition or candidate['type'] not in {'feat', 'feature', 'spell'}:
                    continue
                if candidate['name'] and candidate['name'].casefold() in data['requirements'].casefold() and re.search(r'(?<![A-Za-z])' + re.escape(candidate['name']) + r'(?![A-Za-z])', data['requirements'], re.I):
                    identifier = documents[candidate['id']].get('system', {}).get('identifier')
                    if identifier and identifier not in data['prerequisiteItems'] and candidate['id'] != entry['id']:
                        data['prerequisiteItems'].append(identifier)
        if entry['type'] in {'weapon', 'armor', 'equipment', 'consumable'}:
            data['requiresAttunement'] = source.get('attunement') in {'required', 'optional', 1, 2}
            data['magicBonus'] = numeric(source.get('armor', {}).get('magicalBonus') if entry['type'] == 'armor' else source.get('magicalBonus')) or 0
            if entry['type'] == 'weapon':
                data['weaponGroup'] = 'martial' if source.get('type', {}).get('value', '').startswith('martial') else 'simple'
                data['baseWeapon'] = source.get('type', {}).get('baseItem') or data['identifier']
        if entry['type'] == 'race':
            movement = {key: value for key in ('walk', 'fly', 'climb', 'swim', 'burrow') if (value := numeric(source.get('movement', {}).get(key))) is not None}
            if movement:
                data['movement'] = {**movement, 'units': source.get('movement', {}).get('units') or 'ft', 'hover': bool(source.get('movement', {}).get('hover'))}
                data['speed'] = movement.get('walk', data.get('speed', 0))
            senses = {key: value for key in ('darkvision', 'blindsight', 'tremorsense', 'truesight') if (value := numeric(source.get('senses', {}).get(key))) is not None}
            if senses:
                data['senses'] = {**senses, 'units': source.get('senses', {}).get('units') or 'ft', 'special': source.get('senses', {}).get('special') or ''}
        spellcasting = source.get('spellcasting') or {}
        if spellcasting:
            data['spellcasting'] = {key: spellcasting[key] for key in ('ability', 'progression') if key in spellcasting}
            preparation = formula_profile(spellcasting.get('preparation', {}).get('formula'))
            if preparation:
                data['spellcasting']['preparationProfile'] = preparation
        uses = source.get('uses') or {}
        if uses.get('max'):
            profile = formula_profile(uses['max'])
            if profile:
                data['usesProfile'] = profile
                data['usesSpent'] = max(0, numeric(uses.get('spent')) or 0)
            else:
                warnings.append({'type': 'Uses', 'reason': 'unsupported-formula', 'name': entry['name']})
        if source.get('startingEquipment'):
            # AND/OR equipment groups, abstract choices and optional starting
            # wealth need a dedicated choice flow. Keep portable metadata and
            # explicitly require that choice instead of granting all options.
            equipment = []
            for position, raw in enumerate(source['startingEquipment']):
                kind = raw.get('type', '')
                value = {'id': str(raw.get('_id') or position), 'type': kind,
                         'group': str(raw.get('group') or ''), 'quantity': max(1, int(numeric(raw.get('count')) or 1)),
                         'requiresProficiency': bool(raw.get('requiresProficiency'))}
                if kind == 'linked':
                    found = resolve(raw.get('key'), {})
                    if found:
                        value['itemId'] = found['id']
                    else:
                        value.update(manual=True, reason='not-in-licensed-catalog')
                elif kind == 'currency' and raw.get('key') in {'cp', 'sp', 'ep', 'gp', 'pp'}:
                    value['currency'] = raw['key']
                elif kind not in {'AND', 'OR'}:
                    value['selector'] = str(raw.get('key') or '') if re.fullmatch(r'[a-zA-Z0-9_-]*', str(raw.get('key') or '')) else ''
                    value['pool'] = equipment_pool(kind, value['selector'], edition, entries, documents)
                    if not value['pool']:
                        value.update(manual=True, reason='starting-equipment-pool-unavailable')
                equipment.append(value)
            if entry['type'] == 'background' and not any(row.get('currency') for row in equipment):
                # Upstream equipment rows omit the coins printed in the SRD
                # background package; recover only the explicit package amount.
                coins = re.search(r'\b(\d+)\s+GP\s*;\s*or\s*\(B\)', data.get('description', ''), re.I) if edition == '2024' else re.search(r'pouch containing (\d+) gp', data.get('description', ''), re.I)
                root_group = next((row['id'] for row in equipment if row['type'] == 'AND' and not row['group']), None)
                if coins and root_group:
                    equipment.append({'id': 'srd-package-coins', 'type': 'currency', 'group': root_group, 'quantity': int(coins[1]), 'currency': 'gp', 'requiresProficiency': False})
            profile = {'groups': equipment, 'manual': True}
            wealth = source.get('wealth')
            if numeric(wealth) is not None:
                profile['wealth'] = {'amount': numeric(wealth), 'currency': 'gp'}
            elif wealth and re.fullmatch(r'[0-9dD +*.-]+', str(wealth)):
                profile['wealth'] = {'formula': str(wealth), 'currency': 'gp', 'manual': True}
            data['startingEquipment'] = profile
            warnings.append({'type': 'StartingEquipment', 'reason': 'starting-equipment-choice-manual', 'name': entry['name']})

        advances = []
        for position, raw in enumerate(rows(document)):
            kind = raw.get('type')
            config = raw.get('configuration') or {}
            normalized = {'id': raw.get('_id') or str(uuid.uuid5(uuid.NAMESPACE_URL, entry['id'] + '/advancement/' + str(position))), 'type': kind,
                          'level': max(0, int(numeric(raw.get('level')) or 0)), 'title': clean(str(raw.get('title') or ''), document), 'configuration': {}}
            if raw.get('classRestriction') in {'primary', 'secondary'}:
                normalized['classRestriction'] = raw['classRestriction']
            if raw.get('hint'):
                normalized['hint'] = clean(raw['hint'], document)
            out = normalized['configuration']
            if kind == 'Trait':
                # The original Dragonborn choice must not permit an ancestry and
                # an unrelated resistance: the chosen derived breath grants both.
                if data.get('identifier') == 'dragonborn' and edition == '2014' and not config.get('grants') and any(str(x).startswith('dr:') for c in config.get('choices', []) for x in c.get('pool', [])):
                    continue
                out.update(mode=config.get('mode', 'default'), allowReplacements=bool(config.get('allowReplacements')),
                           grants=[result for grant in config.get('grants', []) if (result := trait(grant))],
                           choices=[{'count': max(0, int(numeric(choice.get('count')) or 0)), 'pool': [result for grant in choice.get('pool', []) if (result := trait(grant))]} for choice in config.get('choices', []) if any(trait(grant) for grant in choice.get('pool', []))])
            elif kind == 'Size':
                out['sizes'] = [SIZES[size] for size in config.get('sizes', []) if size in SIZES]
            elif kind == 'AbilityScoreImprovement':
                fixed = {ability: numeric(config.get('fixed', {}).get(ability)) or 0 for ability in ABILITIES}
                locked = [ability for ability in config.get('locked', []) if ability in ABILITIES]
                out.update(fixed=fixed, points=max(0, int(numeric(config.get('points')) or 0)), cap=max(0, int(numeric(config.get('cap')) or 2)),
                           max=numeric(config.get('max')) or 20, locked=locked, choices=[ability for ability in ABILITIES if ability not in locked and not fixed[ability]])
                if document.get('type') in {'class', 'subclass'}:
                    out['allowFeats'] = True
                if entry['type'] == 'background' and edition == '2024':
                    ability_names = dict(zip(ABILITIES, ('Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma')))
                    normalized['hint'] = 'Increase two different allowed abilities by 2 and 1, or all three by 1: ' + ', '.join(ability_names[ability] for ability in out['choices']) + '. Maximum score: ' + str(out['max']) + '.'
                if config.get('recommendation'):
                    found = resolve(config['recommendation'], raw)
                    if found:
                        out['recommendation'] = found['id']
            elif kind == 'ScaleValue':
                out.update(identifier=config.get('identifier') or re.sub(r'[^a-z0-9]+', '-', normalized['title'].lower()).strip('-'), type=config.get('type', 'number'), scale={})
                for level, value in config.get('scale', {}).items():
                    if not str(level).isdigit() or not isinstance(value, dict):
                        continue
                    if out['type'] == 'dice' and numeric(value.get('number')) is not None and numeric(value.get('faces')) is not None:
                        out['scale'][str(level)] = {'number': numeric(value['number']), 'faces': numeric(value['faces'])}
                    elif numeric(value.get('value')) is not None:
                        out['scale'][str(level)] = {'value': numeric(value['value'])}
                    elif isinstance(value.get('value'), str) and len(value['value']) <= 120 and not re.search(r'[@<>\[\]{}]', value['value']):
                        out['scale'][str(level)] = {'value': value['value']}
                if config.get('distance', {}).get('units'):
                    out['units'] = config['distance']['units']
            elif kind in {'ItemGrant', 'ItemChoice'}:
                unresolved = []
                if kind == 'ItemGrant':
                    out['items'] = []
                    for item in config.get('items', []):
                        found = resolve(item.get('uuid'), raw)
                        if found:
                            out['items'].append({'id': found['id'], 'optional': bool(item.get('optional', config.get('optional')))})
                        else:
                            unresolved.append(warning(raw, item.get('uuid')))
                    out['optional'] = bool(config.get('optional'))
                else:
                    out['choices'] = {str(level): {'count': max(0, int(numeric(choice.get('count')) or 0)), 'replacement': bool(choice.get('replacement'))} for level, choice in config.get('choices', {}).items() if str(level).isdigit() and isinstance(choice, dict)}
                    out['type'] = config.get('type', '')
                    out['restriction'] = {key: deepcopy(config.get('restriction', {}).get(key)) for key in ('type', 'subtype', 'level', 'list') if key in config.get('restriction', {})}
                    pool = []
                    for reference in config.get('pool', []):
                        found = resolve(reference, raw)
                        if found:
                            pool.append(found['id'])
                        else:
                            missing = warning(raw, reference.get('uuid') if isinstance(reference, dict) else reference, runtime=len(config.get('pool', [])) <= 1)
                            # Excluded optional choices are audited, not offered.
                            if not config.get('pool') or len(config.get('pool', [])) == 1:
                                unresolved.append(missing)
                    if not config.get('pool') and config.get('type') == 'spell':
                        restriction = config.get('restriction') or {}
                        classes = [str(value).removeprefix('class:') for value in restriction.get('list', []) if str(value).startswith('class:')]
                        spell_level = numeric(restriction.get('level'))
                        for candidate in entries:
                            cd = candidate['data']
                            if candidate['type'] != 'spell' or cd['rulesEdition'] != edition or spell_level is not None and numeric(cd.get('level')) != spell_level:
                                continue
                            if classes and not set(classes).intersection(cd.get('spellLists', [])):
                                continue
                            pool.append(candidate['id'])
                        if classes and not pool:
                            unresolved.append(warning(raw, '', 'spell-list-pool-unavailable'))
                    out['pool'] = list(dict.fromkeys(pool))
                if unresolved:
                    out['unresolved'] = unresolved
                spell = config.get('spell')
                if isinstance(spell, dict):
                    out['spell'] = {key: deepcopy(spell[key]) for key in ('ability', 'preparation', 'prepared', 'method') if key in spell}
                    if isinstance(spell.get('uses'), dict):
                        out['spell']['uses'] = {key: spell['uses'][key] for key in ('per', 'requireSlot') if key in spell['uses']}
                        profile = formula_profile(spell['uses'].get('max'))
                        if profile:
                            out['spell']['uses']['maxProfile'] = profile
            elif kind == 'Subclass':
                out['pool'] = [candidate['id'] for candidate in entries if candidate['data']['rulesEdition'] == edition and documents[candidate['id']].get('type') == 'subclass' and documents[candidate['id']].get('system', {}).get('classIdentifier') == source.get('identifier')]
            elif kind == 'HitPoints':
                out['hitDie'] = data.get('hit_die') or source.get('hitDice') or source.get('hd', {}).get('denomination') or ''
            else:
                normalized['manual'] = True
                warning(raw, '', 'unsupported-advancement-type')
            advances.append(normalized)
            report['advancements'][kind] += 1
        if advances:
            data['advancement'] = advances
        _effects(entry, document, clean, report)
        if warnings:
            data['advancementWarnings'] = warnings
    report['advancements'] = dict(report['advancements'])
    return report


def _effects(entry, document, clean, report):
    """Translate effects as templates first; only unambiguous passives activate."""
    data = entry['data']
    text = data.get('description', '')
    mechanics = dict(data.get('mechanicalTraits') or {})
    # Conditional advantage is contextual data, never an unconditional save bonus.
    if document.get('type') in {'feat', 'race'}:
        contexts = {'charmed': r'advantage on saving throws (?:you make )?to (?:avoid or end|avoid|end) the charmed condition|advantage on saving throws against being charmed',
                    'poisoned': r'advantage on saving throws against poison|advantage on saving throws (?:you make )?to (?:avoid or end|avoid|end) the poisoned condition',
                    'frightened': r'advantage on saving throws against being frightened|advantage on saving throws (?:you make )?to (?:avoid or end|avoid|end) the frightened condition'}
        matched = [key for key, pattern in contexts.items() if re.search(pattern, text, re.I)]
        if matched:
            mechanics['saveAdvantages'] = sorted(set(mechanics.get('saveAdvantages', []) + matched))
        if re.search(r'(?:magic can.t put you to sleep|immune to magical sleep)', text, re.I):
            mechanics['magicalSleepImmunity'] = True
        if re.search(r'(?:your speed is not reduced by wearing heavy armor)', text, re.I):
            mechanics['ignoreHeavyArmorSpeedPenalty'] = True
    templates, modifiers = [], list(data.get('modifiers') or [])
    belt_toughness = (data.get('rulesEdition') == '2024' and data.get('identifier') == 'belt-of-dwarvenkind'
                      and re.search(r'Your Constitution increases by 2, to a maximum of 20\.', text, re.I))
    damage = deepcopy(data.get('damageTraits') or {})
    active_ids = {str(item.get('_id')) for activity in document.get('system', {}).get('activities', {}).values() for item in activity.get('effects', []) if isinstance(item, dict)}
    mapped_targets = {'system.attributes.ac.bonus': 'ac', 'system.bonuses.abilities.save': 'roll.save', 'system.bonuses.abilities.check': 'roll.check',
                      'system.bonuses.msak.attack': 'spell.attack', 'system.bonuses.rsak.attack': 'spell.attack', 'system.bonuses.spell.dc': 'spell.dc', 'system.attributes.init.bonus': 'roll.initiative',
                      'system.bonuses.rwak.attack': 'weapon.attack.ranged'}
    for effect in document.get('effects', []):
        effect_id = str(effect.get('_id') or uuid.uuid5(uuid.NAMESPACE_URL, entry['id'] + '/effect/' + str(len(templates))))
        duration = effect.get('duration') or {}
        passive = entry['type'] != 'spell' and effect.get('transfer') is True and not effect.get('disabled') and effect_id not in active_ids and not duration.get('value') and not duration.get('rounds') and not duration.get('turns')
        template = {'id': effect_id, 'name': clean(str(effect.get('name') or entry['name']), document), 'passive': passive, 'enabled': not bool(effect.get('disabled')), 'changes': []}
        if duration.get('value') or duration.get('rounds') or duration.get('turns'):
            template['duration'] = {key: value for key, value in duration.items() if key in {'value', 'units', 'rounds', 'turns'} and value is not None}
        if effect.get('statuses'):
            template['conditions'] = [status for status in effect['statuses'] if status in CONDITIONS]
        unsupported = []
        for change in effect.get('system', {}).get('changes', effect.get('changes', [])):
            key, value = change.get('key', ''), change.get('value')
            op = change.get('type') or {2: 'add', 3: 'downgrade', 4: 'upgrade', 5: 'override', 1: 'multiply'}.get(change.get('mode'), '')
            number = numeric(value)
            normalized = None
            conditional = change.get('conditions') not in (None, '', '{}', {})
            if key in mapped_targets and op in {'add', 'subtract', 'override'} and number is not None:
                normalized = {'target': mapped_targets[key], 'operation': {'override': 'set'}.get(op, op), 'value': number}
            skill = re.fullmatch(r'system\.skills\.([a-z]+)\.bonuses\.check', key)
            if skill and skill[1] in SKILLS and op in {'add', 'subtract'}:
                target = 'roll.skill.' + SKILLS[skill[1]]
                if number is not None:
                    normalized = {'target': target, 'operation': op, 'value': number}
                elif formula_profile(value):
                    normalized = {'target': target, 'operation': op, 'valueProfile': formula_profile(value)}
            match = re.fullmatch(r'system\.abilities\.(str|dex|con|int|wis|cha)\.value', key)
            if match and op in {'add', 'subtract', 'upgrade', 'override'} and number is not None:
                normalized = {'target': 'ability.' + match[1] + '.score', 'operation': {'override': 'set', 'upgrade': 'minimum'}.get(op, op), 'value': number}
                ability_name = dict(zip(ABILITIES, ('Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma')))[match[1]]
                cap = re.search(r'Your ' + ability_name + r'(?: score)? increases by ' + str(number) + r', to a maximum of (\d+)', text, re.I)
                if op == 'add' and cap:
                    normalized['max'] = int(cap[1])
            match = re.fullmatch(r'system\.attributes\.(movement|senses)\.([a-z]+)', key)
            if match and (number is not None or formula_profile(value)) and op in {'add', 'subtract', 'upgrade', 'override', 'multiply'}:
                normalized = {'target': match[1] + '.' + match[2], 'operation': {'override': 'set', 'upgrade': 'minimum'}.get(op, op)}
                normalized.update({'value': number} if number is not None else {'valueProfile': formula_profile(value)})
            match = re.fullmatch(r'system\.traits\.(dr|di|dv|ci)\.value', key)
            if match and op == 'add' and isinstance(value, str) and value in (CONDITIONS if match[1] == 'ci' else DAMAGE_TYPES):
                normalized = {'target': {'dr': 'damage.resistance', 'di': 'damage.immunity', 'dv': 'damage.vulnerability', 'ci': 'condition.immunity'}[match[1]], 'operation': 'grant', 'value': value}
            if key == 'system.attributes.hp.bonuses.level' and op == 'add' and number is not None:
                normalized = {'target': 'hp.perLevel', 'operation': 'add', 'value': number}
            if key == 'system.attributes.hp.bonuses.overall' and op == 'add' and (number is not None or formula_profile(value)):
                normalized = {'target': 'hp.flat', 'operation': 'add', **({'value': number} if number is not None else {'valueProfile': formula_profile(value)})}
            if key == 'system.attributes.init.roll.mode' and number == 1:
                normalized = {'target': 'roll.initiative', 'operation': 'advantage'}
            if key == 'system.attributes.concentration.roll.mode' and number == 1:
                normalized = {'target': 'concentration', 'operation': 'advantage'}
            if key == 'system.attributes.ac.calc' and op == 'override' and value in {'unarmoredBarb', 'unarmoredMonk'}:
                normalized = {'target': 'ac.preset', 'operation': 'set', 'value': 'barbarian' if value == 'unarmoredBarb' else 'monk'}
            if not normalized or conditional:
                if key:
                    unsupported.append(key)
                continue
            if normalized not in template['changes']:
                template['changes'].append(normalized)
        if belt_toughness:
            # This source combines a universally passive benefit with optional
            # ancestry benefits in one disabled effect. Separate only the
            # explicit licensed passive; never turn disabled effects on globally.
            template['changes'] = [change for change in template['changes'] if change['target'] != 'ability.con.score']
        # E.g. Bracers of Defense require no armor or shield; a plain +2 would
        # silently automate the wrong AC. Preserve the guard declaratively.
        if re.search(r'(?:wear(?:ing)? no armor|aren.t wearing armor|not wearing armor)', text, re.I) and any(c['target'] == 'ac' for c in template['changes']):
            template['requirements'] = {'unarmored': True, 'noShield': bool(re.search(r'(?:no shield|not using a shield|aren.t using a shield)', text, re.I))}
            passive = template['passive'] = False
        if unsupported:
            template['manual'] = True
            report['manualEffects'].append({'entryId': entry['id'], 'effectId': effect_id, 'name': entry['name'], 'targets': unsupported})
        if template['changes'] or unsupported or template.get('conditions'):
            templates.append(template)
            report['effectTemplates'] += 1
        if passive:
            report['passiveEffects'] += 1
            for change in template['changes']:
                target = change['target']
                if target in {'damage.resistance', 'damage.immunity', 'damage.vulnerability'}:
                    group = {'damage.resistance': 'resistances', 'damage.immunity': 'immunities', 'damage.vulnerability': 'vulnerabilities'}[target]
                    damage[group] = sorted(set(damage.get(group, []) + [change['value']]))
                elif target == 'hp.perLevel':
                    mechanics['hpPerLevel'] = mechanics.get('hpPerLevel', 0) + change['value']
                elif target == 'hp.flat' and 'value' in change:
                    mechanics['hpFlat'] = mechanics.get('hpFlat', 0) + change['value']
                elif target == 'roll.initiative' and change['operation'] == 'advantage':
                    mechanics['initiativeAdvantage'] = True
                elif target == 'ac.preset':
                    mechanics['unarmoredDefense'] = change['value']
                elif target in mapped_targets.values() or target.startswith('roll.skill.'):
                    if change not in modifiers:
                        modifiers.append(change)
    if belt_toughness:
        templates.append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, entry['id'] + '/derived/passive-constitution')),
                          'name': 'Toughness', 'passive': True, 'enabled': True,
                          'changes': [{'target': 'ability.con.score', 'operation': 'add', 'value': 2, 'max': 20}]})
        report['effectTemplates'] += 1
        report['passiveEffects'] += 1
    if templates:
        data['effectTemplates'] = templates
    if modifiers:
        data['modifiers'] = modifiers
    if damage:
        data['damageTraits'] = damage
    if mechanics:
        data['mechanicalTraits'] = mechanics
