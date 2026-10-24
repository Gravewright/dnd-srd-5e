"""Verify initiative order, progress and retry on a disposable current VTT host.

This scenario installs the source build into short installation-local fixture
paths. It never opens an existing campaign or changes the host's .env file.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from review_server import MODULE, available_port, configure_environment, create_fixture, default_archive


SCOPED_API = '**/api/tables/*/modules/gravewright.5e-srd/api'
PROGRESS = 'Rolling initiatives…'
INCOMPLETE = 'A combat operation is incomplete.'


def resolve_host(value):
    configured = value or os.environ.get('GRAVEWRIGHT_TEST_HOST_ROOT')
    candidates = ([Path(configured)] if configured else []) + list(MODULE.parents)
    for candidate in candidates:
        root = candidate.resolve()
        if (root / 'manage.py').is_file() and (root / 'gravewright/modules').is_dir():
            return root
    raise RuntimeError('Pass --host-root to an existing Gravewright VTT checkout.')


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def seed_order(seed):
    """Create synthetic copies only after review_server selected its database."""
    from django.conf import settings
    from gravewright.actors.models import Actor
    from gravewright.campaigns.models import Membership
    from gravewright.combat.models import Encounter
    from gravewright.maps.models import Scene
    from gravewright.tokens.models import Token

    fixture = Path(seed['fixture'])
    assert Path(settings.DATABASES['default']['NAME']).resolve() == fixture / 'review.sqlite3'
    hero = Actor.objects.get(pk=seed['actor'])
    hero.name = 'a'
    hero.data = {**hero.data, 'abilities': {'dex': {'score': 10}}, 'init_misc': 7,
                 'conditions': [], 'effects': []}
    hero.save(update_fields=['name', 'data'])
    monster = Actor.objects.get(pk=seed['monster'])
    monster.name = 'b'
    monster.data = {**deepcopy(hero.data), 'init_misc': 0}
    monster.save(update_fields=['name', 'data'])
    scene = Scene.objects.get(pk=seed['scene'])
    linked = Token.objects.get(pk=seed['linkedToken'])
    Token.objects.filter(scene=scene).exclude(pk=linked.pk).delete()
    tokens = [linked]
    for index, score in enumerate((20, 16, 14, 2)):
        tokens.append(Token.objects.create(scene=scene, actor=monster, linked=False,
            snapshot={**deepcopy(monster.data), 'init_misc': score},
            grid_x=5 + index % 2 * 2, grid_y=2 + index // 2 * 2))
    Encounter.objects.create(scene=scene, active=True, round=3, turn=0,
        config={'formula': '@init', '_encounter_id': str(uuid4())},
        combatants=[{'tokenId': str(token.pk), 'initiative': None,
                     'defeated': False, 'hidden': False} for token in tokens])
    Membership.objects.filter(campaign_id=seed['campaign'], user_id=seed['users']['reader']).update(role='gm')
    seed['sessions']['other-gm'] = seed['sessions']['reader']
    seed['orderedTokens'] = [str(token.pk) for token in tokens[1:4]] + [str(linked.pk), str(tokens[4].pk)]
    return seed


def serve(args):
    root = resolve_host(args.host_root)
    fixture = args.fixture.resolve()
    if fixture.exists() and any(fixture.iterdir()):
        raise RuntimeError('Use a fresh disposable fixture directory.')
    fixture.mkdir(parents=True, exist_ok=True)
    configure_environment(root, fixture, args.port)
    seed = seed_order(create_fixture(root, fixture, args.archive.resolve()))
    seed['base'] = f'http://127.0.0.1:{args.port}'
    args.seed.write_text(json.dumps(seed, indent=2), encoding='utf-8')
    from django.core.management import call_command
    call_command('runserver', f'127.0.0.1:{args.port}', use_reloader=False, verbosity=0)


def start_fixture(root, output, archive):
    fixture = root / 'data' / ('cbf-' + secrets.token_hex(3))
    seed_file = output / 'seed.json'
    log = (output / 'server.log').open('w', encoding='utf-8')
    port = available_port(30039)
    process = subprocess.Popen([sys.executable, '-B', '-X', 'utf8', str(Path(__file__).resolve()),
        '--serve', '--host-root', str(root), '--archive', str(archive), '--fixture', str(fixture),
        '--seed', str(seed_file), '--port', str(port)], cwd=output, stdout=log, stderr=log,
        env={**os.environ, 'PYTHON_DOTENV_DISABLED': '1', 'PYTHONDONTWRITEBYTECODE': '1'})
    localhost = build_opener(ProxyHandler({}))
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'Fixture exited: {output / "server.log"}')
            if seed_file.is_file():
                seed = json.loads(seed_file.read_text(encoding='utf-8'))
                try:
                    with localhost.open(seed['base'] + '/api/auth/status', timeout=1) as response:
                        if response.status == 200:
                            return process, log, seed
                except OSError:
                    pass
            time.sleep(.1)
        raise RuntimeError(f'Fixture startup timed out: {output / "server.log"}')
    except BaseException:
        process.terminate()
        process.wait(timeout=15)
        log.close()
        raise


def state(page, seed):
    return page.evaluate('sceneId=>gravewright.combat.state({sceneId})', seed['scene'])


def show_tracker(page):
    page.wait_for_function('!!window.gravewright')
    panel = page.locator('#combat-panel')
    if not panel.is_visible():
        page.locator('[data-native-directory-toggle="combat"]').click()
    tracker = panel.locator('.gw5-combat')
    expect(tracker).to_be_visible(timeout=20000)
    return tracker


def action(tracker, name):
    return tracker.locator(f'[data-gw5-combat-action="{name}"]')


def settled(tracker):
    expect(tracker.locator('.gw-combat-panel__state')).not_to_have_attribute('aria-busy', 'true', timeout=30000)


def current_scores(page, seed):
    current = state(page, seed)
    return current, [row['initiative'] for row in current['combatants']]


def screenshot(page, tracker, output, name):
    tracker.screenshot(path=str(output / (name + '.png')))


def small_panel_menu(page, tracker, seed, output):
    """Exercise a last-row popup in the same short window as the bug report."""
    panel = page.locator('#combat-panel')
    previous_style = panel.get_attribute('style') or ''
    previous_tracker_style = tracker.get_attribute('style') or ''
    page.set_viewport_size({'width': 390, 'height': 600})
    panel.evaluate('''panel=>Object.assign(panel.style,{
      left:'8px',top:'80px',right:'auto',width:'370px',height:'350px',maxHeight:'350px'
    })''')
    tracker.evaluate("node=>Object.assign(node.style,{height:'250px',maxHeight:'250px'})")
    listing = tracker.locator('.gw-combat-list')
    expect(listing).to_be_visible()
    assert listing.evaluate('node=>node.scrollHeight>node.clientHeight'), 'The fixture must actually scroll.'
    listing.evaluate('node=>{node.scrollTop=node.scrollHeight;}')
    last = tracker.locator('.gw-combat-combatant').last
    trigger = last.locator('.gw-combat-menu__trigger')
    trigger.click()
    popup = page.locator('body > .gw5-combat-menu')
    expect(popup.get_by_role('menu')).to_be_visible()
    box = popup.bounding_box()
    assert box and box['x'] >= 8 and box['y'] >= 8, box
    assert box['x'] + box['width'] <= 382 and box['y'] + box['height'] <= 592, box
    assert popup.evaluate('node=>node.parentElement===document.body')
    expect(action(popup, 'combatants/remove')).to_be_visible()
    page.keyboard.press('End')
    assert action(popup, 'combatants/remove').evaluate('node=>node===document.activeElement')
    screenshot(page, popup, output, 'actions-mobile')
    page.screenshot(path=str(output / 'actions-small-panel.png'))
    page.keyboard.press('Escape')
    expect(popup).to_have_count(0)
    expect(panel).to_be_visible()
    assert trigger.evaluate('node=>node===document.activeElement'), 'Escape must return focus to its trigger.'
    trigger.click()
    page.locator('#combat-panel > header').click()
    expect(popup).to_have_count(0)
    trigger.click()
    action(popup, 'turn/set').click()
    settled(tracker)
    changed = state(page, seed)
    assert changed['combatants'][changed['turn']]['id'] == seed['orderedTokens'][-1]
    tracker.locator('.gw-combat-combatant').first.locator('.gw-combat-menu__trigger').click()
    action(popup, 'turn/set').click()
    settled(tracker)
    changed = state(page, seed)
    assert changed['turn'] == 0 and changed['combatants'][0]['initiative'] == 20
    assert changed['round'] == 1, 'Menu turn selection must not advance the round.'
    page.set_viewport_size({'width': 1366, 'height': 900})
    panel.evaluate('(panel,style)=>{panel.style.cssText=style;}', previous_style)
    tracker.evaluate('(node,style)=>{node.style.cssText=style;}', previous_tracker_style)
    return {'bodyPortal': True, 'viewportBounds': True, 'escapeRestoresFocus': True,
            'outsideClick': True, 'selectedCorrectToken': True}


def smoke(seed, output, executable):
    requests, errors, held = [], [], []
    with sync_playwright() as playwright:
        options = {'executable_path': str(executable)} if executable else {}
        browser = playwright.chromium.launch(**options, env={**os.environ, 'CHROME_LOG_FILE': str(output / 'chromium.log')})
        contexts = {}
        pages = {}
        def record(request):
            if '/modules/gravewright.5e-srd/api' in request.url:
                requests.append(request.post_data_json or {})
        for role in ('gm', 'other-gm'):
            context = browser.new_context(viewport={'width': 1366, 'height': 900})
            context.add_cookies([{**seed['sessions'][role], 'url': seed['base']}])
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            if role == 'gm':
                page.on('request', record)
            page.goto(seed['base'] + '/game/' + seed['campaign'])
            contexts[role], pages[role] = context, page
        gm, other = pages['gm'], pages['other-gm']
        tracker, observer = show_tracker(gm), show_tracker(other)
        fixture_state = state(gm, seed)
        assert fixture_state['round'] == 3 and fixture_state['combatants'][fixture_state['turn']]['id'] == seed['linkedToken']
        # Reproduce the actual reported sequence, rather than relying only on
        # an encounter created active by the fixture: Start, then Roll all.
        action(tracker, 'end').click()
        settled(tracker)
        assert state(gm, seed)['active'] is False
        action(tracker, 'start').click()
        settled(tracker)
        initial = state(gm, seed)
        assert initial['active'] and initial['round'] == 1
        assert initial['combatants'][initial['turn']]['id'] == seed['linkedToken']
        def hold_dice(route):
            body = route.request.post_data_json or {}
            if not held and body.get('domain') == 'dice' and body.get('method') == 'roll':
                held.append(route)
            else:
                route.continue_()
        gm.route(SCOPED_API, hold_dice)
        start = len(requests)
        action(tracker, 'initiative/roll-all').click()
        expect(tracker.get_by_text(PROGRESS, exact=True)).to_be_visible()
        expect(tracker.get_by_text(INCOMPLETE, exact=False)).to_have_count(0)
        expect(action(tracker, 'retry')).to_have_count(0)
        expect(observer.get_by_text(PROGRESS, exact=True)).to_be_visible(timeout=10000)
        expect(observer.get_by_text(INCOMPLETE, exact=False)).to_have_count(0)
        expect(action(observer, 'retry')).to_have_count(0)
        deadline = time.monotonic() + 20
        while not held and time.monotonic() < deadline:
            gm.wait_for_timeout(50)
        assert held, 'The deterministic native roll must remain in flight during the progress check.'
        screenshot(gm, tracker, output, 'progress-desktop')
        gm.set_viewport_size({'width': 390, 'height': 844})
        screenshot(gm, tracker, output, 'progress-mobile')
        gm.set_viewport_size({'width': 1366, 'height': 900})
        held[0].continue_()
        settled(tracker)
        gm.unroute(SCOPED_API, hold_dice)
        final, scores = current_scores(gm, seed)
        assert scores == [20, 16, 14, 7, 2], scores
        assert [row['id'] for row in final['combatants']] == seed['orderedTokens']
        assert final['turn'] == 0 and final['round'] == initial['round']
        expect(tracker.locator('.gw-combat-combatant.is-current [data-gw5-combat-initiative]')).to_have_value('20')
        first_calls = requests[start:]
        def calls(rows, domain, method):
            return [row for row in rows if row.get('domain') == domain and row.get('method') == method]
        assert len(calls(first_calls, 'dice', 'roll')) == 5
        assert len(calls(first_calls, 'combat', 'setInitiative')) == 5
        assert len(calls(first_calls, 'combat', 'setTurn')) == 1
        expect(tracker.get_by_text(PROGRESS, exact=True)).to_have_count(0)
        expect(tracker.get_by_text(INCOMPLETE, exact=False)).to_have_count(0)
        screenshot(gm, tracker, output, 'ordered-desktop')
        menu_checks = small_panel_menu(gm, tracker, seed, output)
        sequence = []
        for expected in (16, 14, 7, 2, 20):
            action(tracker, 'turn/next').click()
            settled(tracker)
            current = state(gm, seed)
            score = current['combatants'][current['turn']]['initiative']
            assert score == expected, (score, expected)
            expect(tracker.locator('.gw-combat-combatant.is-current [data-gw5-combat-initiative]')).to_have_value(str(expected))
            sequence.append(score)
        assert current['round'] == initial['round'] + 1

        # Move the current participant away from first before a second roll-all.
        gm.evaluate('''async({sceneId,tokenId})=>{
          const current=await gravewright.combat.state({sceneId});
          await gravewright.combat.setTurn({sceneId,tokenId,version:current.version});
        }''', {'sceneId': seed['scene'], 'tokenId': seed['linkedToken']})
        expect(tracker.locator('.gw-combat-combatant.is-current')).to_have_count(1)
        lost = []
        def lose_set_turn(route):
            body = route.request.post_data_json or {}
            if not lost and body.get('domain') == 'combat' and body.get('method') == 'setTurn':
                response = route.fetch()
                assert response.ok, response.text()
                lost.append(body)
                route.fulfill(status=503, json={'error': 'unavailable'})
            else:
                route.continue_()
        gm.route(SCOPED_API, lose_set_turn)
        recovery_start = len(requests)
        action(tracker, 'initiative/roll-all').click()
        expect(tracker.get_by_text(INCOMPLETE, exact=False)).to_be_visible(timeout=30000)
        settled(tracker)
        expect(action(tracker, 'retry')).to_be_enabled()
        assert len(lost) == 1
        accepted = state(gm, seed)
        assert accepted['turn'] == 0
        screenshot(gm, tracker, output, 'recoverable-failure')
        expect(observer.get_by_text(PROGRESS, exact=True)).to_be_visible(timeout=10000)
        expect(observer.get_by_text(INCOMPLETE, exact=False)).to_have_count(0)
        expect(action(observer, 'retry')).to_have_count(0)

        # A remount has no local task closure; it must recover from private intent.
        gm.close()
        gm = contexts['gm'].new_page()
        gm.on('request', record)
        gm.on('pageerror', lambda error: errors.append(str(error)))
        gm.goto(seed['base'] + '/game/' + seed['campaign'])
        tracker = show_tracker(gm)
        expect(tracker.get_by_text(PROGRESS, exact=True)).to_be_visible()
        expect(tracker.get_by_text(INCOMPLETE, exact=False)).to_have_count(0)
        expect(action(tracker, 'retry')).to_be_enabled()
        screenshot(gm, tracker, output, 'resume-desktop')
        gm.set_viewport_size({'width': 390, 'height': 844})
        screenshot(gm, tracker, output, 'resume-mobile')
        gm.set_viewport_size({'width': 1366, 'height': 900})
        action(tracker, 'retry').click()
        settled(tracker)
        recovered = state(gm, seed)
        assert recovered['version'] == accepted['version'], 'Retry must replay setTurn without accepting a second mutation.'
        assert recovered['round'] == accepted['round'] and recovered['turn'] == 0
        expect(tracker.locator('.gw-combat-combatant.is-current [data-gw5-combat-initiative]')).to_have_value('20')
        recovery_calls = requests[recovery_start:]
        assert len(calls(recovery_calls, 'dice', 'roll')) == 5
        assert len(calls(recovery_calls, 'combat', 'setInitiative')) == 5
        turn_calls = calls(recovery_calls, 'combat', 'setTurn')
        assert len(turn_calls) == 2 and turn_calls[0]['requestId'] == turn_calls[1]['requestId'], turn_calls
        expect(tracker.get_by_text(PROGRESS, exact=True)).to_have_count(0)
        expect(action(tracker, 'retry')).to_have_count(0)
        gm.set_viewport_size({'width': 390, 'height': 844})
        screenshot(gm, tracker, output, 'ordered-mobile')
        assert not errors, errors
        browser.close()
    return {'result': 'PASS', 'fixture': seed['fixture'], 'host': seed['host'], 'package': seed['package'],
        'initialScores': [20, 16, 14, 7, 2], 'nextTurns': sequence, 'initialRound': initial['round'],
        'roundAfterWrap': current['round'], 'firstBatch': {'rolls': 5, 'initiativeWrites': 5, 'turnSelection': 1},
        'recoveryRequestId': turn_calls[0]['requestId'], 'recoveryReusedRolls': True,
        'recoveryPreservedVersion': True, 'otherGMProgress': True, 'startThenRollAll': True,
        'smallPanelMenu': menu_checks, 'pageErrors': errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--archive', type=Path, default=default_archive())
    parser.add_argument('--browser-executable', type=Path)
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--fixture', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--seed', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--port', type=int, default=30039, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        serve(args)
        return
    root = resolve_host(args.host_root)
    output = (args.output or root / 'data/runner/5e-combat-fix-20261024/browser').resolve()
    if output.exists() and any(output.iterdir()):
        raise RuntimeError('Use a new empty output directory.')
    output.mkdir(parents=True, exist_ok=True)
    temporary = output / 'tmp'
    temporary.mkdir()
    os.environ.update(TMP=str(temporary), TEMP=str(temporary), TMPDIR=str(temporary))
    original_env = fingerprint(root / '.env')
    archive = args.archive.resolve()
    archive_digest = fingerprint(archive)
    if archive_digest is None:
        raise RuntimeError('Build the source package before running this scenario.')
    process = log = None
    try:
        process, log, seed = start_fixture(root, output, archive)
        result = smoke(seed, output, args.browser_executable.resolve() if args.browser_executable else None)
        result['archiveSha256'] = archive_digest
        (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result), flush=True)
    finally:
        if process is not None:
            process.terminate()
            process.wait(timeout=15)
        if log is not None:
            log.close()
        assert fingerprint(root / '.env') == original_env, 'The real host configuration changed.'
        assert fingerprint(archive) == archive_digest, 'The source build changed during the scenario.'


if __name__ == '__main__':
    main()
