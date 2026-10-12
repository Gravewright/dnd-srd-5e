"""Real SRD drops and reversible advancement against the disposable 5e server."""
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
OUT = ROOT / 'test-results/5e-advancement'
OUT.mkdir(parents=True, exist_ok=True)
T = json.loads((MODULE / 'locales/pt-BR.json').read_text(encoding='utf-8'))
CATALOG = {edition: [e for p in json.loads((MODULE / f'compendiums/{edition}.json').read_text(encoding='utf-8'))['packs'] for e in p['entries']] for edition in ('2014', '2024')}


def native(page, code, args=None):
    return page.evaluate('async args=>{const api=window.gravewright;' + code + '}', args)


def raw(page):
    return native(page, 'return await api.actors.sheet(args);', SEED['actor'])['data']


def seed(page, edition='2024', **extra):
    data = {'rulesEdition': edition, 'level': 1, 'abilities': {a: {'score': 10} for a in ('str', 'dex', 'con', 'int', 'wis', 'cha')}, 'bars': {'bar_1': {'value': 10, 'max': 10}, 'bar_2': {'value': 0, 'max': 0}}, **extra}
    native(page, 'const view=await api.actors.sheet(args.id);return await api.actors.saveSheet({actorId:args.id,name:view.name,version:view.version,sheetVersion:view.sheetVersion,data:args.data});', {'id': SEED['actor'], 'data': data})


def source(page, edition, name, kind=None):
    entry = next(e for e in CATALOG[edition] if e['name'] == name and (kind is None or e['type'] == kind))
    return native(page, 'return await api.items.create(args);', {'name': name, 'type': entry['type'], 'permissions': {'default': 'read'}, 'data': entry['data']})


def open_sheet(page):
    page.evaluate('id=>window.gravewrightActors.open(id)', SEED['actor'])
    sheet = page.locator('.actor-directory__sheet .gw5-sheet')
    expect(sheet).to_be_visible(timeout=30000)
    return sheet


def close_sheet(page):
    page.locator('.actor-directory__sheet [data-window=close]').click()
    expect(page.locator('.actor-directory__sheet .gw5-sheet')).to_have_count(0)


def saved(page):
    expect(page.locator('.actor-directory__sheet .gw5-save-status').last).to_have_attribute('data-state', 'saved', timeout=15000)


def drop(page, sheet, item):
    transfer = page.evaluate_handle('''ref=>{const d=new DataTransfer();d.setData('application/x-gravewright-item',JSON.stringify(ref));return d;}''', {'id': item['id'], 'tableId': SEED['campaign']})
    sheet.dispatch_event('dragover', {'dataTransfer': transfer})
    sheet.dispatch_event('drop', {'dataTransfer': transfer})
    transfer.dispose()


def resolve(page, class_level=None):
    modal = page.locator('.gw5-advancement-modal')
    expect(modal).to_be_visible(timeout=15000)
    if class_level is not None:
        modal.locator('[name=classLevel]').fill(str(class_level))
        modal.locator('[name=classLevel]').press('Tab')
    for _ in range(30):
        if not modal.count():
            return
        for group in modal.locator('fieldset[data-choice-id]').all():
            kind = group.get_attribute('data-choice-kind')
            if kind == 'HitPoints':
                group.get_by_role('button', name=T['takeAverage'], exact=True).click()
            elif group.locator('input[data-ability]').count():
                remaining = int(re.search(r'\d+', group.locator('.gw5-advancement-hint').inner_text())[0])
                for control in group.locator('input[data-ability]').all():
                    amount = min(remaining, int(control.get_attribute('max')))
                    control.fill(str(amount))
                    remaining -= amount
                assert remaining == 0
            elif group.locator('select').count():
                select = group.locator('select')
                options = select.locator('option').all()
                assert len(options) > 1, group.inner_text()
                select.select_option(options[1].get_attribute('value'))
            else:
                count = int(re.search(r'\d+', group.locator('.gw5-advancement-hint').inner_text())[0])
                checkboxes = group.locator('input[type=checkbox]').all()
                assert len(checkboxes) >= count, group.inner_text()
                for index, control in enumerate(checkboxes):
                    control.set_checked(index < count)
        modal.get_by_role('button', name=T['applyAdvancement'], exact=True).click()
        page.wait_for_timeout(75)
    page.screenshot(path=str(OUT / 'unresolved.png'))
    raise AssertionError('Advancement did not resolve: ' + modal.inner_text())


def wait_owned(page, name):
    deadline=monotonic()+30
    while monotonic()<deadline:
        data=raw(page)
        if any(e['name']==name for key in ('features','spells','inventory','weapons') for e in data.get(key, [])):
            saved(page)
            return
        page.wait_for_timeout(100)
    raise AssertionError('Owned item was not saved: '+name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_cookies([{**SEED['sessions']['gm'], 'url': BASE}])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewright && !!window.gravewrightActors')

    # Cancel is an atomic no-op, including fixed benefits preceding choices.
    seed(page, '2014')
    sheet = open_sheet(page)
    elf = source(page, '2014', 'High Elf', 'race')
    before = raw(page)
    drop(page, sheet, elf)
    expect(page.locator('.gw5-advancement-modal')).to_be_visible(timeout=30000)
    page.screenshot(path=str(OUT / 'origin-choices.png'))
    page.locator('.gw5-advancement-modal').get_by_role('button', name=T['cancel'], exact=True).click()
    expect(page.locator('.gw5-advancement-modal')).to_have_count(0)
    assert raw(page) == before

    drop(page, sheet, elf)
    resolve(page)
    wait_owned(page, 'High Elf')
    data = raw(page)
    assert data['abilities']['dex']['score'] == 12
    assert data['abilities']['int']['score'] == 11
    assert data['skills']['perception']['prof']
    assert data['senses']['darkvision'] == 60
    assert data['spells'], 'High Elf cantrip was not granted'
    assert data['race'] == 'High Elf'
    assert len(data['features']) > 1
    first = json.dumps(data, sort_keys=True)
    drop(page, sheet, elf)
    page.wait_for_timeout(700)
    assert json.dumps(raw(page), sort_keys=True) == first, 'Repeated origin duplicated benefits'

    # Replacement withdraws the old ancestry without deleting manually learned skills.
    human = source(page, '2014', 'Human', 'race')
    drop(page, sheet, human)
    resolve(page)
    wait_owned(page, 'Human')
    data = raw(page)
    assert all(data['abilities'][a]['score'] == 11 for a in ('str', 'dex', 'con', 'int', 'wis', 'cha'))
    assert not data.get('spells')
    assert not data['skills']['perception']['prof']
    assert not any(e['name'] == 'High Elf' for e in data['features'])
    row = sheet.locator('[data-entry-id]').filter(has_text='Human').first
    row.get_by_role('button', name=T['remove'], exact=True).click()
    saved(page)
    data = raw(page)
    assert data['race'] == ''
    assert all(data['abilities'][a]['score'] == 10 for a in ('str', 'dex', 'con', 'int', 'wis', 'cha'))
    close_sheet(page)

    # Revised species grant their spells, but ability points come from the background.
    seed(page)
    sheet = open_sheet(page)
    high = source(page, '2024', 'Elf, High', 'race')
    drop(page, sheet, high)
    resolve(page)
    wait_owned(page, 'Elf, High')
    data = raw(page)
    assert all(data['abilities'][a]['score'] == 10 for a in ('str', 'dex', 'con', 'int', 'wis', 'cha'))
    assert data['spells']
    sage = source(page, '2024', 'Sage', 'background')
    drop(page, sheet, sage)
    resolve(page)
    wait_owned(page, 'Sage')
    data = raw(page)
    assert sum(data['abilities'][a]['score'] - 10 for a in ('str', 'dex', 'con', 'int', 'wis', 'cha')) == 3
    assert data['skills']['arcana']['prof'] and data['skills']['history']['prof']
    assert any('Magic Initiate' in e['name'] for e in data['features'])

    wizard = source(page, '2024', 'Wizard', 'class')
    drop(page, sheet, wizard)
    resolve(page, 1)
    wait_owned(page, 'Wizard')
    data = raw(page)
    assert data['level'] == 1
    assert data['saves']['int']['prof'] and data['saves']['wis']['prof']
    assert not data['armorTraining']['heavy']
    assert data['slots']['l1']['max'] == 2
    wizard_owned = next(e for e in data['features'] if e['name'] == 'Wizard')
    sheet.locator('[data-entry-id="' + wizard_owned['id'] + '"]').get_by_role('button', name=T['classLevel'] + ' 1', exact=True).click()
    resolve(page, 3)
    saved(page)
    data = raw(page)
    assert data['level'] == 3
    assert data['slots']['l1']['max'] == 4 and data['slots']['l2']['max'] == 2
    assert sum(p['max'] for p in data['hitDicePools']) == 3
    assert data['bars']['bar_1']['max'] >= 14
    assert any(e['data'].get('isSubclass') or e['data'].get('subclass') for e in data['features'])
    page.screenshot(path=str(OUT / 'class-progression.png'))
    sheet.locator('[data-gw5-tab=spells]').click()
    page.screenshot(path=str(OUT / 'granted-spells.png'))

    # Grant casting spends the owned use, and no regular slot.
    data = raw(page)
    granted = next((e for e in data['spells'] if isinstance(e['data'].get('uses'), dict) and e['data']['uses'].get('max', 0) > 0), None)
    assert granted, 'Species/background spell has no owned uses'
    slots_before = data['slots']
    row = sheet.locator('[data-entry-id="' + granted['id'] + '"]')
    row.get_by_role('button', name=T['castSpell'], exact=True).click()
    modal = page.locator('.gw5-modal').last
    modal.get_by_label(T['castingMode'], exact=True).select_option('innate')
    modal.get_by_role('button', name=T['castSpell'], exact=True).click()
    expect(page.locator('.gw5-modal')).to_have_count(0)
    saved(page)
    assert raw(page)['slots'] == slots_before
    after = next(e for e in raw(page)['spells'] if e['id'] == granted['id'])
    assert after['data']['uses']['value'] == granted['data']['uses']['value'] - 1
    close_sheet(page)

    # Equipment still routes directly; changing equipped/attuned controls its bonuses.
    seed(page)
    sheet = open_sheet(page)
    plate = source(page, '2024', 'Plate Armor', 'armor')
    drop(page, sheet, plate)
    wait_owned(page, 'Plate Armor')
    assert raw(page)['effective_ac'] == 18
    gauntlets = source(page, '2024', 'Gauntlets of Ogre Power', 'equipment')
    drop(page, sheet, gauntlets)
    wait_owned(page, 'Gauntlets of Ogre Power')
    data = raw(page)
    entry = next(e for e in data['inventory'] if e['name'] == 'Gauntlets of Ogre Power')
    row = sheet.locator('[data-entry-id="' + entry['id'] + '"]')
    row.locator('[data-gw5-entry-field=equipped]').check()
    saved(page)
    assert raw(page)['abilities']['str']['mod'] == 0
    row.locator('[data-gw5-entry-field=attuned]').check()
    saved(page)
    assert raw(page)['abilities']['str']['mod'] == 4
    assert raw(page)['abilities']['str']['score'] == 10, 'Equipment permanently changed base score'
    row.locator('[data-gw5-entry-field=equipped]').uncheck()
    saved(page)
    assert raw(page)['abilities']['str']['mod'] == 0
    page.screenshot(path=str(OUT / 'equipment-attunement.png'))
    close_sheet(page)

    # A readable actor cannot create an advancement or edit its granted copies.
    readonly = browser.new_context(viewport={'width': 1280, 'height': 900})
    readonly.add_cookies([{**SEED['sessions']['reader'], 'url': BASE}])
    reader = readonly.new_page()
    reader.goto(BASE + '/game/' + SEED['campaign'])
    reader.wait_for_function('!!window.gravewrightActors')
    reader_sheet = open_sheet(reader)
    before = raw(reader)
    drop(reader, reader_sheet, high)
    reader.wait_for_timeout(700)
    assert raw(reader) == before
    expect(reader.locator('.gw5-advancement-modal')).to_have_count(0)
    expect(reader.locator('dialog')).to_have_count(0)
    assert not errors, errors
    print('PASS: SRD origins/backgrounds/classes/spells/equipment, atomic cancel, replacement/removal, level progression, attunement and read-only access')
    browser.close()
