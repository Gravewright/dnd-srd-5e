"""External SRD combat regressions; all databases and sheets are disposable."""
from copy import deepcopy
from unittest.mock import patch
from types import SimpleNamespace
import uuid

from django.test import SimpleTestCase, TestCase
from gravewright.actors.models import Actor
from gravewright.dice.engine import evaluate
from gravewright.maps.models import Scene
from gravewright.maps.services import MapError
from gravewright.table.tests import test_modules as fixtures
from gravewright.tokens.models import Token
from gravewright.combat import effects, services, providers
from gravewright.combat.models import Encounter
from .combat import prepare_initiative, apply_damage, apply_healing, advance_effects, _tick_effect


class SystemCallbackTests(SimpleTestCase):
    def event(self, **values):
        return {'phase': 'start', 'periodic': True, 'isCurrent': True,
                'tokenId': 'token', 'actorId': 'actor', 'ownerTokenId': '',
                'ownerActorId': 'actor', 'documentKey': ('actor', 'actor'),
                'clockKeys': set(), 'conditions': [], 'actorType': 'character', **values}

    def test_ready_registers_only_the_exact_system_with_public_callbacks(self):
        provider = providers.get('gravewright.5e-srd')
        self.assertIs(provider.prepare_initiative, prepare_initiative)
        self.assertIs(provider.advance_effects, advance_effects)
        self.assertIsNone(providers.get('dnd5e'))

    def test_explicit_clocks_deduplicate_and_informational_durations_stay_manual(self):
        explicit = {'data': {'duration': {'type': 'rounds', 'value': 3, 'expires': 'start'}}}
        manual = {'data': {'duration': {'type': 'rounds', 'value': 3}}}
        data = {'effects': [explicit, manual]}
        event = self.event(periodic=False, roundBoundary=True)
        self.assertTrue(advance_effects(data, event))
        self.assertEqual(explicit['data']['duration']['remaining'], 2)
        self.assertNotIn('remaining', manual['data']['duration'])
        self.assertFalse(advance_effects(data, event))
        self.assertEqual(explicit['data']['duration']['remaining'], 2)

    def test_independent_token_event_does_not_advance_linked_actor_owner_clock(self):
        own = {'data': {'duration': {'type': 'turns', 'value': 2, 'expires': 'start'}}}
        explicit = {'data': {'duration': {'type': 'turns', 'value': 2, 'expires': 'start', 'sourceActorId': 'actor'}}}
        data = {'effects': [own, explicit]}
        self.assertTrue(advance_effects(data, self.event(isCurrent=False, tokenId='independent')))
        self.assertNotIn('remaining', own['data']['duration'])
        self.assertEqual(explicit['data']['duration']['remaining'], 1)

    def test_periodic_items_require_equipment_attunement_enabled_and_condition(self):
        base = {'data': {'requiresAttunement': True, 'condition': '@sheet.level >= 2',
                         'modifiers': [{'target': 'damage.self', 'operation': 'damage_over_time', 'value': '1 + 2', 'damageType': 'fire'}]}}
        for equipped, attuned, enabled, level, expected in [
            (False, True, True, 2, 20), (True, False, True, 2, 20),
            (True, True, False, 2, 20), (True, True, True, 1, 20),
            (True, True, True, 2, 19),
        ]:
            with self.subTest(equipped=equipped, attuned=attuned, enabled=enabled, level=level):
                item = {**deepcopy(base), 'equipped': equipped, 'attuned': attuned, 'enabled': enabled}
                data = {'level': level, 'bars': {'bar_1': {'value': 20, 'max': 20}},
                        'inventory': [item], 'damageTraits': {'resistances': ['fire']}}
                changed = advance_effects(data, self.event())
                self.assertEqual(data['bars']['bar_1']['value'], expected)
                self.assertEqual(changed, expected != 20)

    def test_expiration_precedes_periodic_and_other_documents_never_receive_a_tick(self):
        effect = {'data': {'duration': {'type': 'turns', 'value': 1, 'expires': 'start'},
                           'modifiers': [{'target': 'damage.self', 'operation': 'damage_over_time', 'value': 100}]}}
        data = {'effects': [effect], 'bars': {'bar_1': {'value': 10, 'max': 10}}}
        self.assertFalse(advance_effects(data, self.event(isCurrent=False)))
        self.assertTrue(advance_effects(data, self.event()))
        self.assertFalse(effect['enabled'])
        self.assertEqual(data['bars']['bar_1']['value'], 10)


class InitiativeProfileTests(SimpleTestCase):
    def sheet(self, **values):
        return {'rulesEdition': '2014', 'abilities': {'dex': {'score': 16}}, **values}

    def expression(self, data, formula='1d20 + @init', **context):
        expression, prepared = prepare_initiative(formula, data, **context)
        return expression.replace('@init', str(prepared['init']))

    def test_derives_missing_and_stale_initiative_without_mutating_source(self):
        for initial in ({}, {'init': 99}):
            data = self.sheet(**initial, init_misc=2)
            before = deepcopy(data)
            self.assertEqual(self.expression(data), '1d20 + 5.0')
            self.assertEqual(data, before)
        self.assertEqual(self.expression({'init': 7}), '1d20 + 7')

    def test_2014_exhaustion_and_effect_advantage_cancel(self):
        data = self.sheet(exhaustion=1)
        self.assertEqual(self.expression(data), '2d20kl1 + 3')
        data['effects'] = [{'data': {'modifiers': [{'target': 'roll.check', 'operation': 'advantage'}]}}]
        self.assertEqual(self.expression(data), '1d20 + 3')

    def test_2024_exhaustion_applies_once_despite_persisted_adjusted_init(self):
        data = self.sheet(rulesEdition='2024', exhaustion=2, init=-1)
        self.assertEqual(self.expression(data), '1d20 + 3 - 4')
        self.assertEqual(self.expression(data, '2d20kh1 + @init'), '2d20kh1 + 3 - 4')

    def test_generic_and_initiative_modifiers_preserve_custom_formula(self):
        data = self.sheet(effects=[{'data': {'modifiers': [
            {'target': 'roll.check', 'operation': 'add', 'value': 2},
            {'target': 'roll.initiative', 'operation': 'subtract', 'value': 1},
            {'target': 'roll.initiative', 'operation': 'add_dice', 'value': '1d4'},
            {'target': 'roll.attack', 'operation': 'add', 'value': 50},
        ]}}, {'enabled': False, 'data': {'modifiers': [
            {'target': 'roll.check', 'operation': 'disadvantage'},
        ]}}])
        self.assertEqual(self.expression(data, '1d20 + @init + 9'), '1d20 + 3 + 9 + (2) - (1) + 1d4')

    def test_conditions_are_canonical_and_edition_specific(self):
        self.assertEqual(self.expression(self.sheet(conditions=['poisoned'])), '2d20kl1 + 3')
        self.assertEqual(self.expression(self.sheet(conditions=['invisible', 'surprised'])), '1d20 + 3')
        self.assertEqual(self.expression(self.sheet(rulesEdition='2024', conditions=['invisible'])), '2d20kh1 + 3')
        self.assertEqual(self.expression(self.sheet(rulesEdition='2024'), conditions=[{'code': 'surprised'}]), '2d20kl1 + 3')
        self.assertEqual(self.expression(self.sheet(), conditions=[{'id': str(uuid.uuid4()), 'label': 'Poisoned'}]), '1d20 + 3')
        self.assertEqual(self.expression(self.sheet(), conditions=[{'conditionId': 'poisoned'}]), '2d20kl1 + 3')
        self.assertEqual(self.expression(self.sheet(conditions=['frightened'])), '1d20 + 3')

    def test_native_bridge_uses_real_dice_engine_and_system_callback(self):
        samples = iter([0.9, 0.1])
        roller = lambda expression, repeat: evaluate(expression, repeat, random_source=samples.__next__)
        with patch.object(services, 'system_combat', return_value={}), \
                patch.object(services, 'evaluate', side_effect=roller) as engine:
            self.assertEqual(services.roll_initiative(SimpleNamespace(campaign=SimpleNamespace(system='gravewright.5e-srd')), '1d20 + @init', self.sheet(exhaustion=1)), 6)
        self.assertEqual(engine.call_args.args[0], '2d20kl1 + (3)')

    def test_invalid_initiative_modifier_dice_is_rejected_without_executing_text(self):
        bad = self.sheet(effects=[{'data': {'modifiers': [
            {'target': 'roll.check', 'operation': 'add_dice', 'value': '1d4; alert(1)'},
        ]}}])
        with self.assertRaises(ValueError):
            prepare_initiative('1d20 + @init', bad)
        who = SimpleNamespace(campaign=SimpleNamespace(system='gravewright.5e-srd'))
        with patch.object(services, 'system_combat', return_value={}), self.assertRaises(MapError):
            services.roll_initiative(who, '1d20 + @init', bad)

    def test_only_equipped_items_and_enabled_features_grant_initiative_modifiers(self):
        modifier = {'data': {'modifiers': [{'target': 'roll.initiative', 'operation': 'add', 'value': 1}]}}
        data = self.sheet(inventory=[modifier], weapons=[{**modifier, 'equipped': True}],
                          features=[modifier, {**modifier, 'enabled': False}])
        self.assertEqual(self.expression(data), '1d20 + 3 + (1) + (1)')

    def test_origin_initiative_advantage_and_2024_incapacitation_cancel(self):
        data = self.sheet(rulesEdition='2024', mechanicalTraits={'initiativeAdvantage': True})
        self.assertEqual(self.expression(data), '2d20kh1 + 3')
        data['conditions'] = ['stunned']
        self.assertEqual(self.expression(data), '1d20 + 3')
        data['conditionImmunities'] = ['stunned']
        self.assertEqual(self.expression(data), '2d20kh1 + 3')

    def test_untrained_equipped_armor_penalizes_initiative_with_manual_ac(self):
        armor = {'type': 'armor', 'equipped': True, 'data': {'armor_type': 'heavy'}}
        data = self.sheet(acMode='manual', armorTraining={'heavy': False}, inventory=[armor])
        self.assertEqual(self.expression(data), '2d20kl1 + 3')
        armor['equipped'] = False
        self.assertEqual(self.expression(data), '1d20 + 3')
        armor.update(equipped=True, data={'armor_type': 'shield', 'trained': False})
        self.assertEqual(self.expression(data), '2d20kl1 + 3')
        data['rulesEdition'] = '2024'
        self.assertEqual(self.expression(data), '1d20 + 3')

    def test_attunement_gates_magic_initiative_effects(self):
        item = {'equipped': True, 'data': {'requiresAttunement': True, 'modifiers': [
            {'target': 'roll.initiative', 'operation': 'add', 'value': 2}]}}
        data = self.sheet(inventory=[item])
        self.assertEqual(self.expression(data), '1d20 + 3')
        item['attuned'] = True
        self.assertEqual(self.expression(data), '1d20 + 3 + (2)')
        item['equipped'] = False
        self.assertEqual(self.expression(data), '1d20 + 3')

    def test_equipment_ability_effects_change_initiative_without_changing_base(self):
        item = {'equipped': True, 'attuned': True, 'data': {'requiresAttunement': True, 'effectTemplates': [
            {'passive': True, 'changes': [{'target': 'ability.dex.score', 'operation': 'minimum', 'value': 19}]}]}}
        data = self.sheet(inventory=[item])
        self.assertEqual(self.expression(data), '1d20 + 4')
        self.assertEqual(data['abilities']['dex']['score'], 16)
        item['attuned'] = False
        self.assertEqual(self.expression(data), '1d20 + 3')
        item['equipped'] = False
        self.assertEqual(self.expression(data), '1d20 + 3')


class FifthEditionDamageTests(SimpleTestCase):
    def sheet(self, value=10, maximum=10, temporary=0, **values):
        return {'rulesEdition': '2014', 'bars': {'bar_1': {'value': value, 'max': maximum},
                'bar_2': {'value': temporary, 'max': 0}}, **values}

    def test_petrification_resistance_and_poison_immunity_differ_by_edition(self):
        old = self.sheet(30, 30, conditions=['petrified'])
        self.assertFalse(apply_damage(old, 12, damage_type='poison'))
        new = self.sheet(30, 30, rulesEdition='2024', conditions=['petrified'])
        self.assertTrue(apply_damage(new, 12, damage_type='poison'))
        self.assertEqual(new['bars']['bar_1']['value'], 24)
        self.assertTrue(apply_damage(old, 12, damage_type='fire'))
        self.assertEqual(old['bars']['bar_1']['value'], 24)

    def test_equipment_resistance_requires_equipping_and_attunement(self):
        item = {'equipped': True, 'data': {'requiresAttunement': True, 'damageTraits': {'resistances': ['fire']}}}
        for equipped, attuned, loss in [(False, True, 12), (True, False, 12), (True, True, 6)]:
            item.update(equipped=equipped, attuned=attuned)
            data = self.sheet(30, 30, inventory=[deepcopy(item)])
            apply_damage(data, 12, damage_type='fire')
            self.assertEqual(data['bars']['bar_1']['value'], 30 - loss)

    def test_concentration_keeps_each_damage_instance_in_order_even_when_temp_hp_absorbs(self):
        data = self.sheet(100, 100, 100, concentration={'active': True, 'sourceId': 'spell'})
        apply_damage(data, 70)
        apply_damage(data, 30)
        self.assertEqual(data['concentration']['pendingChecks'], [{'dc': 35, 'damage': 70}, {'dc': 15, 'damage': 30}])
        self.assertEqual(data['concentration']['pendingDC'], 35)
        self.assertEqual(data['bars']['bar_1']['value'], 100)
        self.assertEqual(data['hp']['temp'], 0)

    def test_2024_concentration_cap_and_damage_traits_apply_once(self):
        data = self.sheet(100, 100, 100, rulesEdition='2024', concentration={'active': True},
                          damageTraits={'resistances': ['fire']})
        apply_damage(data, 150, damage_type='fire')
        self.assertEqual(data['concentration']['pendingChecks'], [{'dc': 30, 'damage': 75}])
        self.assertEqual(data['bars']['bar_2']['value'], 25)
        self.assertEqual(data['bars']['bar_1']['value'], 100)

    def test_immunity_and_zero_damage_do_not_queue_checks(self):
        data = self.sheet(concentration={'active': True}, damageTraits={'immunities': ['fire']})
        self.assertFalse(apply_damage(data, 20, damage_type='fire'))
        self.assertFalse(apply_damage(data, 0))
        self.assertNotIn('pendingChecks', data['concentration'])

    def test_zero_hp_ends_concentration_and_damage_at_zero_fails_death_saves(self):
        data = self.sheet(2, concentration={'active': True, 'sourceId': 'spell', 'pendingChecks': [{'dc': 10}]})
        apply_damage(data, 3)
        self.assertTrue(data['death']['unconscious'])
        self.assertFalse(data['death']['dead'])
        self.assertEqual(data['concentration'], {'active': False, 'sourceId': '', 'pendingChecks': [], 'pendingDC': None})
        apply_damage(data, 1, critical=True)
        self.assertEqual(data['death']['fail'], 2)
        apply_damage(data, 1)
        self.assertTrue(data['death']['dead'])

    def test_damage_at_zero_counts_even_if_temporary_hp_absorbs_it(self):
        data = self.sheet(0, temporary=5, death={'stable': True})
        apply_damage(data, 1)
        self.assertEqual(data['bars']['bar_2']['value'], 4)
        self.assertEqual(data['death']['fail'], 1)
        self.assertFalse(data['death']['stable'])

    def test_massive_damage_and_monster_death_save_override(self):
        data = self.sheet(5)
        apply_damage(data, 15)
        self.assertTrue(data['death']['dead'])
        monster = self.sheet(5)
        apply_damage(monster, 5, death_saves_enabled=False)
        self.assertTrue(monster['death']['dead'])

    def test_healing_wakes_and_resets_death_saves_without_reviving_dead(self):
        data = self.sheet(0, death={'fail': 2, 'success': 1, 'stable': True, 'unconscious': True})
        self.assertTrue(apply_healing(data, 3))
        self.assertEqual(data['death'], {'success': 0, 'fail': 0, 'stable': False, 'dead': False, 'unconscious': False, 'knockedOut': False})
        self.assertEqual(data['hp']['value'], 3)
        data['death']['dead'] = True
        before = deepcopy(data)
        self.assertFalse(apply_healing(data, 30))
        self.assertEqual(data, before)

    def test_explicit_incapacitated_token_condition_ends_concentration(self):
        data = self.sheet(concentration={'active': True, 'sourceId': 'spell'})
        apply_damage(data, 1, conditions=[{'status': 'paralyzed'}])
        self.assertFalse(data['concentration']['active'])


class EncounterEffectTests(TestCase):
    def setUp(self):
        fixtures.TableModuleTests.setUp(self)
        self.campaign.system = 'gravewright.5e-srd'
        self.campaign.save(update_fields=['system'])

    command = fixtures.TableModuleTests.command

    state = fixtures.TableModuleTests.state

    def effect(self, count=2, **clock):
        return {'id': str(uuid.uuid4()), 'enabled': True, 'data': {
            'duration': {'type': 'rounds', 'value': count, **clock}, 'modifiers': [],
        }}

    def encounter(self, *entries):
        return Encounter.objects.create(scene=self.scene, active=True, round=1,
                                        combatants=list(entries) or [{'tokenId': str(self.token.pk)}])

    def put(self, actor, *items):
        actor.data['effects'] = list(items)
        actor.save(update_fields=['data'])

    def test_5e_informational_duration_is_manual_and_explicit_start_follows_owner(self):
        own = self.effect(1, expires='start')
        manual = self.effect(1)
        self.put(self.actor, own, manual)
        other = Actor.objects.create(campaign=self.campaign, name='Other')
        row = self.encounter({'actorId': str(other.pk)}, {'tokenId': str(self.token.pk)})
        effects.advance(row, 'end', row.combatants[1], round_boundary=True)
        effects.advance(row, 'start', row.combatants[0], round_boundary=True)
        self.actor.refresh_from_db()
        self.assertTrue(self.actor.data['effects'][0]['enabled'])
        effects.advance(row, 'start', row.combatants[1])
        self.actor.refresh_from_db()
        self.assertFalse(self.actor.data['effects'][0]['enabled'])
        self.assertTrue(self.actor.data['effects'][1]['enabled'])
        self.assertNotIn('remaining', self.actor.data['effects'][1]['data']['duration'])

    def test_explicit_source_token_has_priority_over_source_actor(self):
        source = Token.objects.create(scene=self.scene, actor=self.actor)
        target = Actor.objects.create(campaign=self.campaign, name='Target')
        self.put(target, self.effect(1, expires='end', sourceTokenId=str(source.pk), sourceActorId=str(self.actor.pk)))
        row = self.encounter({'tokenId': str(self.token.pk)}, {'tokenId': str(source.pk)}, {'actorId': str(target.pk)})
        effects.advance(row, 'end', row.combatants[0])
        target.refresh_from_db(); self.assertTrue(target.data['effects'][0]['enabled'])
        effects.advance(row, 'start', row.combatants[1])
        target.refresh_from_db(); self.assertTrue(target.data['effects'][0]['enabled'])
        effects.advance(row, 'end', row.combatants[1])
        target.refresh_from_db(); self.assertFalse(target.data['effects'][0]['enabled'])

    def test_explicit_source_actor_clock_updates_only_participating_targets(self):
        target = Actor.objects.create(campaign=self.campaign, name='Target')
        outsider = Actor.objects.create(campaign=self.campaign, name='Outsider')
        for actor in [target, outsider]:
            self.put(actor, self.effect(1, expires='start', sourceActorId=str(self.actor.pk)))
        row = self.encounter({'tokenId': str(self.token.pk)}, {'actorId': str(target.pk)})
        effects.advance(row, 'start', row.combatants[0])
        target.refresh_from_db(); outsider.refresh_from_db()
        self.assertFalse(target.data['effects'][0]['enabled'])
        self.assertTrue(outsider.data['effects'][0]['enabled'])

    def test_canonical_data_duration_wins_over_stale_legacy_clock(self):
        effect = self.effect(3)
        effect['duration'] = {'type': 'rounds', 'remaining': 0}
        self.assertEqual(_tick_effect(effect), (True, False))
        self.assertEqual(effect['data']['duration']['remaining'], 2)
        self.assertEqual(effect['duration'], effect['data']['duration'])
        effect['data']['duration'] = 'informational duration'
        self.assertEqual(_tick_effect(effect), (False, False))

    def test_5e_periodic_damage_uses_resistance_before_temporary_hp(self):
        periodic = self.effect()
        periodic['data']['modifiers'] = [
            {'target': 'damage.self', 'operation': 'damage_over_time', 'value': 7},
            {'target': 'damage.received', 'operation': 'resistance'},
        ]
        self.actor.data = {'bars': {'bar_1': {'value': 10, 'max': 10}, 'bar_2': {'value': 2, 'max': 0}}, 'effects': [periodic]}
        self.actor.save()
        row = self.encounter()
        effects.advance(row, 'start', row.combatants[0])
        self.actor.refresh_from_db()
        self.assertEqual(self.actor.data['bars']['bar_1']['value'], 9)
        self.assertEqual(self.actor.data['bars']['bar_2']['value'], 0)

    def test_inactive_encounter_and_nonparticipant_entry_do_not_tick(self):
        self.put(self.actor, self.effect())
        row = self.encounter()
        effects.advance(row, 'end', {'actorId': str(uuid.uuid4())}, round_boundary=True)
        row.active = False
        effects.advance(row, 'end', row.combatants[0], round_boundary=True)
        self.actor.refresh_from_db()
        self.assertNotIn('remaining', self.actor.data['effects'][0]['data']['duration'])

    def test_missing_source_document_in_stale_roster_does_not_advance_clock(self):
        missing = str(uuid.uuid4())
        self.put(self.actor, self.effect(2, expires='start', sourceActorId=missing))
        row = self.encounter({'actorId': missing}, {'tokenId': str(self.token.pk)})
        effects.advance(row, 'start', row.combatants[0])
        self.actor.refresh_from_db()
        self.assertNotIn('remaining', self.actor.data['effects'][0]['data']['duration'])

    def test_native_forward_command_integrates_phases_and_retry_receipt(self):
        self.put(self.actor, self.effect(2, expires='start'))
        row = self.encounter()
        request_id = uuid.uuid4()
        payload = {'sceneId': str(self.scene.pk), 'version': row.version}
        from gravewright.table import domain
        domain.command(self.campaign.pk, self.gm.pk, 'combat', 'next', payload, request_id)
        domain.command(self.campaign.pk, self.gm.pk, 'combat', 'next', payload, request_id)
        self.actor.refresh_from_db()
        self.assertEqual(self.actor.data['effects'][0]['data']['duration']['remaining'], 1)
        row.refresh_from_db()
        self.command('combat', 'previous', {'sceneId': str(self.scene.pk), 'version': row.version})
        self.actor.refresh_from_db()
        self.assertEqual(self.actor.data['effects'][0]['data']['duration']['remaining'], 1)

    def test_native_initiative_uses_snapshot_and_explicit_token_conditions(self):
        self.actor.data = {'rulesEdition': '2024', 'abilities': {'dex': {'score': 16}}, 'exhaustion': 2}
        self.actor.save()
        independent = Token.objects.create(scene=self.scene, actor=self.actor, linked=False,
            snapshot={'rulesEdition': '2024', 'abilities': {'dex': {'score': 20}}},
            conditions=[{'code': 'poisoned', 'label': 'Arbitrary translated label'}])
        row = self.encounter({'tokenId': str(self.token.pk)}, {'tokenId': str(independent.pk)})
        expressions = []
        def deterministic(expression, repeat):
            expressions.append(expression)
            return evaluate(expression, repeat, random_source=lambda: 0)
        with patch.object(services, 'system_combat', return_value={
                'formula': '1d20 + @init', 'manual_input': 'number'}), \
                patch.object(services, 'evaluate', side_effect=deterministic):
            result = self.command('combat', 'roll', {'sceneId': str(self.scene.pk), 'version': row.version})
        scores = {entry['id']: entry['initiative'] for entry in result['combatants']}
        self.assertEqual(scores, {str(self.token.pk): 0, str(independent.pk): 6})
        self.assertEqual(expressions, ['1d20 + (3) - 4', '2d20kl1 + (5)'])

    def test_snapshot_periodic_damage_updates_concentration_queue_then_ends_it_at_zero(self):
        periodic = self.effect()
        periodic['data']['modifiers'] = [
            {'target': 'damage.self', 'operation': 'damage_over_time', 'value': 2},
            {'target': 'damage.self', 'operation': 'damage_over_time', 'value': 1},
        ]
        token = Token.objects.create(scene=self.scene, actor=self.actor, linked=False, snapshot={
            'rulesEdition': '2024', 'bars': {'bar_1': {'value': 4, 'max': 10}, 'bar_2': {'value': 2, 'max': 0}},
            'concentration': {'active': True, 'sourceId': 'spell'}, 'effects': [periodic],
        })
        before = deepcopy(self.actor.data)
        row = self.encounter({'tokenId': str(token.pk)})
        effects.advance(row, 'start', row.combatants[0])
        token.refresh_from_db(); self.actor.refresh_from_db()
        self.assertEqual(token.snapshot['bars']['bar_1']['value'], 3)
        self.assertEqual(token.snapshot['concentration']['pendingChecks'], [{'dc': 10, 'damage': 2}, {'dc': 10, 'damage': 1}])
        effects.advance(row, 'start', row.combatants[0])
        token.refresh_from_db()
        self.assertEqual(token.snapshot['bars']['bar_1']['value'], 0)
        self.assertFalse(token.snapshot['concentration']['active'])
        self.assertEqual(token.snapshot['concentration']['pendingChecks'], [])
        self.assertTrue(token.snapshot['death']['unconscious'])
        self.assertEqual(self.actor.data, before)

    def test_periodic_healing_does_not_revive_dead_snapshot(self):
        periodic = self.effect()
        periodic['data']['modifiers'] = [{'target': 'damage.self', 'operation': 'heal_over_time', 'value': 10}]
        token = Token.objects.create(scene=self.scene, actor=self.actor, linked=False, snapshot={
            'bars': {'bar_1': {'value': 0, 'max': 10}}, 'death': {'dead': True}, 'effects': [periodic],
        })
        row = self.encounter({'tokenId': str(token.pk)})
        effects.advance(row, 'start', row.combatants[0])
        token.refresh_from_db()
        self.assertEqual(token.snapshot['bars']['bar_1']['value'], 0)
        self.assertTrue(token.snapshot['death']['dead'])

    def test_5e_unequipped_item_periodic_effects_are_inactive(self):
        self.actor.data = {'bars': {'bar_1': {'value': 10, 'max': 10}}, 'inventory': [
            {'data': {'modifiers': [{'target': 'damage.self', 'operation': 'damage_over_time', 'value': 100}]}},
        ]}
        self.actor.save()
        row = self.encounter()
        effects.advance(row, 'start', row.combatants[0])
        self.actor.refresh_from_db()
        self.assertEqual(self.actor.data['bars']['bar_1']['value'], 10)

    def test_next_round_and_defeated_skips_advance_source_clocks_once_without_periodic_damage(self):
        for action in ('next-round', 'next'):
            with self.subTest(action=action):
                source = Actor.objects.create(campaign=self.campaign, name='Source', data={
                    'bars': {'bar_1': {'value': 10, 'max': 10}}, 'effects': [{'data': {'modifiers': [
                        {'target': 'damage.self', 'operation': 'damage_over_time', 'value': 100},
                    ]}}],
                })
                first = Token.objects.create(scene=self.scene, actor=source)
                second = Token.objects.create(scene=self.scene, actor=source)
                target = Actor.objects.create(campaign=self.campaign, name='Target', data={'effects': [
                    self.effect(2, expires='start', sourceActorId=str(source.pk)),
                    self.effect(2, expires='end', sourceTokenId=str(second.pk)),
                ]})
                row = self.encounter({'tokenId': str(self.token.pk)},
                    {'tokenId': str(first.pk), 'defeated': action == 'next'},
                    {'tokenId': str(second.pk), 'defeated': action == 'next'}, {'actorId': str(target.pk)})
                with patch.object(services, 'system_combat', return_value={}):
                    self.command('combat', action, {'sceneId': str(self.scene.pk), 'version': row.version})
                source.refresh_from_db(); target.refresh_from_db()
                self.assertEqual(source.data['bars']['bar_1']['value'], 10)
                self.assertEqual([item['data']['duration']['remaining'] for item in target.data['effects']], [1, 1])
                row.delete()
