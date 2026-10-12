"""Offline contract checks against the pinned, licensed SRD catalog and YAML.

The tests rebuild typed data in memory. They never modify generated packs and
do not depend on a running VTT, database, network, or Foundry runtime.
"""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from dev_paths import require_srd_cache
SOURCE_CACHE = require_srd_cache('87e94dbd9f930135e0694cd7e7d49f210603cd2c')
spec = importlib.util.spec_from_file_location('build_compendiums', ROOT / 'scripts/build_compendiums.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.CACHE = SOURCE_CACHE
from advancement_data import formula_profile, normalize_catalog, rows, source_id


class FormulaProfileTests(unittest.TestCase):
    def test_supported_variables_have_typed_non_executable_leaves(self):
        cases = {
            '@prof': {'type': 'proficiency'},
            '@abilities.cha.mod': {'type': 'abilityModifier', 'ability': 'cha'},
            '@classes.paladin.levels': {'type': 'classLevel', 'classId': 'paladin'},
            '@scale.fighter.action-surge': {'type': 'scale', 'classId': 'fighter', 'identifier': 'action-surge'},
            '@details.level': {'type': 'level'},
            '@attributes.movement.walk': {'type': 'movement', 'mode': 'walk'},
        }
        for expression, expected in cases.items():
            with self.subTest(expression=expression):
                self.assertEqual(formula_profile(expression), expected)
        self.assertEqual(formula_profile('max(1, @abilities.cha.mod)'), {
            'type': 'max', 'args': [{'type': 'constant', 'value': 1}, {'type': 'abilityModifier', 'ability': 'cha'}]})
        self.assertEqual(formula_profile('5 * @classes.paladin.levels'), {
            'type': 'multiply', 'args': [{'type': 'constant', 'value': 5}, {'type': 'classLevel', 'classId': 'paladin'}]})

    def test_unknown_macros_code_and_invalid_arithmetic_remain_manual(self):
        for expression in ('@item.level', '@mod', '@prof.foo', 'alert(1)', '__import__("os")',
                           '1; print(1)', '[1,2]', '2**8', 'True', '"2"', 'max(x=1)',
                           'ceil(1,2)', 'nan', '1e99', '@abilities.str.mod.__class__'):
            with self.subTest(expression=expression):
                self.assertIsNone(formula_profile(expression))

    def test_portable_reference_parser_accepts_only_known_foundry_item_shape(self):
        self.assertEqual(source_id('Compendium.dnd5e.races.Item.abc123'), ('races', 'abc123'))
        self.assertEqual(source_id({'uuid': 'Compendium.dnd5e.races.abc123'}), ('races', 'abc123'))
        for value in ('Actor.xyz', 'Compendium.other.races.Item.abc', '@UUID[Compendium.dnd5e.races.abc]',
                      'Compendium.dnd5e.races.Item.abc;alert(1)'):
            self.assertIsNone(source_id(value))


class CatalogAdvancementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original, cls.documents, cls.names = [], {}, {}
        for edition in ('2014', '2024'):
            collection = json.loads((ROOT / 'compendiums' / f'{edition}.json').read_text(encoding='utf-8'))
            accepted = [entry for pack in collection['packs'] for entry in pack['entries']
                        if not entry['data']['provenance'].get('derivedFrom')]
            spell_names = {builder.norm(entry['name']) for entry in accepted if entry['type'] == 'spell'}
            _, official_spells, _ = builder.read_pdf(edition, spell_names)
            spell_lists = builder.read_spell_lists(edition, spell_names, official_spells)
            for existing in accepted:
                provenance = existing['data']['provenance']
                document = builder.load(builder.CACHE / builder.COMMIT / provenance['sourcePath'])
                cls.documents[existing['id']] = document
                cls.names[provenance['sourceId']] = document['name']
            # Re-convert the accepted source, rather than using stale generated
            # automation metadata. The original catalog remains the allowlist.
            for existing in accepted:
                document = cls.documents[existing['id']]
                provenance = existing['data']['provenance']
                pack = provenance['sourcePath'].split('/')[2]
                kind, data = builder.convert(document, pack, edition, existing['data']['description'], cls.names)
                data['provenance'] = deepcopy(provenance)
                if kind == 'spell':
                    data['spellLists'] = spell_lists.get(builder.norm(existing['name']), [])
                cls.original.append({**deepcopy(existing), 'type': kind, 'data': data})
        cls.entries, cls.normalized_documents = deepcopy(cls.original), deepcopy(cls.documents)
        cls.report = normalize_catalog(cls.entries, cls.normalized_documents, cls.names,
                                       lambda raw, doc: builder.prose(raw, cls.names, doc))
        cls.by_id = {entry['id']: entry for entry in cls.entries}
        cls.by_name = {(entry['data']['rulesEdition'], entry['name']): entry for entry in cls.entries}

    def entry(self, edition, name):
        return self.by_name[edition, name]

    def advances(self, edition, name, kind):
        return [row for row in self.entry(edition, name)['data'].get('advancement', []) if row['type'] == kind]

    def test_original_ids_provenance_and_allowlist_are_preserved(self):
        self.assertEqual(len(self.by_id), len(self.entries))
        for original in self.original:
            current = self.by_id[original['id']]
            self.assertEqual(current['data']['provenance'], original['data']['provenance'])
            self.assertEqual(current['name'], original['name'])
            self.assertEqual(current['type'], original['type'])
        self.assertEqual(len(self.entries), len(self.original) + 11)
        self.assertEqual(len(self.report['derived']), 11)

    def test_every_exported_reference_resolves_within_its_edition(self):
        for entry in self.entries:
            for row in entry['data'].get('advancement', []):
                config = row['configuration']
                references = [item['id'] for item in config.get('items', [])]
                if row['type'] in {'ItemChoice', 'Subclass'}:
                    references.extend(config.get('pool', []))
                if config.get('recommendation'):
                    references.append(config['recommendation'])
                for reference in references:
                    with self.subTest(entry=entry['name'], advancement=row['id'], reference=reference):
                        self.assertIn(reference, self.by_id)
                        self.assertEqual(self.by_id[reference]['data']['rulesEdition'], entry['data']['rulesEdition'])
                self.assertNotRegex(json.dumps(config), r'Compendium\.|@UUID|\[\[/|<script')

    def test_every_licensed_race_has_movement_size_and_resolved_benefits(self):
        races = [entry for entry in self.entries if entry['type'] == 'race']
        self.assertEqual(len(races), 23)
        for race in races:
            with self.subTest(race=race['name'], edition=race['data']['rulesEdition']):
                self.assertGreater(race['data']['movement']['walk'], 0)
                self.assertEqual(race['data']['movement']['units'], 'ft')
                self.assertTrue(any(row['type'] == 'Size' for row in race['data']['advancement']))
                self.assertFalse(race['data'].get('advancementWarnings'))
                for row in race['data']['advancement']:
                    self.assertFalse(row['configuration'].get('unresolved'))
        self.assertEqual(self.entry('2024', 'Dwarf')['data']['senses']['darkvision'], 120)
        self.assertEqual(self.entry('2014', 'Hill Dwarf')['data']['movement']['walk'], 25)

    def test_dragonborn_ancestry_links_resistance_and_licensed_breath(self):
        dragonborn = self.entry('2014', 'Dragonborn')
        pool = self.advances('2014', 'Dragonborn', 'ItemChoice')[0]['configuration']['pool']
        self.assertEqual(len(pool), 10)
        colors = {'Black': ('acid', 'line', 'dex'), 'Blue': ('lightning', 'line', 'dex'),
                  'Brass': ('fire', 'line', 'dex'), 'Bronze': ('lightning', 'line', 'dex'),
                  'Copper': ('acid', 'line', 'dex'), 'Gold': ('fire', 'cone', 'dex'),
                  'Green': ('poison', 'cone', 'con'), 'Red': ('fire', 'cone', 'dex'),
                  'Silver': ('cold', 'cone', 'con'), 'White': ('cold', 'cone', 'con')}
        for reference in pool:
            child = self.by_id[reference]
            color = child['name'].split()[0]
            damage, shape, save = colors[color]
            self.assertEqual(child['id'], str(uuid.uuid5(uuid.NAMESPACE_URL, dragonborn['id'] + '/derived/breath-weapon-' + color.lower())))
            self.assertEqual(child['data']['provenance']['derivedFrom'], dragonborn['id'])
            self.assertEqual(child['data']['damageTraits']['resistances'], [damage])
            self.assertEqual(child['data']['breathWeapon']['shape'], shape)
            self.assertEqual(child['data']['breathWeapon']['saveAbility'], save)
            self.assertEqual(child['data']['breathWeapon']['scale']['16'], {'number': 5, 'faces': 6})
            self.assertEqual(child['data']['uses'], {'value': 1, 'max': 1})
        self.assertFalse(any(str(choice).startswith('dr:') for row in dragonborn['data']['advancement']
                             if row['type'] == 'Trait' for choices in row['configuration']['choices'] for choice in choices['pool']))

    def test_hill_dwarf_toughness_contributes_from_one_child_only(self):
        parent = self.entry('2014', 'Hill Dwarf')
        children = [self.by_id[item['id']] for row in parent['data']['advancement'] if row['type'] == 'ItemGrant'
                    for item in row['configuration']['items']]
        toughness = next(child for child in children if child['name'] == 'Dwarven Toughness')
        self.assertEqual(toughness['data']['mechanicalTraits']['hpPerLevel'], 1)
        self.assertNotIn('hpPerLevel', parent['data'].get('mechanicalTraits', {}))
        self.assertEqual(sum(child['data'].get('mechanicalTraits', {}).get('hpPerLevel', 0) for child in children), 1)
        self.assertEqual(self.entry('2024', 'Dwarven Toughness')['data']['mechanicalTraits']['hpPerLevel'], 1)

    def test_background_asi_and_recursive_magic_initiate_grant(self):
        config = self.advances('2024', 'Acolyte', 'AbilityScoreImprovement')[0]['configuration']
        self.assertEqual((config['points'], config['cap'], config['max']), (3, 2, 20))
        self.assertEqual(config['choices'], ['int', 'wis', 'cha'])
        self.assertEqual(sum(config['fixed'].values()), 0)
        grants = self.advances('2024', 'Acolyte', 'ItemGrant')[0]['configuration']['items']
        feat = self.by_id[grants[0]['id']]
        self.assertIn('Magic Initiate', feat['name'])
        self.assertTrue(any(row['type'] == 'ItemChoice' and row['configuration']['pool'] for row in feat['data']['advancement']))

    def test_cantrip_pools_use_official_class_lists_not_all_spells(self):
        config = self.advances('2014', 'High Elf', 'ItemChoice')[0]['configuration']
        pool = [self.by_id[reference] for reference in config['pool']]
        self.assertIn('Fire Bolt', [entry['name'] for entry in pool])
        self.assertNotIn('Guidance', [entry['name'] for entry in pool])
        for entry in pool:
            self.assertEqual(entry['data']['level'], 0)
            self.assertIn('wizard', entry['data']['spellLists'])
        for entry in self.entries:
            if entry['type'] == 'spell':
                self.assertTrue(entry['data']['spellLists'], entry['name'])

    def test_class_metadata_restrictions_subclasses_and_scale_values(self):
        for edition in ('2014', '2024'):
            for name, progression, hit_die in [('Bard', 'full', 'd8'), ('Paladin', 'half', 'd10'), ('Warlock', 'pact', 'd8')]:
                data = self.entry(edition, name)['data']
                self.assertEqual(data['spellcasting']['progression'], progression)
                self.assertEqual(data['hit_die'], hit_die)
                self.assertEqual(self.advances(edition, name, 'HitPoints')[0]['configuration']['hitDie'], hit_die)
            primary_saves = [row for row in self.advances(edition, 'Druid', 'Trait')
                             if any(value.startswith('saves:') for value in row['configuration']['grants'])]
            self.assertTrue(primary_saves)
            self.assertTrue(all(row.get('classRestriction') == 'primary' for row in primary_saves))
            champion = self.entry(edition, 'Champion')
            self.assertEqual(champion['type'], 'feature')
            self.assertTrue(champion['data']['subclass'])
            self.assertEqual(champion['data']['classIdentifier'], 'fighter')
            self.assertIn(champion['id'], self.advances(edition, 'Fighter', 'Subclass')[0]['configuration']['pool'])
        scale = next(row for row in self.advances('2024', 'Bard', 'ScaleValue') if row['configuration']['identifier'] == 'max-prepared')
        self.assertGreater(scale['configuration']['scale']['20']['value'], 0)

    def test_excluded_optional_styles_are_audited_without_blocking_allowed_choices(self):
        champion = self.entry('2024', 'Champion')
        config = self.advances('2024', 'Champion', 'ItemChoice')[0]['configuration']
        self.assertEqual({self.by_id[reference]['name'] for reference in config['pool']},
                         {'Archery', 'Defense', 'Great Weapon Fighting', 'Two-Weapon Fighting'})
        self.assertFalse(config.get('unresolved'))
        self.assertFalse(champion['data'].get('advancementWarnings'))
        excluded = [row for row in self.report['unresolved'] if row['entryName'] == 'Champion']
        self.assertEqual(len(excluded), 6)
        mandatory = [row for row in self.report['unresolved'] if row['entryName'] != 'Champion']
        self.assertEqual(len(mandatory), 3)
        self.assertEqual({row['entryName'] for row in mandatory}, {'Barbarian', 'Monk'})
        self.assertTrue(self.entry('2024', 'Monk')['data']['advancementWarnings'])

    def test_class_asi_allows_typed_feat_alternative_and_prerequisites(self):
        for edition in ('2014', '2024'):
            self.assertTrue(all(row['configuration']['allowFeats'] for row in self.advances(edition, 'Fighter', 'AbilityScoreImprovement')))
        alert = self.entry('2024', 'Alert')['data']
        grappler = self.entry('2024', 'Grappler')['data']
        boon = self.entry('2024', 'Boon of Combat Prowess')['data']
        self.assertEqual((alert['featCategory'], alert['prerequisiteLevel']), ('origin', 0))
        self.assertEqual((grappler['featCategory'], grappler['prerequisiteLevel']), ('general', 4))
        self.assertEqual((boon['featCategory'], boon['prerequisiteLevel']), ('epicBoon', 19))
        self.assertIn('13+', grappler['requirements'])
        self.assertFalse(any(row['configuration'].get('allowFeats') for row in self.advances('2024', 'Grappler', 'AbilityScoreImprovement')))
        self.assertEqual((self.entry('2014', 'Ascendant Step')['data']['prerequisiteClass'], self.entry('2014', 'Ascendant Step')['data']['prerequisiteLevel']), ('warlock', 9))
        self.assertEqual((self.entry('2024', 'Ascendant Step')['data']['prerequisiteClass'], self.entry('2024', 'Ascendant Step')['data']['prerequisiteLevel']), ('warlock', 5))
        self.assertIn('pact-of-the-blade', self.entry('2024', 'Lifedrinker')['data']['prerequisiteItems'])
        self.assertIn('pact-of-the-blade', self.entry('2024', 'Thirsting Blade')['data']['prerequisiteItems'])

    def test_shared_class_availability_is_an_or_list_not_all_requirements(self):
        archery = self.entry('2014', 'Archery')['data']
        self.assertEqual(archery['prerequisiteAlternatives'], [
            {'classId': 'fighter', 'level': 1},
            {'classId': 'fighter', 'subclassId': 'champion', 'level': 10},
            {'classId': 'ranger', 'level': 2},
        ])
        self.assertNotIn('prerequisiteClass', archery)
        self.assertEqual(archery['prerequisiteItems'], [])
        evasion = next(entry['data'] for entry in self.entries if entry['name'] == 'Evasion' and entry['data'].get('requirements') == 'Monk 7, Rogue 7')
        self.assertEqual(evasion['prerequisiteAlternatives'], [{'classId': 'monk', 'level': 7}, {'classId': 'rogue', 'level': 7}])
        for name in ('Archery', 'Defense', 'Great Weapon Fighting', 'Two-Weapon Fighting'):
            self.assertEqual(self.entry('2024', name)['data']['prerequisiteItems'], ['fighting-style'])

    def test_starting_equipment_preserves_choices_quantities_and_manual_warning(self):
        fighter = self.entry('2024', 'Fighter')['data']
        profile = fighter['startingEquipment']
        self.assertTrue(profile['manual'])
        self.assertEqual(profile['wealth'], {'amount': 155, 'currency': 'gp'})
        self.assertTrue(any(row['type'] == 'OR' for row in profile['groups']))
        arrows = next(row for row in profile['groups'] if row.get('itemId') and self.by_id[row['itemId']]['name'] == 'Arrows')
        self.assertEqual(arrows['quantity'], 20)
        self.assertEqual({row['quantity'] for row in profile['groups'] if row.get('currency') == 'gp'}, {4, 11})
        self.assertTrue(any(row['reason'] == 'starting-equipment-choice-manual' for row in fighter['advancementWarnings']))
        self.assertNotRegex(json.dumps(profile), r'Compendium\.|@UUID|\[\[/')
        criminal = self.entry('2024', 'Criminal')['data']
        self.assertFalse(any(not choice['pool'] for row in criminal['advancement'] if row['type'] == 'Trait' for choice in row['configuration']['choices']))
        asi = next(row for row in criminal['advancement'] if row['type'] == 'AbilityScoreImprovement')
        self.assertEqual(asi['configuration']['choices'], ['dex', 'con', 'int'])
        self.assertNotIn('Charisma', asi['hint'])
        for name, coins in [('Acolyte', 8), ('Criminal', 16), ('Sage', 8), ('Soldier', 14)]:
            data = self.entry('2024', name)['data']
            self.assertEqual(sum(row['quantity'] for row in data['startingEquipment']['groups'] if row.get('currency') == 'gp'), coins)
        self.assertEqual(sum(row['quantity'] for row in self.entry('2014', 'Acolyte')['data']['startingEquipment']['groups'] if row.get('currency') == 'gp'), 15)

    def test_starting_selectors_only_offer_licensed_mundane_items(self):
        for entry in self.entries:
            for row in entry['data'].get('startingEquipment', {}).get('groups', []):
                if 'selector' not in row:
                    continue
                self.assertTrue(row.get('pool') or row.get('manual'), (entry['name'], row))
                for reference in row.get('pool', []):
                    candidate = self.by_id[reference]
                    self.assertEqual(candidate['data']['rulesEdition'], entry['data']['rulesEdition'])
                    source = self.normalized_documents[reference]['system']
                    self.assertFalse(source.get('rarity'))
                    if row['type'] == 'weapon':
                        self.assertEqual(candidate['type'], 'weapon')
                    if row['type'] == 'tool':
                        self.assertEqual(self.normalized_documents[reference]['type'], 'tool')
        fighter = self.entry('2014', 'Fighter')['data']
        martial = next(row for row in fighter['startingEquipment']['groups'] if row.get('selector') == 'martialM')
        self.assertIn('Longsword', [self.by_id[reference]['name'] for reference in martial['pool']])
        self.assertNotIn('Longbow', [self.by_id[reference]['name'] for reference in martial['pool']])

    def test_unarmored_defense_presets_come_from_explicit_effect_calculations(self):
        for edition in ('2014', '2024'):
            presets = {entry['data'].get('mechanicalTraits', {}).get('unarmoredDefense') for entry in self.entries
                       if entry['data']['rulesEdition'] == edition}
            self.assertTrue({'barbarian', 'monk'}.issubset(presets))

    def test_attunement_bonuses_passive_effects_and_uses_are_typed_once(self):
        for edition in ('2014', '2024'):
            data = self.entry(edition, 'Staff of Power')['data']
            self.assertTrue(data['requiresAttunement'])
            self.assertEqual(data['magicBonus'], 2)
            self.assertEqual(data['usesProfile'], {'type': 'constant', 'value': 20})
            self.assertEqual([value for value in data['modifiers'] if value['target'] == 'spell.attack'],
                             [{'target': 'spell.attack', 'operation': 'add', 'value': 2}])
            amulet = self.entry(edition, 'Amulet of Health')['data']
            self.assertEqual(amulet['effectTemplates'][0]['changes'], [{'target': 'ability.con.score', 'operation': 'minimum', 'value': 19}])
            self.assertTrue(amulet['effectTemplates'][0]['passive'])
            bracers = self.entry(edition, 'Bracers of Defense')['data']
            self.assertFalse(bracers['effectTemplates'][0]['passive'])
            self.assertEqual(bracers['effectTemplates'][0]['requirements'], {'unarmored': True, 'noShield': True})
            self.assertNotIn('modifiers', bracers)
            archery = self.entry(edition, 'Archery')['data']
            self.assertEqual(archery['modifiers'], [{'target': 'weapon.attack.ranged', 'operation': 'add', 'value': 2}])
            self.assertTrue(archery['effectTemplates'][0]['passive'])
        belt = self.entry('2014', 'Belt of Dwarvenkind')['data']
        change = next(change for change in belt['effectTemplates'][0]['changes'] if change['target'] == 'ability.con.score')
        self.assertEqual(change['max'], 20)
        revised_belt = self.entry('2024', 'Belt of Dwarvenkind')['data']
        passive_constitution = [change for effect in revised_belt['effectTemplates'] if effect['passive'] and effect['enabled']
                                for change in effect['changes'] if change['target'] == 'ability.con.score']
        self.assertEqual(passive_constitution, [{'target': 'ability.con.score', 'operation': 'add', 'value': 2, 'max': 20}])
        original = next(effect for effect in revised_belt['effectTemplates'] if effect['id'] == 'HNruvcSEl25DRvjj')
        self.assertFalse(original['enabled'])
        self.assertFalse(original['passive'])
        self.assertFalse(any(change['target'] == 'ability.con.score' for change in original['changes']))
        boots = self.entry('2024', 'Boots of Speed')['data']['effectTemplates'][0]
        self.assertFalse(boots['passive'])
        self.assertEqual(boots['duration']['value'], 600)

    def test_spells_and_activated_effects_never_auto_apply_on_ownership(self):
        for entry in self.entries:
            if entry['type'] == 'spell':
                self.assertFalse(any(effect['passive'] for effect in entry['data'].get('effectTemplates', [])), entry['name'])
                self.assertNotIn('modifiers', entry['data'], entry['name'])
                self.assertNotIn('mechanicalTraits', entry['data'], entry['name'])

    def test_contextual_advantages_do_not_become_generic_save_modifiers(self):
        elf = self.entry('2014', 'High Elf')['data']
        self.assertEqual(elf['mechanicalTraits']['saveAdvantages'], ['charmed'])
        self.assertTrue(elf['mechanicalTraits']['magicalSleepImmunity'])
        dwarf = self.entry('2014', 'Hill Dwarf')['data']
        self.assertEqual(dwarf['mechanicalTraits']['saveAdvantages'], ['poisoned'])
        self.assertTrue(dwarf['mechanicalTraits']['ignoreHeavyArmorSpeedPenalty'])
        self.assertNotIn('modifiers', elf)
        self.assertNotIn('modifiers', dwarf)

    def test_rebuild_from_same_inputs_is_deterministic(self):
        entries, documents = deepcopy(self.original), deepcopy(self.documents)
        report = normalize_catalog(entries, documents, self.names, lambda raw, doc: builder.prose(raw, self.names, doc))
        self.assertEqual(entries, self.entries)
        self.assertEqual(report, self.report)


if __name__ == '__main__':
    unittest.main()
