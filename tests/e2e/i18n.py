"""Validate the real installed Translator/system integration in three locales.

Run only against the disposable review_5e_server.py fixture after rebuilding:
  GRAVEWRIGHT_REVIEW_URL=http://127.0.0.1:30009 python tests/e2e/i18n.py

Uses the account language endpoint and native document/dice APIs. Its actors,
items and chat rolls stay in the disposable fixture for inspection.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from host_paths import ROOT, MODULE
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30009').rstrip('/')
OUT = ROOT / 'test-results/5e-i18n'
CATALOGS = {language: json.loads((MODULE / 'locales' / f'{language}.json').read_text(encoding='utf8'))
            for language in ('en', 'pt-BR', 'es')}
MANIFEST = json.loads((MODULE / 'manifest.json').read_text(encoding='utf8'))
ACTIONS = json.loads((MODULE / 'rules/actions.gw.json').read_text(encoding='utf8'))['actions']
CHARACTER = json.loads((MODULE / 'layouts/character.sheet.gw.json').read_text(encoding='utf8'))
USER_TEXT = 'Long rest\nSave\nClose\nFireball <user text> $& Café'


def native(page, code, args=None):
    return page.evaluate('async args=>{const api=window.gravewright;' + code + '}', args)


def frames(page):
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')


def raw_actor(page, actor_id):
    view = native(page, 'return await api.actors.sheet(args);', actor_id)
    return {key: view[key] for key in ('name', 'version', 'sheetVersion', 'data')}


def actor_row(page, name):
    return page.locator('#actors-panel .actor-directory__actor').filter(
        has=page.locator('strong').get_by_text(name, exact=True)).first


def open_actor(page, actor):
    expect(actor_row(page, actor['name'])).to_have_count(1, timeout=30000)
    page.evaluate('id=>window.gravewrightActors.open(id)', actor['id'])
    window = page.locator(f'.actor-directory__sheet[data-actor-id="{actor["id"]}"]')
    sheet = window.locator('.gw5-sheet')
    expect(sheet).to_be_visible(timeout=30000)
    expect(sheet.locator('.gw5-save-status').last).to_have_attribute('data-state', 'saved')
    expect(sheet.locator('[data-gw5-path="core.name"]')).to_have_value(actor['name'])
    expect(window.locator('.actor-directory__sheet-heading strong')).to_have_text(actor['name'])
    # The replacement surface itself owns the protection, so every descendant
    # remains protected even if a browser/host Translator processes the DOM.
    assert sheet.evaluate('el=>el.closest("[translate=no]")!==null')
    return window, sheet


def close_window(page, window):
    window.locator('[data-window=close], :scope > form > header > [data-close]').click()
    expect(window).to_have_count(0)
    frames(page)


def close_modal(modal):
    expect(modal).to_have_attribute('translate', 'no')
    modal.locator(':scope > .gw5-modal-title > .gw5-close').click()
    expect(modal).to_have_count(0)


def check_skill_headers(sheet):
    header = sheet.locator('.gw5-skill-head')
    expect(header).to_have_count(1)
    expect(header).to_be_visible()
    bounds = header.evaluate('''el=>{
      const parent=el.getBoundingClientRect();
      return {left:parent.left,right:parent.right,labels:[...el.querySelectorAll(':scope > span')].map(span=>{
        const box=span.getBoundingClientRect(),range=el.ownerDocument.createRange();
        range.selectNodeContents(span);const text=range.getBoundingClientRect();
        return {label:span.textContent,left:box.left,right:box.right,textLeft:text.left,textRight:text.right};
      })};
    }''')
    assert len(bounds['labels']) == 3, bounds
    # Fixed-width flex cells can be separate while their translated text
    # overlaps. Compare the rendered text ranges as well as the span boxes.
    for previous, following in zip(bounds['labels'], bounds['labels'][1:]):
        assert previous['right'] <= following['left'] + 0.5, bounds
        assert previous['textRight'] <= following['textLeft'] + 0.5, bounds
    for label in bounds['labels']:
        assert label['textLeft'] >= bounds['left'] - 0.5, bounds
        assert label['textRight'] <= bounds['right'] + 0.5, bounds


def set_language(page, language, campaign):
    result = page.evaluate('''async ({language,next})=>{
      const csrfPath=document.querySelector('meta[name=gravewright-csrf-url]')?.content||'/__gravewright/csrf';
      const csrfResponse=await fetch(csrfPath,{credentials:'same-origin'});
      const csrf=await csrfResponse.json();
      if(!csrfResponse.ok||!csrf.token||!csrf.header)throw Error('Missing native CSRF token');
      const response=await fetch('/inside/language',{method:'POST',credentials:'same-origin',
        headers:{Accept:'application/json',[csrf.header]:csrf.token,
          'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({locale:language,next})});
      return {status:response.status,body:await response.json()};
    }''', {'language': language, 'next': '/game/' + campaign})
    assert result['status'] == 200 and result['body']['locale'] == language, result
    page.reload()
    page.wait_for_function('''language=>!!window.gravewrightActors && !!window.gravewrightItems &&
      !!window.gravewright && window.gravewright.i18n.locale===language''', arg=language)
    expect(page.locator('dialog')).to_have_count(0)


def dice_response(response):
    try:
        payload = response.request.post_data_json
        return response.request.method == 'POST' and payload.get('domain') == 'dice' and payload.get('method') == 'roll'
    except (ValueError, TypeError, AttributeError):
        return False


def check_native_actor_types(page, actor, language):
    labels = CATALOGS[language]
    panel = page.locator('#actors-panel')
    if not panel.is_visible():
        page.locator('[data-panel=actors]').click()
    panel.locator('[data-actor-panel=create]').click()
    form = page.locator('.directory-dialog').filter(has=page.locator('[name=actorType]'))
    select = form.locator('[name=actorType]')
    expected = [{'id': kind['id'], 'label': labels[kind['labelKey']]}
                for kind in MANIFEST['system']['actorTypes']]
    expect(select.locator('option')).to_have_text([entry['label'] for entry in expected], timeout=30000)
    actual = select.locator('option').evaluate_all(
        'nodes=>nodes.map(node=>({id:node.value,label:node.textContent}))')
    assert actual == expected, {'language': language, 'actual': actual, 'expected': expected}
    row_label = actor_row(page, actor['name']).locator('small')
    expect(row_label).to_have_text(labels['actorType.character'])
    select.select_option('monster')
    # A real provider registration must refresh both consumers without changing
    # the selected type. This is a catalog overlay, never a fake locale global.
    dispose = page.evaluate_handle('''async ({language,moduleId})=>{
      const {createTranslator}=await import('/static/gravewright_modules/i18n.js');
      const message={'actorType.character':'Provider character probe'};
      return createTranslator(moduleId).register({en:message,[language]:message});
    }''', {'language': language, 'moduleId': MANIFEST['id']})
    try:
        expect(row_label).to_have_text('Provider character probe')
        expect(select.locator('option[value=character]')).to_have_text('Provider character probe')
        expect(select).to_have_value('monster')
    finally:
        dispose.evaluate('fn=>fn()')
        dispose.dispose()
    expect(row_label).to_have_text(labels['actorType.character'])
    expect(select.locator('option[value=character]')).to_have_text(labels['actorType.character'])
    expect(select).to_have_value('monster')
    form.locator('header button').click()
    expect(form).to_have_count(0)
    panel.locator('[data-actor-panel=close]').click()


def check_character(page, actor, race, language, messages):
    labels = CATALOGS[language]
    before = raw_actor(page, actor['id'])
    chat = page.locator('#chat-panel')
    if not chat.is_visible():
        page.locator('[data-panel=chat]').click()
    window, sheet = open_actor(page, actor)
    for tab in CHARACTER['body']['tabs']:
        expect(sheet.locator(f'[data-gw5-tab="{tab["id"]}"]')).to_have_text(labels[tab['labelKey']])
    expect(sheet.locator('[data-gw5-rest=short]')).to_have_text(labels['shortRest'])
    expect(sheet.locator('[data-gw5-rest=long]')).to_have_text(labels['longRest'])
    expect(sheet.locator('[data-gw5-options=token]')).to_have_text(labels['token'])
    expect(sheet.locator('[data-gw5-ability-bonus=str]')).to_have_attribute('title', labels['abilityCheck'])
    check_skill_headers(sheet)
    page.screenshot(path=str(OUT / f'{language}-character.png'))
    sheet.locator('[data-gw5-rest=short]').click()
    rest = page.locator('.gw5-rest-modal')
    expect(rest).to_have_attribute('aria-label', labels['shortRest'])
    expect(rest.locator('[data-gw5-rest-confirm]')).to_have_text(labels['confirm'])
    expect(rest.locator('[data-gw5-rest-cancel]')).to_have_text(labels['cancel'])
    close_modal(rest)
    sheet.locator('.gw5-identity-edit').click()
    identity = page.locator('.gw5-modal').filter(has=page.locator('[data-gw5-options=rules]'))
    expect(identity.locator('[data-gw5-options=rules]')).to_have_text(labels['settings'])
    identity.locator('[data-gw5-options=rules]').click()
    rules = page.locator('.gw5-modal').filter(has=page.locator('[data-gw5-path="sheet.rulesEdition"]'))
    expect(rules).to_have_attribute('aria-label', labels['settings'])
    expect(rules.locator('[data-gw5-path="sheet.rulesEdition"] option[value="2024"]')).to_have_text(labels['edition2024'])
    close_modal(rules)
    close_modal(identity)

    # Both fixed labels and dynamic placeholders pass through the production
    # sheet translator. Cancel the pending choice; never apply a partial origin.
    transfer = page.evaluate_handle('''reference=>{
      const transfer=new DataTransfer();transfer.setData('application/x-gravewright-item',JSON.stringify(reference));return transfer;
    }''', {'id': race['id'], 'tableId': actor['campaign']})
    try:
        sheet.dispatch_event('dragover', {'dataTransfer': transfer})
        sheet.dispatch_event('drop', {'dataTransfer': transfer})
    finally:
        transfer.dispose()
    advancement = page.locator('.gw5-advancement-modal')
    expect(advancement).to_be_visible(timeout=30000)
    expect(advancement).to_have_attribute('aria-label', labels['advancementTitle'].replace('{name}', race['name']))
    expect(advancement.locator('.gw5-advancement-choice legend')).to_have_text(
        race['name'] + ' · ' + labels['advancement.size'])
    close_modal(advancement)
    assert raw_actor(page, actor['id']) == before, 'Opening/canceling translated modals changed the actor'

    # A real ability roll closes its setup modal and places localized actions
    # on the native chat message, with no additional result window.
    sheet.locator('.gw5-ability').filter(has=page.locator('[data-gw5-ability-bonus=str]')).locator('.gw5-ability-heading button').click()
    roll = page.locator('.gw5-modal').filter(has=page.locator('form [name=kind]'))
    expect(roll).to_have_attribute('aria-label', labels[ACTIONS['roll.check.str']['label']])
    expect(roll.locator('[name=mode] option[value=advantage]')).to_have_text(labels['dnd5e.ui.vantagem'])
    expect(roll.locator('[name=kind] option[value=check]')).to_have_text(labels['abilityCheck'])
    expect(roll).to_have_attribute('translate', 'no')
    with page.expect_response(dice_response, timeout=30000) as response:
        roll.locator('[type=submit]').click()
    assert response.value.ok
    envelope = response.value.json()
    message = envelope.get('value', envelope)
    messages.append(message['id'])
    expect(roll).to_have_count(0)
    controls = chat.locator(f'[data-gw5-chat-roll="{message["id"]}"]')
    expect(controls).to_be_visible(timeout=30000)
    expect(controls).to_have_attribute('translate', 'no')
    expect(controls.locator('[data-heroic-reroll]')).to_have_text(labels['heroicReroll'])
    expect(page.locator('.gw5-modal')).to_have_count(0)
    after_roll = raw_actor(page, actor['id'])
    # Native roll finalization saves derived statistics. Preserve authored
    # values, rather than requiring its document revision to remain unchanged.
    assert after_roll['name'] == before['name']
    for key in ('notes', 'traits', 'actions_text', 'type', 'inspiration'):
        assert after_roll['data'].get(key) == before['data'].get(key), key
    for bar_id, values in before['data']['bars'].items():
        for key, value in values.items():
            assert after_roll['data']['bars'][bar_id][key] == value, f'{bar_id}.{key}'
    for ability, value in before['data']['abilities'].items():
        assert after_roll['data']['abilities'][ability]['score'] == value['score'], ability

    sheet.locator('[data-gw5-tab=bio]').click()
    expect(sheet.locator('[data-gw5-path="sheet.notes"]')).to_have_value(USER_TEXT)
    close_window(page, window)
    window, sheet = open_actor(page, actor)
    expect(sheet.locator('[data-gw5-rest=short]')).to_have_text(labels['shortRest'])
    close_window(page, window)
    assert raw_actor(page, actor['id']) == after_roll, 'Reopening changed the saved actor'


def check_monster(page, actor, language):
    labels = CATALOGS[language]
    before = raw_actor(page, actor['id'])
    window, sheet = open_actor(page, actor)
    expect(sheet.locator('.gw5-monster-classification .gw5-monster-fact-value').first).to_have_text('Save')
    expect(sheet.locator('[data-gw5-monster-settings]')).to_have_attribute('title', labels['monsterDetails'])
    check_skill_headers(sheet)
    sheet.locator('[data-gw5-monster-settings]').click()
    profile = page.locator('.gw5-modal').filter(has=page.locator('.gw5-monster-settings'))
    expect(profile).to_have_attribute('aria-label', labels['monsterProfile'])
    expect(profile.locator('[data-gw5-path="sheet.type"]')).to_have_value('Save')
    close_modal(profile)
    page.screenshot(path=str(OUT / f'{language}-monster.png'))
    close_window(page, window)
    window, sheet = open_actor(page, actor)
    expect(sheet.locator('.gw5-monster-classification .gw5-monster-fact-value').first).to_have_text('Save')
    close_window(page, window)
    assert raw_actor(page, actor['id']) == before


def check_item(page, item, language):
    labels = CATALOGS[language]
    before = native(page, 'return await api.items.get(args);', item['id'])
    for _ in range(2):
        page.evaluate('id=>window.gravewrightItems.open(id)', item['id'])
        window = page.locator(f'.item-sheet[data-item-id="{item["id"]}"]')
        sheet = window.locator('.gw5-sheet')
        expect(sheet).to_be_visible(timeout=30000)
        assert sheet.evaluate('el=>el.closest("[translate=no]")!==null')
        expect(sheet.locator('[data-gw5-path="core.name"]')).to_have_value(item['name'])
        expect(sheet.locator('.gw5-item-kind')).to_have_text(labels['weapon'])
        expect(sheet.locator('[data-gw5-item-tab=details]')).to_have_text(labels['itemDetails'])
        expect(sheet.locator('[data-gw5-path="sheet.description"]')).to_have_value(USER_TEXT)
        page.screenshot(path=str(OUT / f'{language}-item.png'))
        close_window(page, window)
    assert native(page, 'return await api.items.get(args);', item['id']) == before


def main():
    seed = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf8'))
    assert Path(seed['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
    assert urlparse(BASE).hostname in ('localhost', '127.0.0.1')
    OUT.mkdir(parents=True, exist_ok=True)
    errors, messages = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_cookies([{**seed['sessions']['gm'], 'url': BASE}])
        page = context.new_page()
        page.set_default_timeout(30000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(BASE + '/game/' + seed['campaign'])
            page.wait_for_function('!!window.gravewright && !!window.gravewrightActors && !!window.gravewrightItems')
            installed = native(page, 'return await api.modules.list();')
            translator = next(package for package in installed if package['id'] == 'gravewright.translator')
            assert translator.get('globalEnabled') and not translator.get('revoked'), translator
            assert translator['version'] == '0.1.2', translator
            suffix = uuid4().hex[:8]
            actors = []
            for actor_type in ('character', 'monster'):
                name = 'Save' if actor_type == 'character' else f'Long rest <{actor_type}> $& {suffix}'
                data = {'rulesEdition': '2024', 'inspiration': True, 'level': 1, 'hpBaseMax': 20,
                        'bars': {'bar_1': {'value': 20, 'max': 20}},
                        'abilities': {ability: {'score': 10} for ability in ('str', 'dex', 'con', 'int', 'wis', 'cha')},
                        'notes': USER_TEXT, 'type': 'Save', 'size': 'medium',
                        'traits': USER_TEXT, 'actions_text': USER_TEXT}
                result = native(page, 'return await api.actors.create(args);', {'name': name, 'type': actor_type, 'data': data})
                actors.append({'id': result['id'], 'name': name, 'campaign': seed['campaign']})
                expect(actor_row(page, name)).to_have_count(1, timeout=30000)
            weapon = native(page, 'return await api.items.create(args);', {'name': 'Save', 'type': 'weapon',
                'data': {'rulesEdition': '2024', 'damage': '1d6', 'description': USER_TEXT}})
            weapon['name'] = 'Save'
            race_name = f'Fireball <origin> $& {suffix}'
            race = native(page, 'return await api.items.create(args);', {'name': race_name, 'type': 'race',
                'data': {'rulesEdition': '2024', 'description': USER_TEXT,
                         'advancement': [{'id': 'fixture-size', 'type': 'Size', 'level': 0,
                                          'configuration': {'sizes': ['small', 'medium']}}]}})
            race['name'] = race_name
            for language in ('en', 'pt-BR', 'es'):
                set_language(page, language, seed['campaign'])
                check_native_actor_types(page, actors[0], language)
                check_character(page, actors[0], race, language, messages)
                check_monster(page, actors[1], language)
                check_item(page, weapon, language)
                page.screenshot(path=str(OUT / f'{language}-workspace.png'))
            assert not errors, errors
            print(json.dumps({'passed': True, 'locales': ['en', 'pt-BR', 'es'],
                              'translator': translator['version'], 'accountPreference': True,
                              'nativeActorLabels': True, 'placeholderTitle': True,
                              'skillHeadersNoOverlap': True,
                              'userDataPreserved': True, 'reopened': True,
                              'nativeChatRolls': messages, 'noResultDialog': True,
                              'actors': [actor['id'] for actor in actors], 'items': [weapon['id'], race['id']]}))
        except Exception:
            page.screenshot(path=str(OUT / 'failure.png'))
            raise
        finally:
            context.close()
            browser.close()


if __name__ == '__main__':
    main()
