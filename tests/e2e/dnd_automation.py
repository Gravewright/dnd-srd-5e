"""Exercise 5e automation against the disposable review_5e_server fixture."""
import json
import os
import re
from pathlib import Path
from time import monotonic
from playwright.sync_api import sync_playwright, expect

from host_paths import ROOT, MODULE
SEED = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf-8'))
assert Path(SEED['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30008')
OUT = ROOT / 'test-results/5e-automation'
OUT.mkdir(parents=True, exist_ok=True)
LOCALE = json.loads((MODULE / 'locales/pt-BR.json').read_text(encoding='utf-8'))
packs = json.loads((MODULE / 'compendiums/2024.json').read_text(encoding='utf-8'))
entries = [entry for pack in packs['packs'] for entry in pack['entries']]

def item(name, kind=None):
    source = next(entry for entry in entries if entry['name'] == name and (kind is None or entry['type'] == kind))
    return {'id': name, 'name': name, 'type': source['type'], 'data': source['data'], 'prepared': True}

def native(page, script, args=None):
    return page.evaluate('async args=>{const api=window.gravewright;' + script + '}', args)

def raw(page):
    return native(page, 'return await api.actors.sheet(args);', SEED['actor'])

def seed(page, data):
    native(page, 'const view=await api.actors.sheet(args.id);return await api.actors.saveSheet({actorId:args.id,name:view.name,version:view.version,sheetVersion:view.sheetVersion,data:args.data});', {'id': SEED['actor'], 'data': data})

def open_sheet(page):
    page.evaluate('id=>window.gravewrightActors.open(id)', SEED['actor'])
    sheet = page.locator('.actor-directory__sheet .gw5-sheet')
    expect(sheet).to_be_visible(timeout=30000)
    if page.viewport_size and page.viewport_size['width'] >= 1200:
        # Arrange the actual windows by dragging, leaving the chat alongside the sheet.
        window = page.locator('.actor-directory__sheet')
        handle = window.locator(':scope > header[data-move-handle]')
        bounds, header = window.bounding_box(), handle.bounding_box()
        if bounds and header and (abs(bounds['x'] - 24) > 2 or abs(bounds['y'] - 55) > 2):
            handle.hover(position={'x': 80, 'y': header['height'] / 2})
            page.mouse.down()
            page.mouse.move(24 + 80, 55 + header['height'] / 2, steps=8)
            page.mouse.up()
    return sheet

def close_sheet(page):
    page.locator('.actor-directory__sheet [data-window=close]').click()
    expect(page.locator('.actor-directory__sheet .gw5-sheet')).to_have_count(0)

def modal(page):
    return page.locator('.gw5-modal').last

def done(page):
    modal(page).get_by_role('button', name=LOCALE['done'], exact=True).click()

def saved(page):
    expect(page.locator('.actor-directory__sheet .gw5-save-status').last).to_have_attribute('data-state', 'saved')

def history(page):
    return native(page, 'return await api.chat.history();')

def last_expression(page):
    messages = history(page)
    if isinstance(messages, dict):
        messages = messages.get('messages', [])
    return next(message['roll']['expression'] for message in reversed(messages) if message.get('roll'))

def latest_roll(page):
    messages = history(page)
    if isinstance(messages, dict):
        messages = messages.get('messages', [])
    return next((message for message in reversed(messages) if message.get('roll')), None)

def chat_roll(page, previous_id=None):
    """Wait for the committed roll and its native chat card, without a result modal."""
    expect(page.locator('.gw5-modal')).to_have_count(0)
    deadline = monotonic() + 30
    while monotonic() < deadline:
        message = latest_roll(page)
        if message and message['id'] != previous_id:
            break
        page.wait_for_timeout(100)
    else:
        raise AssertionError('The roll was not committed to native chat')
    chat = page.locator('#chat-panel')
    if not chat.is_visible():
        page.locator('[data-panel=chat]').click()
    expect(chat).to_be_visible()
    # Raise the native chat window with a real title-bar click.
    chat.locator(':scope > header[data-move-handle]').click(position={'x': 80, 'y': 12})
    card = page.locator(f'article[data-message-id="{message["id"]}"]')
    expect(card).to_have_count(1)
    card.scroll_into_view_if_needed()
    expect(card.locator('.dice-result').first).to_be_attached()
    return message, card

def submit_roll(page):
    previous = latest_roll(page)
    modal(page).get_by_role('button', name=LOCALE['roll'], exact=True).click()
    return chat_roll(page, previous['id'] if previous else None)

def drop_item(page, target, source):
    transfer = page.evaluate_handle('''reference=>{
        const transfer=new DataTransfer();
        transfer.setData('application/x-gravewright-item',JSON.stringify(reference));
        return transfer;
    }''', {'id': source['id'], 'tableId': SEED['campaign']})
    target.dispatch_event('dragover', {'dataTransfer': transfer})
    target.dispatch_event('drop', {'dataTransfer': transfer})
    transfer.dispose()

def create_library_armor(page, name):
    source = item(name, 'armor')
    return native(page, 'return await api.items.create(args);', {
        'name': 'Automation fixture ' + name, 'type': 'armor',
        'permissions': {'default': 'read'}, 'data': source['data']})

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_cookies([{**SEED['sessions']['gm'], 'url': BASE}])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewright && !!window.gravewrightActors')
    # Open the native chat before a sheet can cover its dock button.
    chat = page.locator('#chat-panel')
    if not chat.is_visible():
        page.locator('[data-panel=chat]').click()
    expect(chat).to_be_visible()
    base = {'rulesEdition': '2024', 'level': 5,
        'abilities': {'str': {'score': 14}, 'dex': {'score': 16}, 'con': {'score': 14}, 'wis': {'score': 16}},
        'bars': {'bar_1': {'value': 20, 'max': 20}, 'bar_2': {'value': 0, 'max': 0}},
        'spell': {'ability': 'wis'}, 'slots': {'l1': {'value': 3, 'max': 3}, 'l2': {'value': 3, 'max': 3}},
        'hitDice': {'die': 'd8', 'value': 0, 'max': 4},
        'spells': [item('Fire Bolt'), item('Cure Wounds'), item('Flame Blade')],
        'effects': [{'id': 'ward', 'name': 'Ward', 'data': {'modifiers': [
            {'target': 'damage.received', 'operation': 'reduce', 'value': 5},
            {'target': 'damage.received', 'operation': 'resistance'}]}}]}
    seed(page, base)
    sheet = open_sheet(page)
    expect(sheet.locator('[data-gw5-path="sheet.hp.max"]').first).to_have_value('20')
    sheet.get_by_label('Quantidade', exact=True).fill('15')
    sheet.get_by_role('button', name='Dano', exact=True).first.click()
    saved(page)
    assert raw(page)['data']['bars']['bar_1']['value'] == 15
    close_sheet(page)

    # The real library spell profile is used by the damage button.
    base['effects'] = []
    seed(page, base)
    sheet = open_sheet(page)
    sheet.locator('[data-gw5-tab=spells]').click()
    bolt = sheet.locator('[data-entry-id="Fire Bolt"]')
    bolt.get_by_role('button', name='Dano', exact=True).click()
    submit_roll(page)
    assert sum(int(count) for count in re.findall(r'(\d+)d10', last_expression(page))) == 2, last_expression(page)
    cure = sheet.locator('[data-entry-id="Cure Wounds"]')
    cure.get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
    modal(page).get_by_label(LOCALE['slotLevel'], exact=True).select_option('2')
    modal(page).get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    saved(page)
    assert raw(page)['data']['slots']['l2']['value'] == 2
    cure.get_by_role('button', name='Rolar cura', exact=True).click()
    submit_roll(page)
    expression = last_expression(page)
    assert '2d8' in expression and expression.count('2d8') == 2 and '+ 3' in expression, expression

    flame = sheet.locator('[data-entry-id="Flame Blade"]')
    flame.get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
    modal(page).get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    assert raw(page)['data']['concentration']['active']
    sheet.locator('[data-gw5-tab=main]').click()
    sheet.get_by_label('Quantidade', exact=True).fill('8')
    sheet.get_by_role('button', name='Dano', exact=True).first.click()
    saved(page)
    assert raw(page)['data']['concentration']['pendingDC'] == 10
    sheet.locator('.gw5-concentration button').first.click()
    expect(modal(page).locator('select[name=kind]')).to_have_count(0)
    modal(page).locator('input[name=extraModifier]').fill('100')
    modal(page).locator('input[name=extraModifier]').dispatch_event('input')
    # Closing while the server roll is pending waits for and saves its result.
    delayed = []
    def delay_dice(route):
        payload = route.request.post_data_json
        if isinstance(payload, dict) and payload.get('domain') == 'dice':
            delayed.append(route)
        else:
            route.continue_()
    page.route('**/api', delay_dice)
    with page.expect_request(lambda request: request.url.endswith('/api') and request.method == 'POST' and request.post_data_json.get('domain') == 'dice'):
        modal(page).get_by_role('button', name='Rolar', exact=True).click()
    page.evaluate('true')
    assert len(delayed) == 1
    modal(page).get_by_role('button', name=LOCALE['close'], exact=True).click()
    expect(modal(page)).to_be_visible()
    delayed.pop().continue_()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    page.unroute('**/api', delay_dice)
    chat_roll(page)
    assert raw(page)['data']['concentration']['pendingDC'] == 0
    assert raw(page)['data']['concentration']['active']
    close_sheet(page)

    # Edition-specific recovery works through the actual rest modal.
    for edition, expected in [('2014', 2), ('2024', 4)]:
        rest_data = {**base, 'rulesEdition': edition, 'spells': [], 'bars': {'bar_1': {'value': 1, 'max': 20}, 'bar_2': {'value': 3, 'max': 0}}}
        seed(page, rest_data)
        sheet = open_sheet(page)
        sheet.locator('[data-gw5-rest=long]').click()
        modal(page).get_by_role('button', name='Confirmar', exact=True).click()
        expect(page.locator('.gw5-modal')).to_have_count(0)
        assert raw(page)['data']['hitDice']['value'] == expected
        assert raw(page)['data']['bars']['bar_1']['value'] == 20
        assert raw(page)['data']['bars']['bar_2']['value'] == 0
        close_sheet(page)

    # Spending an unnamed multiclass pool selects its actual array index.
    seed(page, {**base, 'hitDicePools': [{'die': 'd10', 'value': 1, 'max': 1}, {'die': 'd6', 'value': 1, 'max': 1}]})
    sheet = open_sheet(page)
    sheet.locator('[data-gw5-rest=short]').click()
    modal(page).get_by_role('button', name=LOCALE['spendHitDie'], exact=True).last.click()
    expect(modal(page).locator('[data-gw5-hit-die="1"]')).to_be_disabled()
    modal(page).get_by_role('button', name=LOCALE['confirm'], exact=True).click()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    saved(page)
    pools = raw(page)['data']['hitDicePools']
    assert [pool['value'] for pool in pools] == [1, 0], pools
    close_sheet(page)

    # An actor opened from the directory follows the current scene's combat.
    # Restarting the encounter must not reuse its previous casting restriction.
    native(page, 'const state=await api.combat.state({sceneId:args.scene});await api.combat.add({sceneId:args.scene,tokenId:args.token,version:state.version});return await api.combat.start({sceneId:args.scene});', {'scene': SEED['scene'], 'token': SEED['token']})
    seed(page, base)
    first_encounter = native(page, 'return await api.combat.state({sceneId:args});', SEED['scene'])['encounterId']
    for index in range(2):
        sheet = open_sheet(page)
        sheet.locator('[data-gw5-tab=spells]').click()
        sheet.locator('[data-entry-id="Cure Wounds"]').get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
        modal(page).get_by_role('button', name=LOCALE['castSpell'], exact=True).click()
        expect(page.locator('.gw5-modal')).to_have_count(0)
        state = raw(page)['data']
        assert state['slots']['l1']['value'] == 2 - index
        assert state['casting']['turnKey']
        if index == 0:
            assert first_encounter in state['casting']['turnKey']
            close_sheet(page)
            native(page, 'await api.combat.stop({sceneId:args});return await api.combat.start({sceneId:args});', SEED['scene'])
        else:
            assert first_encounter not in state['casting']['turnKey']
            close_sheet(page)
    native(page, 'return await api.combat.stop({sceneId:args});', SEED['scene'])

    # Saving Strength proficiency immediately changes the displayed save bonus.
    # A trained ability opens its save by default; switching to check omits proficiency.
    proficiency = {**base, 'abilities': {**base['abilities'], 'str': {'score': 10}}}
    seed(page, proficiency)
    sheet = open_sheet(page)
    strength = sheet.locator('.gw5-ability:has([data-gw5-ability-bonus=str])')
    expect(strength.locator('[data-gw5-ability-bonus=str]')).to_have_text('+0')
    strength.locator('[data-gw5-path="sheet.saves.str.prof"]').check()
    expect(strength.locator('[data-gw5-ability-bonus=str]')).to_have_text('+3')
    saved(page)
    close_sheet(page)
    sheet = open_sheet(page)
    strength = sheet.locator('.gw5-ability:has([data-gw5-ability-bonus=str])')
    expect(strength.locator('[data-gw5-ability-bonus=str]')).to_have_text('+3')
    strength.locator('.gw5-ability-heading button').click()
    expect(modal(page).locator('select[name=kind]')).to_have_value('save')
    submit_roll(page)
    assert re.search(r'1d20\s*\+\s*3(?:\D|$)', last_expression(page)), last_expression(page)
    page.screenshot(path=str(OUT / 'proficiency-chat.png'))
    strength.locator('.gw5-ability-heading button').click()
    modal(page).locator('select[name=kind]').select_option('check')
    submit_roll(page)
    assert re.search(r'1d20\s*\+\s*0(?:\D|$)', last_expression(page)), last_expression(page)
    close_sheet(page)

    # Legacy manual mode without an explicit user choice adopts equipped armor.
    plate, shield = item('Plate Armor', 'armor'), item('Shield', 'armor')
    plate['equipped'], shield['equipped'] = True, False
    seed(page, {**base, 'acMode': 'manual', 'ac': 10, 'inventory': [plate, shield]})
    sheet = open_sheet(page)
    ac = sheet.locator('[data-gw5-stat="sheet.ac"] output').first
    expect(ac).to_have_text('18')
    sheet.locator('[data-gw5-tab=inventory]').click()
    sheet.locator('[data-entry-id="Shield"] [data-gw5-entry-field=equipped]').check()
    saved(page)
    sheet.locator('[data-gw5-tab=main]').click()
    expect(ac).to_have_text('20')
    page.screenshot(path=str(OUT / 'armor.png'))
    sheet.locator('[data-gw5-tab=inventory]').click()
    for name in ['Plate Armor', 'Shield']:
        sheet.locator(f'[data-entry-id="{name}"] [data-gw5-entry-field=equipped]').uncheck()
    saved(page)
    sheet.locator('[data-gw5-tab=main]').click()
    expect(ac).to_have_text('13')
    close_sheet(page)

    # Real library drops equip the first suit/shield, preserving an independent copy.
    sources = {name: create_library_armor(page, name) for name in ['Plate Armor', 'Shield', 'Leather Armor']}
    seed(page, {**base, 'inventory': []})
    sheet = open_sheet(page)
    for name, expected_ac in [('Plate Armor', '18'), ('Shield', '20')]:
        drop_item(page, sheet.locator('.gw5-header'), sources[name])
        expect(sheet.locator('[data-gw5-panel=inventory]')).to_be_attached()
        expect(sheet.locator('.gw5-catalog-row').filter(has_text='Automation fixture ' + name)).to_have_count(1)
        saved(page)
        data = raw(page)['data']
        owned = next(entry for entry in data['inventory'] if entry.get('source') == sources[name]['id'])
        assert owned['equipped'] and owned['id'] != sources[name]['id'], owned
        sheet.locator('[data-gw5-tab=main]').click()
        expect(sheet.locator('[data-gw5-stat="sheet.ac"] output').first).to_have_text(expected_ac)
    drop_item(page, sheet.locator('.gw5-header'), sources['Leather Armor'])
    leather = sheet.locator('.gw5-catalog-row').filter(has_text='Automation fixture Leather Armor')
    expect(leather).to_have_count(1)
    expect(leather.locator('[data-gw5-entry-field=equipped]')).not_to_be_checked()
    leather.locator('[data-gw5-entry-field=equipped]').check()
    saved(page)
    data = raw(page)['data']
    suits = [entry for entry in data['inventory'] if entry['data'].get('armor_type') != 'shield' and entry.get('equipped')]
    assert [entry['name'] for entry in suits] == ['Automation fixture Leather Armor'], suits
    sheet.locator('[data-gw5-tab=main]').click()
    expect(sheet.locator('[data-gw5-stat="sheet.ac"] output').first).to_have_text('16')
    close_sheet(page)

    # 2014 Inspiration cancels the selected disadvantage instead of erasing it.
    seed(page, {**base, 'rulesEdition': '2014', 'inspiration': True})
    sheet = open_sheet(page)
    sheet.locator('.gw5-ability-heading button').first.click()
    modal(page).locator('select[name=mode]').select_option('disadvantage')
    modal(page).get_by_label(LOCALE['useInspiration'], exact=True).check()
    submit_roll(page)
    assert '1d20' in last_expression(page) and '2d20' not in last_expression(page)
    assert not raw(page)['data']['inspiration']
    close_sheet(page)

    # Heroic Inspiration is immediate: opening the next roll locks the prior card.
    seed(page, {**base, 'inspiration': True})
    sheet = open_sheet(page)
    sheet.locator('.gw5-ability-heading button').first.click()
    first, card = submit_roll(page)
    sheet.locator('.gw5-ability-heading button').first.click()
    second, second_card = submit_roll(page)
    assert second['id'] != first['id']
    expect(card.locator('.gw5-chat-actions [data-heroic-reroll]')).to_be_disabled()
    expect(second_card.locator('.gw5-chat-actions [data-heroic-reroll]')).to_be_enabled()
    before_reroll = history(page)
    if isinstance(before_reroll, dict):
        before_reroll = before_reroll.get('messages', [])
    before_roll_ids = {message['id'] for message in before_reroll if message.get('roll')}
    second_card.locator('.gw5-chat-actions [data-heroic-reroll]').click()
    rerolled, rerolled_card = chat_roll(page, second['id'])
    assert rerolled['id'] not in {first['id'], second['id']}
    expect(second_card.locator('.gw5-chat-replaced')).to_have_count(1)
    expect(card.locator('.gw5-chat-replaced')).to_have_count(0)
    expect(rerolled_card.locator('[data-heroic-reroll]')).to_have_count(0)
    expect(card.locator('.gw5-chat-actions [data-heroic-reroll]')).to_be_disabled()
    saved(page)
    assert not raw(page)['data']['inspiration']
    after_reroll = history(page)
    if isinstance(after_reroll, dict):
        after_reroll = after_reroll.get('messages', [])
    assert {message['id'] for message in after_reroll if message.get('roll')} - before_roll_ids == {rerolled['id']}
    close_sheet(page)

    # Concentration saves remain pending in chat until Keep/Reroll or sheet close.
    # Two pending saves prove that close does not apply the first roll twice.
    for resolution in ['keep', 'reroll', 'close', 'newroll', 'end']:
        seed(page, {**base, 'inspiration': True, 'concentration': {
            'active': True, 'sourceId': 'Flame Blade', 'pendingDC': 10,
            'pendingChecks': [{'dc': 10, 'damage': 8}, {'dc': 11, 'damage': 22}]}})
        sheet = open_sheet(page)
        sheet.locator('.gw5-concentration button').first.click()
        modal(page).locator('input[name=extraModifier]').fill('100')
        message, card = submit_roll(page)
        assert raw(page)['data']['concentration']['pendingDC'] == 10
        if resolution == 'keep':
            card.locator('.gw5-chat-actions [data-keep-roll]').click()
        elif resolution == 'reroll':
            card.locator('.gw5-chat-actions [data-heroic-reroll]').click()
            chat_roll(page, message['id'])
        elif resolution == 'newroll':
            # Opening another roll settles the prior check before asking for a new one.
            sheet.locator('.gw5-ability-heading button').first.click()
            expect(modal(page)).to_be_visible()
            assert raw(page)['data']['concentration']['pendingDC'] == 11
            modal(page).get_by_role('button', name=LOCALE['close'], exact=True).click()
            expect(page.locator('.gw5-modal')).to_have_count(0)
        elif resolution == 'end':
            # A stale pending chat decision must not resurrect ended concentration.
            sheet.get_by_role('button', name=LOCALE['endConcentration'], exact=True).click()
            saved(page)
            assert not raw(page)['data']['concentration']['active']
            close_sheet(page)
        else:
            close_sheet(page)
        if resolution not in ['close', 'end']:
            saved(page)
            assert raw(page)['data']['concentration']['pendingDC'] == 11
            close_sheet(page)
        state = raw(page)['data']
        if resolution == 'end':
            assert not state['concentration']['active'] and state['concentration']['pendingDC'] == 0, state['concentration']
            assert state['concentration']['pendingChecks'] == []
        else:
            assert state['concentration']['active'] and state['concentration']['pendingDC'] == 11, state['concentration']
            assert len(state['concentration']['pendingChecks']) == 1
        assert bool(state['inspiration']) == (resolution != 'reroll')
        expect(page.locator('.gw5-modal')).to_have_count(0)

    assert not errors, errors
    page.screenshot(path=str(OUT / 'desktop.png'))
    context.close()

    reader = browser.new_context(viewport={'width': 390, 'height': 844})
    reader.add_cookies([{**SEED['sessions']['reader'], 'url': BASE}])
    page = reader.new_page()
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewrightActors')
    sheet = open_sheet(page)
    expect(sheet.get_by_role('button', name='Dano', exact=True).first).to_be_disabled()
    assert sheet.evaluate('node=>node.scrollWidth<=node.clientWidth+1')
    page.screenshot(path=str(OUT / 'reader-mobile.png'))
    reader.close()
    browser.close()

print('5e UI: native chat rolls, proficiency, armor/drop, SRD scaling, casting, pending roll close, deferred concentration, both rests, multiclass Hit Dice, both inspirations, read-only and mobile passed.')
