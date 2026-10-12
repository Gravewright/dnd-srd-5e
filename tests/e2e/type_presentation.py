"""Verify native item presentation comes from the installed module declarations."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

from host_paths import ROOT, MODULE
SEED = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf-8'))
assert Path(SEED['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30009')
MANIFEST = json.loads((MODULE / 'manifest.json').read_text(encoding='utf-8'))
LABELS = json.loads((MODULE / 'locales/pt-BR.json').read_text(encoding='utf-8'))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_cookies([{**SEED['sessions']['gm'], 'url': BASE}])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewright')
    page.locator('[data-native-directory-toggle="items"]').click()
    panel = page.locator('[data-native-directory="items"]')
    row = panel.locator(f'[data-item-id="{SEED["item"]}"]')
    label = row.locator('.item-directory__info small')
    expect(label).to_have_text(LABELS['itemType.weapon'])
    assert row.locator('.item-directory__open > svg').evaluate('(icon)=>icon.outerHTML') == page.evaluate('document.getElementById("item-directory-icons").content.querySelector("[data-item-icon=" + CSS.escape("Sword") + "] > svg").outerHTML')
    panel.locator('[data-create]').click()
    form = page.locator('.table-form-modal[data-window-key="item:create"]')
    expected = [{'id': item['id'], 'label': LABELS[item['labelKey']]} for item in MANIFEST['system']['itemTypes']]
    assert form.locator('[name="type"] option').evaluate_all('(options)=>options.map(option=>({id:option.value,label:option.textContent}))') == expected
    page.evaluate('''async()=>{
      const {createTranslator}=await import('/static/gravewright_modules/i18n.js');
      window.__disposeTypeProbe=createTranslator('gravewright.5e-srd').register({en:{'itemType.weapon':'Provider label probe'},'pt-BR':{'itemType.weapon':'Rótulo do fornecedor'}});
    }''')
    expect(label).to_have_text('Rótulo do fornecedor')
    expect(form.locator('[name="type"] option[value="weapon"]')).to_have_text('Rótulo do fornecedor')
    page.evaluate('window.__disposeTypeProbe()')
    expect(label).to_have_text(LABELS['itemType.weapon'])
    expect(form.locator('[name="type"] option[value="weapon"]')).to_have_text(LABELS['itemType.weapon'])
    form.locator('[data-cancel]').click()
    expect(form).to_have_count(0)
    assert not errors, errors
    print(json.dumps({'passed': True, 'declaredTypes': len(expected), 'moduleLabels': True, 'moduleIcons': True, 'lateCatalogAndDisposal': True}))
    browser.close()
