"""Read every installed SRD entry through the authorized public API."""
import json
import os
from collections import Counter
from pathlib import Path
from time import monotonic

from playwright.sync_api import sync_playwright

from host_paths import ROOT, MODULE
SEED = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf-8'))
assert Path(SEED['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30008')
EXPECTED = {item['id']: item for edition in ('2014', '2024')
            for pack in json.loads((MODULE / f'compendiums/{edition}.json').read_text(encoding='utf-8'))['packs']
            for item in pack['entries']}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context()
    context.add_cookies([{**SEED['sessions']['gm'], 'url': BASE}])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewright')
    before = page.evaluate('async()=>await window.gravewright.items.state()')
    packs = page.evaluate('async()=> (await window.gravewright.compendiums.state()).packs')
    packs = [pack for pack in packs if pack['id'].startswith('native:') and pack['systemId'] == 'gravewright.5e-srd']
    assert len(packs) == 20
    seen = set()
    calls = 0
    started = monotonic()
    for pack in packs:
        for entry in pack['entries']:
            assert 'data' not in entry, 'The index must contain metadata, not document bodies'
            assert entry['type'] == EXPECTED[entry['id']]['type']
        ids = [entry['id'] for entry in pack['entries']]
        for start in range(0, len(ids), 100):
            batch = ids[start:start + 100]
            result = page.evaluate('async payload=>await window.gravewright.compendiums.read(payload)', {'packId': pack['id'], 'ids': batch})
            calls += 1
            assert [entry['id'] for entry in result['entries']] == batch
            for entry in result['entries']:
                assert entry == EXPECTED[entry['id']], f"Document changed in transit: {entry['name']}"
                assert entry['id'] not in seen
                seen.add(entry['id'])
    elapsed = round((monotonic() - started) * 1000)
    assert seen == set(EXPECTED)
    assert page.evaluate('async()=>await window.gravewright.items.state()') == before
    assert not errors, errors
    summary = {'entries': len(seen), 'packs': len(packs), 'batchReads': calls, 'readMilliseconds': elapsed,
               'types': dict(Counter(entry['type'] for entry in EXPECTED.values()))}
    output = ROOT / 'test-results/5e-compendium'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'authorized-roundtrip.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary))
    browser.close()
