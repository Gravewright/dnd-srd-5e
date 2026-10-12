"""D&D SRD 2014/2024 combat rules owned exclusively by the external system.

The native VTT owns permissions, encounter instances, transactions and storage.
These callbacks receive one sheet copy and never query or write model objects.
"""
from copy import deepcopy
import math
import re

from gravewright.combat import formula_engine
from gravewright.combat.active_effects import apply_resource_delta, resolve_resource_target


_D20 = re.compile(r'(?<![A-Za-z0-9_])1d20(?![A-Za-z0-9_])', re.IGNORECASE)


_DICE = re.compile(r'\d{1,2}d\d{1,3}', re.IGNORECASE)


_CONDITIONS = {'poisoned', 'invisible', 'surprised', 'incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'}


def _number(value, fallback=0):
    try:
        number = float(value)
        return max(-1e6, min(1e6, number)) if math.isfinite(number) else fallback
    except (TypeError, ValueError, OverflowError):
        return fallback


def condition_ids(data, conditions=()):
    """Free labels and token UUIDs never imply a rule or depend on translation."""
    actor_conditions = data.get('conditions', [])
    values = list(actor_conditions) if isinstance(actor_conditions, list) else []
    values.extend(conditions if isinstance(conditions, (list, tuple)) else [])
    for effect in _active_items(data, include_effects=True):
        payload = effect.get('data') if isinstance(effect.get('data'), dict) else {}
        values.append(payload.get('conditionId') or payload.get('systemCondition'))
    codes = set()
    for condition in values:
        if isinstance(condition, str):
            code = condition
        elif isinstance(condition, dict):
            code = condition.get('status') or condition.get('conditionId') or condition.get('code')
        else:
            continue
        if isinstance(code, str) and code in _CONDITIONS:
            codes.add(code)
    immunities = list(data.get('conditionImmunities', [])) if isinstance(data.get('conditionImmunities'), list) else []
    for item in _active_items(data, include_effects=True):
        values = item.get('data', {}).get('conditionImmunities')
        if isinstance(values, list):
            immunities.extend(values)
    if isinstance(immunities, list):
        codes.difference_update(value for value in immunities if isinstance(value, str))
    if isinstance(data.get('death'), dict) and (data['death'].get('dead') or data['death'].get('unconscious')):
        codes.add('unconscious')
    if codes.intersection({'paralyzed', 'petrified', 'stunned', 'unconscious'}):
        codes.add('incapacitated')
    if 'petrified' in codes:
        codes.discard('poisoned')
    return codes


def _active_items(data, *, include_effects=False):
    collections = ('inventory', 'weapons', 'equipment', 'features', 'effects') if include_effects else ('inventory', 'weapons', 'equipment', 'features')
    for collection in collections:
        items = data.get(collection)
        for item in items[:128] if isinstance(items, list) else []:
            if not isinstance(item, dict) or item.get('enabled') is False:
                continue
            payload = item.get('data') if isinstance(item.get('data'), dict) else {}
            if payload.get('enabled') is False or payload.get('requiresAttunement') is True and item.get('attuned') is not True:
                continue
            if collection in ('features', 'effects') or item.get('equipped') is True:
                yield item


def _traits(data, key):
    result = deepcopy(data.get(key)) if isinstance(data.get(key), dict) else {}
    for item in _active_items(data, include_effects=True):
        if item.get('type') in ('race', 'background', 'class'):
            continue
        payload = item.get('data') if isinstance(item.get('data'), dict) else {}
        traits = payload.get(key)
        for name, value in traits.items() if isinstance(traits, dict) else []:
            if isinstance(value, list):
                result[name] = [*(result.get(name) if isinstance(result.get(name), list) else []), *value]
            elif value is True:
                result[name] = True
    return result


def _effective_ability(data, ability):
    abilities = data.get('abilities') if isinstance(data.get('abilities'), dict) else {}
    source = abilities.get(ability) if isinstance(abilities.get(ability), dict) else {}
    value = _number(source.get('score'), 10)
    armor = [item for key in ('inventory', 'equipment') for item in (data.get(key) if isinstance(data.get(key), list) else [])
             if isinstance(item, dict) and item.get('equipped') is True and item.get('type') == 'armor']
    for item in _active_items(data, include_effects=True):
        payload = item.get('data') if isinstance(item.get('data'), dict) else {}
        templates = payload.get('effectTemplates')
        for template in templates[:64] if isinstance(templates, list) else []:
            if not isinstance(template, dict) or template.get('enabled') is False:
                continue
            requirements = template.get('requirements', {})
            if not isinstance(requirements, dict) or any(key not in ('unarmored', 'noShield') or not isinstance(required, bool) for key, required in requirements.items()):
                continue
            if template.get('passive') is not True and not (requirements and template.get('manual') is not True):
                continue
            if requirements.get('unarmored') and any(item.get('data', {}).get('armor_type') != 'shield' for item in armor):
                continue
            if requirements.get('noShield') and any(item.get('data', {}).get('armor_type') == 'shield' for item in armor):
                continue
            changes = template.get('changes')
            for change in changes[:32] if isinstance(changes, list) else []:
                if not isinstance(change, dict) or change.get('target') != f'ability.{ability}.score' or not isinstance(change.get('value'), (int, float)):
                    continue
                operand, operation = _number(change['value']), change.get('operation')
                if operation == 'set':
                    value = operand
                elif operation == 'minimum':
                    value = max(value, operand)
                elif operation == 'maximum':
                    value = min(value, operand)
                elif operation == 'add':
                    value = max(value, min(_number(change['max']), value + operand)) if operand >= 0 and isinstance(change.get('max'), (int, float)) else value + operand
                elif operation == 'subtract':
                    value -= operand
                elif operation == 'multiply':
                    value *= operand
    return max(0, value)


def _modifiers(data, targets):
    effects = list(data.get('effects', [])) if isinstance(data.get('effects'), list) else []
    effects.extend(_active_items(data))
    for effect in effects[:640]:
        if not isinstance(effect, dict) or effect.get('enabled') is False:
            continue
        payload = effect.get('data') if isinstance(effect.get('data'), dict) else {}
        if payload.get('enabled') is False or payload.get('requiresAttunement') is True and effect.get('attuned') is not True:
            continue
        changes = payload.get('modifiers')
        for change in changes[:32] if isinstance(changes, list) else []:
            if isinstance(change, dict) and change.get('target') in targets:
                yield change


def _hp(data):
    bars = data.get('bars') if isinstance(data.get('bars'), dict) else {}
    data['bars'] = bars
    legacy = data.get('hp') if isinstance(data.get('hp'), dict) else {}
    hp = bars.get('bar_1') if isinstance(bars.get('bar_1'), dict) else {}
    temp = bars.get('bar_2') if isinstance(bars.get('bar_2'), dict) else {}
    hp.setdefault('value', legacy.get('value', 10))
    hp.setdefault('max', legacy.get('max', 10))
    temp.setdefault('value', legacy.get('temp', 0))
    temp.setdefault('max', 0)
    for resource, keys in ((hp, ('value', 'max')), (temp, ('value',))):
        for key in keys:
            resource[key] = max(0, math.trunc(_number(resource[key])))
    bars['bar_1'], bars['bar_2'] = hp, temp
    return hp, temp


def _death(data):
    death = data.get('death') if isinstance(data.get('death'), dict) else {}
    for key in ('success', 'fail'):
        death[key] = max(0, min(3, math.trunc(_number(death.get(key)))))
    for key in ('stable', 'dead', 'unconscious'):
        death[key] = bool(death.get(key, False))
    data['death'] = death
    return death


def _sync_hp(data):
    hp, temp = data['bars']['bar_1'], data['bars']['bar_2']
    legacy = data.get('hp') if isinstance(data.get('hp'), dict) else {}
    legacy.update(value=hp['value'], max=hp['max'], temp=temp['value'])
    data['hp'] = legacy


def _end_concentration(data):
    concentration = data.get('concentration') if isinstance(data.get('concentration'), dict) else {}
    concentration.update(active=False, sourceId='', pendingDC=None, pendingChecks=[])
    data['concentration'] = concentration


def apply_damage(data, amount, *, damage_type='', critical=False, death_saves_enabled=None, conditions=()):
    """Apply one 5e damage instance, including temp HP, death and concentration.

    Amount is the raw rolled damage; reductions, resistance and vulnerability are
    applied once here. Concentration tests retain each damage instance in order.
    """
    amount = max(0, math.trunc(_number(amount)))
    targets = {'damage.received'}
    if damage_type:
        targets.add(f'damage.received.{damage_type}')
    modifiers = list(_modifiers(data, targets))
    traits = _traits(data, 'damageTraits')
    codes = condition_ids(data, conditions)
    operations = {change.get('operation') for change in modifiers}
    typed = lambda key: bool(damage_type and isinstance(traits.get(key), list) and damage_type in traits[key])
    if 'immunity' in operations or typed('immunities') or 'petrified' in codes and damage_type == 'poison' and data.get('rulesEdition') != '2024':
        return False
    amount = max(0, amount - sum(max(0, _number(change.get('value'))) for change in modifiers
                                  if change.get('operation') == 'reduce'))
    if 'resistance' in operations or typed('resistances') or 'petrified' in codes:
        amount = math.floor(amount / 2)
    if 'vulnerability' in operations or typed('vulnerabilities'):
        amount *= 2
    amount = max(0, math.floor(amount))
    if not amount:
        return False
    hp, temp = _hp(data)
    death = _death(data)
    before = hp['value']
    absorbed = min(temp['value'], amount)
    remaining = amount - absorbed
    temp['value'] -= absorbed
    hp['value'] = max(0, before - remaining)
    data['lastDamage'] = {'amount': amount, 'absorbed': absorbed, 'hpLoss': min(before, remaining), 'damageType': damage_type}
    saves = data.get('deathSavesEnabled', True) if death_saves_enabled is None else death_saves_enabled
    if not death['dead'] and hp['value'] == 0:
        death['unconscious'] = True
        if saves is False or (remaining - before if before > 0 else amount) >= hp['max']:
            death['dead'] = True
        elif before == 0:
            death['stable'] = False
            death['fail'] = min(3, death['fail'] + (2 if critical else 1))
            if death['fail'] >= 3:
                death['dead'] = True
    incapacitated = {'incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'}
    if death['dead'] or death['unconscious'] or codes.intersection(incapacitated):
        _end_concentration(data)
    elif isinstance(data.get('concentration'), dict) and data['concentration'].get('active'):
        concentration = data['concentration']
        dc = max(10, amount // 2)
        if data.get('rulesEdition') == '2024':
            dc = min(30, dc)
        pending = concentration.get('pendingChecks')
        pending = pending if isinstance(pending, list) else []
        pending.append({'dc': dc, 'damage': amount})
        concentration.update(pendingChecks=pending, pendingDC=pending[0]['dc'])
    _sync_hp(data)
    return True


def apply_healing(data, amount):
    """Periodic healing obeys the same death/reset contract as sheet healing."""
    if isinstance(data.get('death'), dict) and data['death'].get('dead'):
        return False
    amount = max(0, math.trunc(_number(amount)))
    if not amount:
        return False
    hp, _ = _hp(data)
    before = hp['value']
    healed = min(hp['max'], before + amount)
    if healed <= before:
        return False
    hp['value'] = healed
    if hp['value'] > 0:
        _death(data).update(success=0, fail=0, stable=False, unconscious=False, knockedOut=False)
    _sync_hp(data)
    return True


def prepare_initiative(formula, data, *, conditions=()):
    """Prepare initiative on a private copy; never persist derived values."""
    data = deepcopy(data)
    edition = '2024' if data.get('rulesEdition') == '2024' else '2014'
    exhaustion = max(0, min(6, math.trunc(_number(data.get('exhaustion')))))
    abilities = data.get('abilities') if isinstance(data.get('abilities'), dict) else {}
    dexterity = abilities.get('dex') if isinstance(abilities.get('dex'), dict) else {}
    # Source scores win over stale derived init. Older manual documents still work.
    if 'score' in dexterity:
        dex = math.floor((_effective_ability(data, 'dex') - 10) / 2)
        dexterity['mod'] = dex
        data['init'] = dex + _number(data.get('init_misc'))
    elif 'init' not in data:
        data['init'] = _number(dexterity.get('mod')) + _number(data.get('init_misc'))
    codes = condition_ids(data, conditions)
    traits = _traits(data, 'mechanicalTraits')
    advantage = traits.get('initiativeAdvantage') is True or edition == '2024' and 'invisible' in codes
    disadvantage = ('poisoned' in codes or edition == '2014' and exhaustion >= 1 or
                    edition == '2024' and bool(codes.intersection({'surprised', 'incapacitated'})))
    training = data.get('armorTraining') if isinstance(data.get('armorTraining'), dict) else {}
    for collection in ('inventory', 'equipment'):
        items = data.get(collection)
        for item in items[:128] if isinstance(items, list) else []:
            if not isinstance(item, dict) or item.get('type') != 'armor' or item.get('equipped') is not True:
                continue
            payload = item.get('data') if isinstance(item.get('data'), dict) else {}
            kind = payload.get('armor_type')
            if kind == 'shield' and edition == '2024':
                continue
            if payload.get('trained', training.get(kind, True)) is False:
                disadvantage = True
    active = list(_modifiers(data, {'roll.check', 'roll.initiative'}))
    advantage = advantage or any(change.get('operation') == 'advantage' for change in active)
    disadvantage = disadvantage or any(change.get('operation') == 'disadvantage' for change in active)
    if advantage != disadvantage:
        formula = _D20.sub('2d20kh1' if advantage else '2d20kl1', formula, count=1)
    # Initiative is a D20 Test in both editions; 2024 reduces the roll once, even
    # with a custom formula or a previously persisted exhaustion-adjusted init.
    if edition == '2024' and exhaustion and re.search(r'\d+d20', formula, re.IGNORECASE):
        formula += f' - {exhaustion * 2}'
    for change in active:
        operation, value = change.get('operation'), change.get('value')
        if operation in ('add', 'subtract'):
            formula += f" {'+' if operation == 'add' else '-'} ({_number(value):g})"
        elif operation == 'add_dice':
            dice = str(value).strip()
            if not _DICE.fullmatch(dice):
                raise ValueError('Invalid initiative modifier dice.')
            formula += ' + ' + dice
    return formula, data


HP_RESOURCES = {'hp': {'path': 'sheet.bars.bar_1.value', 'maxPath': 'sheet.bars.bar_1.max', 'min': 0}}


def _duration(effect):
    payload = effect.get('data') if isinstance(effect.get('data'), dict) else {}
    return payload['duration'] if 'duration' in payload else effect.get('duration')


def _clock_matches(clock, event):
    """5e durations require an explicit owner/source start/end expiry."""
    if not isinstance(clock, dict) or clock.get('type') not in ('rounds', 'turns'):
        return False
    if clock.get('expires') not in ('start', 'end') or clock['expires'] != event.get('phase'):
        return False
    token_id, actor_id = str(event.get('tokenId') or ''), str(event.get('actorId') or '')
    if clock.get('sourceTokenId'):
        return str(clock['sourceTokenId']) == token_id
    if clock.get('sourceActorId'):
        return str(clock['sourceActorId']) == actor_id
    # The host distinguishes an independent token from its linked actor even
    # when both have the same actorId. Their owner clocks are separate documents.
    return event.get('isCurrent') is True


def _tick_effect(effect):
    clock = _duration(effect)
    if not isinstance(clock, dict) or clock.get('type') not in ('rounds', 'turns'):
        return False, False
    raw = clock.get('remaining', clock.get('value'))
    try:
        remaining = int(raw)
        if isinstance(raw, bool) or float(raw) != remaining or not 0 <= remaining <= 10000:
            return False, False
    except (TypeError, ValueError, OverflowError):
        return False, False
    clock['remaining'] = max(0, remaining - 1)
    effect['duration'] = deepcopy(clock)
    payload = effect.get('data')
    if isinstance(payload, dict) and isinstance(payload.get('duration'), dict):
        payload['duration'] = deepcopy(clock)
    expired = clock['remaining'] == 0
    if expired:
        effect['enabled'] = False
    return True, expired


def _condition_passes(payload, data):
    condition = payload.get('condition')
    if not isinstance(condition, str) or not condition.strip():
        return True
    try:
        return bool(formula_engine.evaluate(condition, context={'sheet': data}).total)
    except formula_engine.FormulaError:
        return False


def _roll_periodic_amount(value, data):
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, math.trunc(_number(value)))
    if not isinstance(value, str) or not value.strip():
        return 0
    try:
        result = formula_engine.evaluate(value.strip(), context={'sheet': data})
    except formula_engine.FormulaError:
        return 0
    return max(0, math.trunc(_number(result.total)))


def advance_effects(data, event):
    """Mutate one supplied sheet copy and report whether persistence is needed.

    The host resolves authoritative instances and event identity. Explicit clocks
    follow their source (token first) or owner. Informational durations stay
    manual. Periodic HP is evaluated once per damage instance, before temp HP.
    """
    if not isinstance(data, dict) or not isinstance(event, dict) or event.get('phase') not in ('start', 'end'):
        return False
    changed = False
    effects = data.get('effects')
    keys = event.get('clockKeys')
    document_key = tuple(event.get('documentKey') or ())
    for index, effect in enumerate(effects[:128] if isinstance(effects, list) else []):
        if not isinstance(effect, dict) or effect.get('enabled') is False:
            continue
        payload = effect.get('data') if isinstance(effect.get('data'), dict) else {}
        if payload.get('enabled') is False or payload.get('requiresAttunement') is True and effect.get('attuned') is not True:
            continue
        key = (*document_key, index, event['phase'])
        if isinstance(keys, set) and key in keys:
            continue
        if _clock_matches(_duration(effect), event):
            ticked = _tick_effect(effect)[0]
            if ticked and isinstance(keys, set):
                keys.add(key)
            changed = ticked or changed
    if event.get('periodic', True) is False or event['phase'] != 'start' or event.get('isCurrent') is not True:
        return changed
    # The system, rather than the generic VTT, owns equipment/attunement gates.
    for effect in list(_active_items(data, include_effects=True)):
        payload = effect.get('data') if isinstance(effect.get('data'), dict) else {}
        if not _condition_passes(payload, data):
            continue
        modifiers = payload.get('modifiers') or effect.get('modifiers') or []
        for modifier in modifiers[:32] if isinstance(modifiers, list) else []:
            if not isinstance(modifier, dict) or modifier.get('operation') not in ('damage_over_time', 'heal_over_time'):
                continue
            target = str(modifier.get('target') or '').strip()
            if target in ('', 'damage.self', 'heal.self', 'self'):
                target = 'resource.hp'
            resolved = resolve_resource_target(target, HP_RESOURCES)
            if not resolved:
                continue
            amount = _roll_periodic_amount(modifier.get('value'), data)
            if not amount:
                continue
            damaging = modifier['operation'] == 'damage_over_time'
            if resolved[0] == 'bars.bar_1.value':
                if damaging:
                    changed = apply_damage(data, amount,
                        damage_type=str(modifier.get('damageType') or modifier.get('damage_type') or ''),
                        death_saves_enabled=data.get('deathSavesEnabled', event.get('actorType') != 'monster'),
                        conditions=event.get('conditions', ())) or changed
                else:
                    changed = apply_healing(data, amount) or changed
            elif apply_resource_delta(data, *resolved, -amount if damaging else amount) is not None:
                changed = True
    return changed
