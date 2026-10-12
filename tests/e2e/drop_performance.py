"""Measure actual compendium drops against the disposable system fixture."""
import json
import os
import sys
from pathlib import Path
from time import monotonic

from playwright.sync_api import sync_playwright, expect

from host_paths import ROOT, MODULE
SEED = json.loads((ROOT / 'data/5e-review-seed.json').read_text(encoding='utf-8'))
assert Path(SEED['fixture']).resolve().parent == (ROOT / 'data/5e-review').resolve()
BASE = os.environ.get('GRAVEWRIGHT_REVIEW_URL', 'http://127.0.0.1:30008')
LABEL = sys.argv[1] if len(sys.argv) > 1 else 'current'
RESULTS = ROOT / 'test-results/5e-drop-performance'
RESULTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_cookies([{**SEED['sessions']['gm'], 'url': BASE}])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/game/' + SEED['campaign'])
    page.wait_for_function('!!window.gravewright && !!window.gravewrightActors')
    packs = page.evaluate('async()=> (await window.gravewright.compendiums.state()).packs')
    results = []
    for name, edition in [('Dwarf', '2024'), ('High Elf', '2014'), ('Dwarf', '2024')]:
        original = json.loads((MODULE / f'compendiums/{edition}.json').read_text(encoding='utf-8'))
        entry = next(e for pack in original['packs'] for e in pack['entries'] if e['name'] == name and e['type'] == 'race')
        pack = next(pack for pack in packs if any(e['id'] == entry['id'] for e in pack['entries']))
        page.evaluate('''async args=>{
          const api=window.gravewright, view=await api.actors.sheet(args.actor);
          await api.actors.saveSheet({actorId:args.actor,name:view.name,version:view.version,sheetVersion:view.sheetVersion,
            data:{rulesEdition:args.edition,level:1,abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(a=>[a,{score:10}])),
              bars:{bar_1:{value:10,max:10},bar_2:{value:0,max:0}}}});
        }''', {'actor': SEED['actor'], 'edition': edition})
        page.evaluate('id=>window.gravewrightActors.open(id)', SEED['actor'])
        sheet = page.locator('.actor-directory__sheet .gw5-sheet')
        expect(sheet).to_be_visible(timeout=30000)
        ref = {'campaign': SEED['campaign'], 'kind': 'item', 'packId': pack['id'], 'id': entry['id']}
        transfer = page.evaluate_handle("ref=>{const d=new DataTransfer();d.setData('application/x-gravewright-compendium',JSON.stringify(ref));return d;}", ref)
        requests = []
        def capture(request):
            if request.method == 'POST' and '/modules/' in request.url:
                try:
                    payload = request.post_data_json
                    requests.append({'domain': payload.get('domain'), 'method': payload.get('method'), 'payload': payload.get('payload')})
                except Exception:
                    pass
        page.on('request', capture)
        page.evaluate('''name=>{
          window.dropBenchmark={start:performance.now()};
          const observer=new MutationObserver(()=>{
            const ready=name==='High Elf'?document.querySelector('.gw5-advancement-modal'):
              [...document.querySelectorAll('.actor-directory__sheet .gw5-header')].some(node=>node.textContent.includes(name));
            if(ready){window.dropBenchmark.elapsed=performance.now()-window.dropBenchmark.start;observer.disconnect();}
          });
          observer.observe(document.body,{childList:true,subtree:true});
        }''', name)
        started = monotonic()
        sheet.dispatch_event('dragover', {'dataTransfer': transfer})
        sheet.dispatch_event('drop', {'dataTransfer': transfer})
        transfer.dispose()
        if name == 'High Elf':
            modal = page.locator('.gw5-advancement-modal')
            expect(modal).to_be_visible(timeout=90000)
            elapsed = (monotonic() - started) * 1000
            modal.locator('.gw5-close').click()
        else:
            expect(sheet.locator('.gw5-header')).to_contain_text(name, timeout=90000)
            elapsed = (monotonic() - started) * 1000
            expect(sheet.locator('.gw5-save-status').last).to_have_attribute('data-state', 'saved', timeout=30000)
            data = page.evaluate('async id=>(await window.gravewright.actors.sheet(id)).data', SEED['actor'])
            assert data['race'] == name
            assert len(data['features']) >= 4
            assert data['senses']['darkvision'] == 120
        page.remove_listener('request', capture)
        elapsed = page.evaluate('window.dropBenchmark.elapsed') or elapsed
        results.append({'name': name, 'edition': edition, 'milliseconds': round(elapsed), 'requests': requests})
        print(json.dumps({'name': name, 'ms': round(elapsed), 'requests': len(requests)}), flush=True)
        page.locator('.actor-directory__sheet [data-window=close]').click()
        expect(page.locator('.actor-directory__sheet .gw5-sheet')).to_have_count(0)
    assert not errors, errors
    (RESULTS / f'{LABEL}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps([{'name': r['name'], 'ms': r['milliseconds'], 'requests': len(r['requests'])} for r in results]))
    browser.close()
