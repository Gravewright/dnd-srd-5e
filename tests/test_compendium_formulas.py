"""Focused converter checks using pinned local SRD fixtures, without network."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from dev_paths import require_srd_cache
SOURCE_CACHE = require_srd_cache('87e94dbd9f930135e0694cd7e7d49f210603cd2c')
spec = importlib.util.spec_from_file_location('build_compendiums', ROOT / 'scripts/build_compendiums.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.CACHE = SOURCE_CACHE


class FormulaConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = {}
        for edition in ['2014', '2024']:
            collection = json.loads((ROOT / 'compendiums' / f'{edition}.json').read_text(encoding='utf-8'))
            for pack in collection['packs']:
                for entry in pack['entries']:
                    if entry['type'] == 'spell':
                        cls.records[edition, entry['name']] = entry

    def profile(self, edition, name):
        entry = self.records[edition, name]
        source_path = SOURCE_CACHE / builder.COMMIT / entry['data']['provenance']['sourcePath']
        source = builder.load(source_path)['system']
        return builder.spell_formula_profile(source, entry['data']['description'], name, edition)

    def test_typed_grammar_preserves_only_defined_spell_modifier(self):
        self.assertEqual(builder.formula_terms('2d8 + @mod'), {'dice': [{'number': 2, 'faces': 8}], 'constant': 0, 'spellModifier': True})
        for formula in ['1d8 + @item.level', '1d8;alert(1)', '__import__(os)', '1d8+@mod+@mod', '1d8-@mod', '1d8junk', '2d6*2']:
            self.assertIsNone(builder.formula_terms(formula), formula)
        self.assertIsNone(builder.part_terms({'number': 1, 'denomination': 8, 'bonus': '@item.uses.value'}))

    def test_fire_bolt_and_other_cantrips_scale_dice_not_spell_modifier(self):
        for edition in ['2014', '2024']:
            for name, faces in [('Fire Bolt', 10), ('Ray of Frost', 8), ('Sacred Flame', 8)]:
                with self.subTest(edition=edition, name=name):
                    p = self.profile(edition, name)
                    self.assertEqual(p['base']['dice'], [{'number': 1, 'faces': faces}])
                    self.assertFalse(p['base']['spellModifier'])
                    self.assertEqual(p['scaling']['dice'], [{'number': 1, 'faces': faces}])
                    self.assertEqual(p['scaling']['thresholds'], [5, 11, 17])

    def test_healing_preserves_edition_and_one_spellcasting_modifier(self):
        for edition, count in [('2014', 1), ('2024', 2)]:
            for name, faces in [('Cure Wounds', 8), ('Healing Word', 4)]:
                with self.subTest(edition=edition, name=name):
                    p = self.profile(edition, name)
                    self.assertEqual(p['kind'], 'healing')
                    self.assertEqual(p['base']['dice'], [{'number': count, 'faces': faces}])
                    self.assertTrue(p['base']['spellModifier'])
                    self.assertEqual(p['scaling']['dice'], [{'number': count, 'faces': faces}])
                    self.assertFalse(p['critical'])

    def test_flame_blade_and_spiritual_weapon_keep_edition_specific_rules(self):
        for edition, modifier, interval in [('2014', False, 2), ('2024', True, 1)]:
            p = self.profile(edition, 'Flame Blade')
            self.assertEqual(p['base']['dice'], [{'number': 3, 'faces': 6}])
            self.assertEqual(p['base']['spellModifier'], modifier)
            self.assertEqual(p['scaling']['interval'], interval)
            p = self.profile(edition, 'Spiritual Weapon')
            self.assertTrue(p['base']['spellModifier'])
            self.assertEqual(p['scaling']['interval'], interval)

    def test_damage_and_temporary_hp_do_not_gain_universal_attribute_bonus(self):
        for edition in ['2014', '2024']:
            p = self.profile(edition, 'Fireball')
            self.assertFalse(p['base']['spellModifier'])
            self.assertFalse(p['critical'])
            self.assertEqual(p['scaling']['dice'], [{'number': 1, 'faces': 6}])
            p = self.profile(edition, 'False Life')
            self.assertEqual(p['kind'], 'temporary')
            self.assertFalse(p['base']['spellModifier'])
            self.assertEqual(p['scaling']['constant'], 5)

    def test_persistent_spell_weapons_keep_attack_and_damage_type(self):
        for edition in ['2014', '2024']:
            for name, damage_type, formula in [('Flame Blade', 'fire', '3d6'), ('Spiritual Weapon', 'force', '1d8')]:
                with self.subTest(edition=edition, name=name):
                    entry = self.records[edition, name]
                    path = SOURCE_CACHE / builder.COMMIT / entry['data']['provenance']['sourcePath']
                    _, data = builder.convert(builder.load(path), entry['data']['provenance']['sourcePath'].split('/')[2], edition, entry['data']['description'], {})
                    self.assertEqual(data['resolution'], 'attack_melee')
                    self.assertEqual(data['damage_type'], damage_type)
                    self.assertEqual(data['damage'], formula)
                    self.assertEqual(data['rulesEdition'], edition)

    def test_more_projectiles_do_not_multiply_damage_per_projectile(self):
        for edition in ['2014', '2024']:
            for name, unit in [('Eldritch Blast', 'beam'), ('Scorching Ray', 'beam'), ('Magic Missile', 'dart')]:
                p = self.profile(edition, name)
                self.assertEqual(p['unit'], unit)
                self.assertNotIn('scaling', p)
                self.assertEqual(p['count']['increment'], 1)
            self.assertFalse(self.profile(edition, 'Magic Missile')['critical'])

    def test_mixed_damage_and_prismatic_colors_do_not_offer_generic_application(self):
        for edition in ['2014', '2024']:
            for name in ['Ice Storm', 'Flame Strike', 'Meteor Swarm', 'Prismatic Spray']:
                with self.subTest(edition=edition, name=name):
                    entry = self.records[edition, name]
                    path = SOURCE_CACHE / builder.COMMIT / entry['data']['provenance']['sourcePath']
                    _, data = builder.convert(builder.load(path), entry['data']['provenance']['sourcePath'].split('/')[2], edition, entry['data']['description'], {})
                    self.assertTrue(data['formulaProfile']['applicationManual'])
                    self.assertEqual(data['formulaProfile']['kind'], 'damage')
                    self.assertTrue(data['formulaProfile']['base']['dice'])
            self.assertNotIn('applicationManual', self.profile(edition, 'Fireball'))

    def test_secondary_effects_do_not_turn_into_generic_healing(self):
        for edition in ['2014', '2024']:
            p = self.profile(edition, 'Aid')
            self.assertTrue(p['manual'])
            self.assertTrue(p['applicationManual'])

    def test_casting_action_keeps_bonus_reaction_and_long_casts(self):
        for edition in ['2014', '2024']:
            for name, expected in [('Healing Word', 'bonus'), ('Shield', 'reaction'), ('Cure Wounds', 'action'), ('Prayer of Healing', 'long')]:
                entry = self.records[edition, name]
                path = SOURCE_CACHE / builder.COMMIT / entry['data']['provenance']['sourcePath']
                doc = builder.load(path)
                _, data = builder.convert(doc, entry['data']['provenance']['sourcePath'].split('/')[2], edition, entry['data']['description'], {})
                self.assertEqual(data['actionType'], expected, (edition, name))

    def test_partial_rest_recovery_and_manual_limits_survive_conversion(self):
        for edition in ['2014', '2024']:
            collection = json.loads((ROOT / 'compendiums' / f'{edition}.json').read_text(encoding='utf-8'))
            entry = next(e for p in collection['packs'] for e in p['entries'] if e['type'] == 'feature' and e['name'] == 'Second Wind')
            path = SOURCE_CACHE / builder.COMMIT / entry['data']['provenance']['sourcePath']
            _, data = builder.convert(builder.load(path), entry['data']['provenance']['sourcePath'].split('/')[2], edition, entry['data']['description'], {})
            self.assertEqual(data['recovery']['long'], {'mode': 'all'})
            self.assertEqual(data['recovery']['short'], {'mode': 'all'} if edition == '2014' else {'mode': 'amount', 'amount': 1})
            if edition == '2024':
                self.assertEqual(data['uses']['max'], 0)
                self.assertIn('configure manually', data['usesGuidance'])

    def test_generated_profiles_contain_only_typed_non_executable_terms(self):
        for entry in self.records.values():
            p = entry['data'].get('formulaProfile')
            if not p:
                continue
            self.assertEqual(p['version'], 1)
            self.assertIn(p['kind'], ['damage', 'healing', 'temporary'])
            self.assertNotIn('@', json.dumps(p))
            self.assertIsInstance(p['base']['constant'], (int, float))
            self.assertIsInstance(p['base']['spellModifier'], bool)
            for term in p['base']['dice'] + p.get('scaling', {}).get('dice', []):
                self.assertGreater(term['number'], 0)
                self.assertGreaterEqual(term['faces'], 2)


if __name__ == '__main__':
    unittest.main()
