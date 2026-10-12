"""Focused rest UI regression against the disposable 5e review server.

Run after rebuilding/installing the package and starting review_5e_server.py:
  GRAVEWRIGHT_REVIEW_URL=http://127.0.0.1:30009 python tests/e2e/rests.py

Uses independent actors/contexts; never edits the fixture's original actors.
Keeps its actors and native chat rolls in the disposable fixture for inspection.
"""
import copy
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from host_paths import ROOT, MODULE
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30009').rstrip('/')
T = json.loads((MODULE / 'locales/pt-BR.json').read_text(encoding='utf-8'))
OUT = ROOT / 'test-results/5e-rests'


def native(page, code, args=None):
    return page.evaluate('async args=>{const api=window.gravewright;' + code + '}', args)


def raw(page, actor_id):
    view = native(page, 'return await api.actors.sheet(args);', actor_id)
    return {key: view[key] for key in ('version', 'sheetVersion', 'data')}


def seed_actor(page, actor_id, data):
    native(page, '''const view=await api.actors.sheet(args.id);
      return await api.actors.saveSheet({actorId:args.id,name:view.name,
        version:view.version,sheetVersion:view.sheetVersion,data:args.data});''',
           {'id': actor_id, 'data': data})


def base_data(edition, empty_dice=False):
    recovery = {'short': {'mode': 'amount', 'amount': 1}, 'long': {'mode': 'all'}}
    return {
        'rulesEdition': edition, 'level': 4, 'hpBaseMax': 40, 'exhaustion': 2,
        'abilities': {key: {'score': 14 if key == 'con' else 10}
                      for key in ('str', 'dex', 'con', 'int', 'wis', 'cha')},
        'bars': {'bar_1': {'value': 4, 'max': 40}, 'bar_2': {'value': 6, 'max': 0}},
        'hitDicePools': [
            {'id': 'fighter', 'className': 'Fighter', 'die': 'd10', 'max': 2,
             'value': 0 if empty_dice else 2},
            {'id': 'wizard', 'className': 'Wizard', 'die': 'd6', 'max': 2,
             'value': 0 if empty_dice else 2},
        ],
        'slots': {'l1': {'value': 1, 'max': 4}, 'l2': {'value': 0, 'max': 2}},
        'pactSlots': {'value': 0, 'max': 2, 'level': 2},
        'resources': {
            'partial': {'value': 0, 'max': 3, 'recovery': copy.deepcopy(recovery)},
            'longOnly': {'value': 0, 'max': 2, 'recovery': {'long': {'mode': 'all'}}},
            'manual': {'value': 1, 'max': 7},
        },
        'features': [
            {'id': 'partial-feature', 'source': 'rest-fixture-partial',
             'name': 'Rest fixture partial resource', 'type': 'feature', 'enabled': True,
             'data': {'rulesEdition': edition, 'uses': {'value': 0, 'max': 3},
                      'recovery': copy.deepcopy(recovery)}},
            {'id': 'long-feature', 'source': 'rest-fixture-long',
             'name': 'Rest fixture long resource', 'type': 'feature', 'enabled': True,
             'data': {'rulesEdition': edition, 'uses': {'value': 0, 'max': 2},
                      'recovery': {'long': {'mode': 'all'}}}},
        ],
    }


def open_sheet(page, actor_id):
    page.evaluate('id=>window.gravewrightActors.open(id)', actor_id)
    sheet = page.locator('.actor-directory__sheet .gw5-sheet')
    expect(sheet).to_be_visible(timeout=30000)
    expect(sheet.locator('.gw5-nav-actions [data-gw5-rest=short]')).to_be_visible()
    expect(sheet.locator('.gw5-nav-actions [data-gw5-rest=long]')).to_be_visible()
    expect(sheet.locator('.gw5-nav-actions [data-gw5-options=token]')).to_have_count(1)
    expect(sheet.locator('.gw5-nav-actions [data-gw5-options=rules]')).to_have_count(0)
    expect(page.locator('dialog')).to_have_count(0)
    return sheet


def close_sheet(page):
    page.locator('.actor-directory__sheet [data-window=close]').click()
    expect(page.locator('.actor-directory__sheet')).to_have_count(0)
    # Content unmounts before the native actor window finishes closing. Wait
    # for both lifetimes before the next open(id) call can reuse that window.
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')


def saved(page):
    expect(page.locator('.actor-directory__sheet .gw5-save-status').last).to_have_attribute(
        'data-state', 'saved', timeout=30000)


def rest(page, sheet, kind):
    sheet.locator(f'.gw5-nav-actions [data-gw5-rest={kind}]').click()
    modal = page.locator(f'.gw5-rest-modal[data-gw5-rest-modal={kind}]')
    expect(modal).to_be_visible()
    expect(modal.locator('[data-gw5-rest-preview]')).to_be_visible()
    return modal


def cancel(page, modal):
    modal.locator('[data-gw5-rest-cancel]').click()
    expect(page.locator('.gw5-rest-modal')).to_have_count(0)


def confirm(page, modal):
    modal.locator('[data-gw5-rest-confirm]').click()
    expect(page.locator('.gw5-rest-modal')).to_have_count(0, timeout=30000)
    saved(page)


def dice_response(response):
    if response.request.method != 'POST':
        return False
    try:
        payload = response.request.post_data_json
        return isinstance(payload, dict) and payload.get('domain') == 'dice' and payload.get('method') == 'roll'
    except (ValueError, TypeError):
        return False


def roll_hit_die(page, modal, message_ids):
    with page.expect_response(dice_response, timeout=30000) as response:
        modal.locator('[data-gw5-hit-die=wizard]').click()
    assert response.value.ok, response.value.status
    envelope = response.value.json()
    message = envelope.get('value', envelope)
    assert message.get('id') and message.get('roll'), message
    message_ids.append(message['id'])
    assert message['roll']['expression'] == '1d6', message
    total = message['roll']['result']['value']['value']
    assert isinstance(total, (int, float)) and 1 <= total <= 6, message
    expect(modal.locator('[data-gw5-hit-die-pool=wizard]')).to_contain_text(re.compile(r'1\s*/\s*2'))
    expect(modal.locator('[data-gw5-rest-confirm]')).to_be_enabled()
    history = native(page, 'return await api.chat.history();')
    messages = history.get('messages', []) if isinstance(history, dict) else history
    assert any(entry['id'] == message['id'] for entry in messages), 'Hit Die roll was not persisted in native chat'
    return total


def assert_no_overflow(locator):
    for box in locator.all():
        dimensions = box.evaluate('''el=>({width:el.clientWidth,scroll:el.scrollWidth,
          left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,
          viewport:el.ownerDocument.defaultView.innerWidth})''')
        assert dimensions['scroll'] <= dimensions['width'] + 2, dimensions
        assert dimensions['left'] >= -2 and dimensions['right'] <= dimensions['viewport'] + 2, dimensions


def check_edition(page, actor_id, edition, message_ids):
    seed_actor(page, actor_id, base_data(edition))
    sheet = open_sheet(page, actor_id)
    before = raw(page, actor_id)

    # Both cancellation paths are atomic, including a real committed chat roll.
    modal = rest(page, sheet, 'short')
    cancel(page, modal)
    assert raw(page, actor_id) == before
    modal = rest(page, sheet, 'short')
    roll_hit_die(page, modal, message_ids)
    assert raw(page, actor_id) == before, 'Preview Hit Die roll changed persisted data/version'
    cancel(page, modal)
    assert raw(page, actor_id) == before, 'Cancel after spending preview Hit Die changed the actor'
    modal = rest(page, sheet, 'long')
    modal.locator('[data-gw5-rest-food]').uncheck()
    if edition == '2014':
        modal.locator('[data-gw5-rest-priority]').select_option('wizard')
    cancel(page, modal)
    assert raw(page, actor_id) == before

    # A short rest recovers only configured resources/pact slots, not HP by itself.
    modal = rest(page, sheet, 'short')
    confirm(page, modal)
    short = raw(page, actor_id)['data']
    assert short['bars']['bar_1']['value'] == 4
    assert short['bars']['bar_2']['value'] == 6
    assert short['exhaustion'] == 2
    assert short['slots'] == before['data']['slots']
    assert short['pactSlots']['value'] == 2
    assert short['resources']['partial']['value'] == 1
    assert short['resources']['longOnly']['value'] == 0
    assert short['resources']['manual']['value'] == 1
    assert short['features'][0]['data']['uses']['value'] == 1
    assert short['features'][1]['data']['uses']['value'] == 0
    assert [pool['value'] for pool in short['hitDicePools']] == [2, 2]
    close_sheet(page)

    seed_actor(page, actor_id, base_data(edition))
    sheet = open_sheet(page, actor_id)
    before = raw(page, actor_id)
    modal = rest(page, sheet, 'short')
    rolled = roll_hit_die(page, modal, message_ids)
    assert raw(page, actor_id) == before
    confirm(page, modal)
    short = raw(page, actor_id)['data']
    assert short['bars']['bar_1']['value'] == 4 + rolled + 2, short['bars']
    assert [pool['value'] for pool in short['hitDicePools']] == [2, 1]
    assert short['slots'] == before['data']['slots']
    assert short['pactSlots']['value'] == 2
    close_sheet(page)

    # All empty multiclass pools distinguish half (2014) from full (2024) recovery.
    seed_actor(page, actor_id, base_data(edition, empty_dice=True))
    sheet = open_sheet(page, actor_id)
    before = raw(page, actor_id)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert_no_overflow(sheet)
    assert_no_overflow(sheet.locator('.gw5-navline, .gw5-nav-actions'))
    modal = rest(page, sheet, 'long')
    assert_no_overflow(modal)
    expect(modal.locator('[data-gw5-rest-food]')).to_be_checked()
    if edition == '2014':
        modal.locator('[data-gw5-rest-priority]').select_option('wizard')
    else:
        expect(modal.locator('[data-gw5-rest-priority]')).to_have_count(0)
    assert raw(page, actor_id) == before, 'Opening/changing long-rest preview saved the actor'
    page.screenshot(path=str(OUT / f'{edition}-long-narrow.png'))
    confirm(page, modal)
    long = raw(page, actor_id)['data']
    assert long['bars']['bar_1'] == {'value': 40, 'max': 40}
    assert long['bars']['bar_2']['value'] == 0
    assert long['exhaustion'] == 1
    assert [pool['value'] for pool in long['hitDicePools']] == ([0, 2] if edition == '2014' else [2, 2])
    assert all(slot['value'] == slot['max'] for slot in long['slots'].values())
    assert long['pactSlots']['value'] == 2
    assert long['resources']['partial']['value'] == 3
    assert long['resources']['longOnly']['value'] == 2
    assert long['resources']['manual']['value'] == 1
    assert [entry['data']['uses']['value'] for entry in long['features']] == [3, 2]
    close_sheet(page)
    sheet = open_sheet(page, actor_id)
    expect(sheet.locator('[data-gw5-path="sheet.hp.value"]').first).to_have_value('40')

    # Rules moved into identity options but still save a configurable edition.
    page.set_viewport_size({'width': 1440, 'height': 1000})
    sheet.locator('.gw5-identity-edit').click()
    identity = page.locator('.gw5-modal').filter(has=page.locator('[data-gw5-options=rules]'))
    identity.locator('[data-gw5-options=rules]').click()
    rules = page.locator('.gw5-modal').filter(has=page.locator('[data-gw5-path="sheet.rulesEdition"]'))
    edition_input = rules.locator('[data-gw5-path="sheet.rulesEdition"]')
    expect(edition_input).to_have_value(edition)
    alternate = '2024' if edition == '2014' else '2014'
    edition_input.select_option(alternate)
    rules.get_by_role('button', name=T['done'], exact=True).click()
    expect(rules).to_have_count(0)
    identity.get_by_role('button', name=T['done'], exact=True).click()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    saved(page)
    assert raw(page, actor_id)['data']['rulesEdition'] == alternate
    close_sheet(page)


def main():
    seed = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf-8'))
    assert Path(seed['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
    assert urlparse(BASE).hostname in ('127.0.0.1', 'localhost'), 'Use the disposable local review server only'
    OUT.mkdir(parents=True, exist_ok=True)
    actors, message_ids, contexts, errors = [], [], [], []
    actor_names = {edition: f'Rest regression {edition} {uuid4().hex[:8]}'
                   for edition in ('2014', '2024')}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = None
        try:
            gm = browser.new_context(viewport={'width': 1440, 'height': 1000})
            contexts.append(gm)
            gm.add_cookies([{**seed['sessions']['gm'], 'url': BASE}])
            page = gm.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE + '/game/' + seed['campaign'])
            page.wait_for_function('''async()=>!!window.gravewright && !!window.gravewrightActors &&
              (await window.gravewright.actors.state()).actorTypes.some(type=>type.id==='character')''')
            for edition in ('2014', '2024'):
                actor = native(page, 'return await api.actors.create(args);', {
                    'name': actor_names[edition], 'type': 'character', 'data': base_data(edition)})
                actors.append(actor['id'])
                native(page, 'return await api.actors.setPermissions(args);', {
                    'id': actor['id'], 'permissions': {'default': 'read'}})
                # The SDK response precedes the directory socket projection;
                # open(id) needs that projection to resolve this actor's type.
                expect(page.locator('#actors-panel .actor-directory__list strong').get_by_text(
                    actor_names[edition], exact=True)).to_have_count(1)
                check_edition(page, actor['id'], edition, message_ids)

            reader = browser.new_context(viewport={'width': 390, 'height': 844})
            contexts.append(reader)
            reader.add_cookies([{**seed['sessions']['reader'], 'url': BASE}])
            readonly = reader.new_page()
            readonly.on('pageerror', lambda error: errors.append(str(error)))
            readonly.goto(BASE + '/game/' + seed['campaign'])
            readonly.wait_for_function('!!window.gravewright && !!window.gravewrightActors')
            for actor_id, edition in zip(actors, ('2014', '2024')):
                expect(readonly.locator('#actors-panel .actor-directory__list strong').get_by_text(
                    actor_names[edition], exact=True)).to_have_count(1)
                sheet = open_sheet(readonly, actor_id)
                before = raw(readonly, actor_id)
                for kind in ('short', 'long'):
                    control = sheet.locator(f'[data-gw5-rest={kind}]')
                    expect(control).to_be_disabled()
                    control.evaluate('button=>button.click()')
                expect(readonly.locator('.gw5-rest-modal')).to_have_count(0)
                expect(sheet.locator('.gw5-identity-edit')).to_be_disabled()
                assert raw(readonly, actor_id) == before
                assert_no_overflow(sheet.locator('.gw5-navline, .gw5-nav-actions'))
                close_sheet(readonly)
            assert not errors, errors
            print(json.dumps({'passed': True, 'editions': ['2014', '2024'],
                              'nativeHitDieRolls': len(message_ids), 'atomicCancel': True,
                              'readonly': True, 'narrow': True, 'rulesViaIdentity': True,
                              'actors': actors, 'messages': message_ids}))
        except Exception:
            if page and not page.is_closed():
                page.screenshot(path=str(OUT / 'failure.png'))
            raise
        finally:
            cleanup_errors = []
            if page and not page.is_closed():
                try:
                    page.evaluate('''()=>document.querySelectorAll('.gw5-modal,.actor-directory__sheet')
                      .forEach(modal=>modal.close?.(true))''')
                except Exception as error:
                    cleanup_errors.append(str(error))
            for context in reversed(contexts):
                context.close()
            browser.close()
            if cleanup_errors:
                raise AssertionError('Fixture teardown failed: ' + '; '.join(cleanup_errors))


if __name__ == '__main__':
    main()
