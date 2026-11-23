"""Measure real package combat requests and latency on a disposable host table.

Use the same host, browser, participant count and repetitions for both archives.
Results include localhost UI latency, not an estimate of Internet latency.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import statistics
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from combat_order import action, resolve_host, show_tracker, state
from review_server import available_port, configure_environment, create_fixture


def serve(args):
    root = resolve_host(args.host_root)
    fixture = args.fixture.resolve()
    fixture.mkdir(parents=True, exist_ok=False)
    configure_environment(root, fixture, args.port)
    seed = create_fixture(root, fixture, args.archive.resolve())
    from django.conf import settings
    from django.core.management import call_command
    from gravewright.actors.models import Actor
    from gravewright.combat.models import Encounter
    from gravewright.tokens.models import Token

    assert Path(settings.DATABASES['default']['NAME']).resolve() == fixture / 'review.sqlite3'
    template = Actor.objects.get(pk=seed['actor'])
    Token.objects.filter(scene_id=seed['scene']).delete()
    tokens = []
    for index in range(args.participants):
        data = {**deepcopy(template.data), 'rulesEdition': '2024' if index % 2 else '2014',
                'init_misc': index, 'init': index + 3}
        actor = Actor.objects.create(campaign_id=seed['campaign'], name=f'Combatant {index:02}',
            type='character' if index % 2 else 'monster', data=data, permissions=template.permissions)
        token = Token.objects.create(scene_id=seed['scene'], actor=actor, linked=index % 3 != 0,
            snapshot=deepcopy(data) if index % 3 == 0 else {}, grid_x=index % 8, grid_y=index // 8)
        tokens.append(token)
    Encounter.objects.create(scene_id=seed['scene'], active=True, round=1, turn=0,
        config={'formula': args.formula, '_encounter_id': str(uuid4())},
        combatants=[{'tokenId': str(token.pk), 'initiative': None, 'defeated': False,
                     'hidden': False} for token in tokens])
    seed['base'] = f'http://127.0.0.1:{args.port}'
    args.seed.write_text(json.dumps(seed), encoding='utf-8')
    call_command('runserver', f'127.0.0.1:{args.port}', use_reloader=False, verbosity=0)


def measure(seed, args):
    requests, errors, failures, timings, outcomes = [], [], [], [], []
    pending_requests = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=str(args.browser_executable))
        contexts, pages = {}, {}
        for role in ('gm', 'player'):
            context = browser.new_context(viewport={'width': 1366, 'height': 900})
            context.add_cookies([{**seed['sessions'][role], 'url': seed['base']}])
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            if role == 'gm':
                def record(request):
                    if '/modules/gravewright.5e-srd/api' in request.url:
                        body = request.post_data_json or {}
                        label = f"{body.get('domain')}.{body.get('method')}"
                    elif '/modules/gravewright.5e-srd/storage' in request.url:
                        body = request.post_data_json or {}
                        label = f"storage.{request.method}.{body.get('scope', '')}"
                    else:
                        return
                    requests.append(label)
                    pending_requests[request] = label
                def finished(request):
                    label = pending_requests.pop(request, None)
                    if label is None:
                        return
                    timing = request.timing
                    timings.append({'method': label, 'started': timing['startTime'],
                                    'milliseconds': round(timing['responseEnd'], 3)})
                    if label in ('combat.rollInitiativeBatch', 'dice.roll'):
                        response = request.response()
                        if response and response.ok:
                            outcomes.append({'method': label, 'value': response.json()['value']})
                page.on('request', record)
                page.on('requestfinished', finished)
                page.on('response', lambda response: failures.append({'url': response.url,
                    'body': response.text()}) if response.status >= 400 and '/modules/gravewright.5e-srd/' in response.url else None)
            page.goto(seed['base'] + '/game/' + seed['campaign'])
            show_tracker(page)
            page.locator('[data-panel="chat"]').click()
            expect(page.locator('#chat-panel')).to_be_visible()
            # Keep both real windows visible without covering combat controls.
            page.locator('#chat-panel').evaluate("node=>Object.assign(node.style,{left:'20px',top:'90px',right:'auto',width:'420px',height:'650px'})")
            page.locator('#combat-panel').evaluate("node=>Object.assign(node.style,{left:'700px',top:'90px',right:'auto',width:'600px',height:'650px'})")
            page.evaluate('''() => {
              const clock=()=>performance.timeOrigin+performance.now();
              const probe=window.combatProbe={frames:[],started:0,action:''};
              probe.capture=()=>{
                const root=document.querySelector('.gw5-combat');
                probe.frames.push({time:clock(),
                  busy:root.querySelector('.gw-combat-panel__state').getAttribute('aria-busy')==='true',
                  enabled:!root.querySelector('[data-gw5-combat-action="initiative/roll-all"]')?.disabled,
                  current:root.querySelector('.gw-combat-header__current')?.textContent||'',
                  rows:[...root.querySelectorAll('[data-gw5-combatant-id]')].map(row=>{
                    const score=row.querySelector('.gw-combat-combatant__score');
                    return [row.dataset.gw5CombatantId,score.value??score.textContent];
                  }),chat:[...document.querySelectorAll('#chat-log [data-message-id]')].map(node=>node.dataset.messageId)});
              };
              let scheduled=false;
              const observer=new MutationObserver(()=>{
                if(scheduled)return;scheduled=true;
                requestAnimationFrame(()=>{scheduled=false;probe.capture();});
              });
              observer.observe(document.querySelector('.gw5-combat'),{subtree:true,childList:true,attributes:true});
              observer.observe(document.querySelector('#chat-log'),{subtree:true,childList:true});
              document.addEventListener('click',event=>{
                if(event.target.closest('[data-gw5-combat-action]')?.dataset.gw5CombatAction===probe.action)probe.started=clock();
              },true);
              probe.matches=(frame,expected)=>frame.time>=expected.started&&frame.current===expected.current
                &&JSON.stringify(frame.rows)===JSON.stringify(expected.rows)
                &&expected.messages.every(id=>frame.chat.includes(id))&&(!expected.controls||!frame.busy&&frame.enabled);
            }''')
            contexts[role], pages[role] = context, page
        gm, player = pages['gm'], pages['player']
        tracker = show_tracker(gm)
        gm.wait_for_timeout(1200)
        gm.evaluate('''() => {
          window.combatRenders = 0;
          new MutationObserver(changes => {
            window.combatRenders += changes.filter(change => change.type === 'childList').length;
          }).observe(document.querySelector('.gw5-combat .gw-combat-panel__state'), {childList: true});
        }''')
        samples = []
        for command, repetitions in [('initiative/roll-all', args.repetitions), ('turn/next', args.repetitions)]:
            for sample in range(repetitions):
                # Separate operation latency from the host's existing 20/10s
                # chat budget. Use --roll-interval 0.5 to test rapid batches.
                gm.wait_for_timeout(args.roll_interval * 1000 if command == 'initiative/roll-all' and sample else 500)
                first, renders = len(requests), gm.evaluate('combatRenders')
                first_timing, first_outcome = len(timings), len(outcomes)
                for page in pages.values():
                    page.evaluate('action=>{combatProbe.frames=[];combatProbe.started=0;combatProbe.action=action;}', command)
                started = time.perf_counter()
                action(tracker, command).click()
                expect(tracker.locator('.gw-combat-panel__state')).not_to_have_attribute('aria-busy', 'true', timeout=120000)
                elapsed = (time.perf_counter() - started) * 1000
                clicked = gm.evaluate('combatProbe.started')
                own = requests[first:]
                assert tracker.locator('[data-gw5-combat-action="retry"]').count() == 0, {
                    'panel': tracker.inner_text(), 'failures': failures, 'requests': dict(Counter(own))}
                actual = state(gm, seed)
                assert len(actual['combatants']) == args.participants
                if command == 'initiative/roll-all':
                    assert actual['turn'] == 0
                    if args.formula == '@init':
                        assert [entry['initiative'] for entry in actual['combatants']] == list(range(args.participants + 2, 2, -1))
                    else:
                        values = [entry['initiative'] for entry in actual['combatants']]
                        assert values == sorted(values, reverse=True)
                        for entry in actual['combatants']:
                            base = int(entry['name'].rsplit(' ', 1)[1]) + 3
                            assert base + 1 <= entry['initiative'] <= base + 20
                current = actual['combatants'][actual['turn']]['initiative']
                expect(player.locator('.gw5-combat .gw-combat-header__current')).to_have_text(actual['current_name'], timeout=20000)
                messages = []
                for outcome in outcomes[first_outcome:]:
                    messages.extend(outcome['value']['batch']['messageIds'] if outcome['method']=='combat.rollInitiativeBatch'
                                    else [outcome['value']['id']])
                if command == 'initiative/roll-all':
                    assert messages, 'The initiative must publish its audited results to chat.'
                expected = {'started': clicked, 'current': actual['current_name'], 'messages': messages,
                            'rows': [[entry['id'], str(entry['initiative'])] for entry in actual['combatants']]}
                ready = {}
                for role, page in pages.items():
                    desired = {**expected, 'controls': role=='gm'}
                    page.wait_for_function('expected=>combatProbe.frames.some(frame=>combatProbe.matches(frame,expected))', arg=desired, timeout=20000)
                    ready[role] = page.evaluate('expected=>combatProbe.frames.find(frame=>combatProbe.matches(frame,expected)).time', desired)
                    if command == 'initiative/roll-all':
                        assert sum(page.locator(f'#chat-log [data-message-id="{identifier}"] .dice-result__summary').count()
                                   for identifier in messages) == args.participants
                own_timings = [row for row in timings[first_timing:] if row['started'] >= clicked]
                grouped = {}
                for timing in own_timings:
                    grouped.setdefault(timing['method'], []).append(timing['milliseconds'])
                row = {'command': command, 'sample': sample, 'milliseconds': round(elapsed, 3),
                       'gmVisibleMilliseconds': round(ready['gm'] - clicked, 3),
                       'playerVisibleMilliseconds': round(ready['player'] - clicked, 3),
                       'fullFlowMilliseconds': round(max(ready.values()) - clicked, 3),
                       'chatMessages': len(messages),
                       'requests': dict(Counter(own)), 'totalRequests': len(own),
                       'childListMutations': gm.evaluate('combatRenders') - renders,
                       'http': {method: {'count': len(values), 'medianMilliseconds': round(statistics.median(values), 3),
                                        'p95Milliseconds': round(sorted(values)[math.ceil(len(values)*.95)-1], 3)}
                                for method, values in grouped.items()},
                       'requestTimings': [{**timing,'started':round(timing['started']-clicked,3)} for timing in own_timings]}
                samples.append(row)
                print(json.dumps(row), flush=True)
        tracker.screenshot(path=str(args.output / 'tracker.png'))
        assert not errors, errors
        browser.close()
    return {'participants': args.participants, 'formula': args.formula, 'rollIntervalSeconds': args.roll_interval,
            'samples': samples, 'pageErrors': errors, 'failedResponses': failures,
            'medianMilliseconds': {command: round(statistics.median(row['milliseconds'] for row in samples
                if row['command'] == command), 3) for command in ('initiative/roll-all', 'turn/next')},
            'medianFullFlowMilliseconds': {command: round(statistics.median(row['fullFlowMilliseconds'] for row in samples
                if row['command'] == command), 3) for command in ('initiative/roll-all', 'turn/next')}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root', required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser-executable', type=Path, required=True)
    parser.add_argument('--participants', type=int, default=20)
    parser.add_argument('--repetitions', type=int, default=3)
    parser.add_argument('--formula', default='@init', choices=('@init', '1d20 + @init'))
    parser.add_argument('--roll-interval', type=float, default=10.1,
                        help='Seconds between initiative batches; use 0.5 to exercise the host chat budget.')
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--fixture', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--seed', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--port', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = resolve_host(args.host_root)
    sys.path.insert(0, str(root))
    from scripts.runtime_storage import configure_runtime_storage
    configure_runtime_storage(root, root / 'data/runner')
    if args.serve:
        serve(args)
        return
    if not 2 <= args.participants <= 64 or args.repetitions < 1 or args.roll_interval < 0:
        parser.error('Use 2–64 participants and at least one repetition.')
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    initial_env = hashlib.sha256((root / '.env').read_bytes()).hexdigest() if (root / '.env').is_file() else None
    digest = hashlib.sha256(args.archive.read_bytes()).hexdigest()
    fixture = root / 'data' / ('dnd-perf-' + secrets.token_hex(3))
    seed_file = args.output / 'seed.json'
    port = available_port(30049)
    with (args.output / 'server.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()),
            '--host-root', str(root), '--archive', str(args.archive.resolve()), '--output', str(args.output),
            '--browser-executable', str(args.browser_executable.resolve()), '--participants', str(args.participants),
            '--formula', args.formula,
            '--serve', '--fixture', str(fixture), '--seed', str(seed_file), '--port', str(port)],
            cwd=args.output, stdout=log, stderr=log, env={**os.environ, 'PYTHON_DOTENV_DISABLED': '1'})
        try:
            localhost = build_opener(ProxyHandler({}))
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Fixture exited: {args.output / "server.log"}')
                if seed_file.is_file():
                    seed = json.loads(seed_file.read_text(encoding='utf-8'))
                    try:
                        with localhost.open(seed['base'] + '/api/auth/status', timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        pass
                time.sleep(.1)
            else:
                raise RuntimeError('Fixture startup timed out.')
            result = measure(seed, args)
            result['archiveSha256'] = digest
            (args.output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result['medianMilliseconds']), flush=True)
        finally:
            process.terminate()
            process.wait(timeout=15)
            final_env = hashlib.sha256((root / '.env').read_bytes()).hexdigest() if (root / '.env').is_file() else None
            assert initial_env == final_env, 'The real host .env changed.'
            assert digest == hashlib.sha256(args.archive.read_bytes()).hexdigest(), 'Archive changed during measurement.'


if __name__ == '__main__':
    main()
