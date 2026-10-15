"""DnD initiative, effect clocks and recovery on the original VTT 0.2.3.

Build the single system ZIP first. This starts its own isolated native host;
existing .env files, campaigns, installed packages and databases are preserved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener

from playwright.sync_api import expect, sync_playwright

from review_server import MODULE, default_archive, host_root

SCOPED_API='**/api/tables/*/modules/gravewright.5e-srd/api'


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def start_fixture(root,output,archive,port):
    seed_file=output/'seed.json'
    log=(output/'server.log').open('w',encoding='utf-8')
    workspace=next(parent for parent in MODULE.parents if (parent/'manage.py').is_file())
    fixture=workspace/'data'/f'dc-{secrets.token_hex(4)}'
    process=subprocess.Popen([sys.executable,'-B','-X','utf8',str(Path(__file__).with_name('review_server.py')),
        '--host-root',str(root),'--archive',str(archive),'--fixture',str(fixture),
        '--seed',str(seed_file),'--port',str(port)],cwd=output,stdout=log,stderr=log,
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHON_DOTENV_DISABLED':'1'})
    localhost=build_opener(ProxyHandler({}))
    try:
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if process.poll() is not None:raise RuntimeError(f'Fixture exited: {output / "server.log"}')
            if seed_file.exists():
                seed=json.loads(seed_file.read_text(encoding='utf-8'))
                try:
                    with localhost.open(seed['base']+'/api/auth/status',timeout=1) as response:
                        if response.status==200:return process,log,seed
                except OSError:pass
            time.sleep(.1)
        raise RuntimeError(f'Fixture timeout: {output / "server.log"}')
    except BaseException:
        process.terminate();process.wait(timeout=15);log.close();raise


def native(page,seed):
    return page.evaluate('async sceneId=>await gravewright.combat.state({sceneId})',seed['scene'])


def actor(page,id,token=None):
    return page.evaluate('async({id,token})=>await gravewright.actors.sheet(id,token?{tokenId:token}:{})',{'id':id,'token':token})


def set_data(page,id,data,token=None):
    return page.evaluate('''async({id,token,data})=>{
      const view=await gravewright.actors.sheet(id,token?{tokenId:token}:{});
      return gravewright.actors.saveSheet({actorId:id,tokenId:token,name:view.name,version:view.version,
        sheetVersion:view.sheetVersion,data:{...view.data,...data}});
    }''',{'id':id,'token':token,'data':data})


def show_tracker(page):
    if not page.locator('#combat-panel').is_visible():page.locator('[data-native-directory-toggle="combat"]').click()
    tracker=page.locator('#combat-panel .gw5-combat')
    expect(tracker).to_be_visible(timeout=15000)
    return tracker


def action(tracker,name):
    name={'add':'combatants/add','configure':'initiative/configure','stop':'end',
        'next':'turn/next','previous':'turn/previous','next-round':'round/next','previous-round':'round/previous',
        'roll-all':'initiative/roll-all','roll-npcs':'initiative/roll-npcs','roll-missing':'initiative/roll-missing',
        'open-sheet':'token/sheet'}.get(name,name)
    return tracker.locator(f'[data-gw5-combat-action="{name}"]')


def settled(tracker):
    expect(tracker.locator('.gw-combat-panel__state')).not_to_have_attribute('aria-busy','true',timeout=20000)


def benchmark(seed,output):
    """Measure usable controls with native HTTP, excluding cold table startup."""
    samples,requests=[],[]
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(env={**os.environ,'CHROME_LOG_FILE':str(output/'chromium.log')})
        context=browser.new_context(viewport={'width':1440,'height':1050})
        context.add_cookies([{**seed['sessions']['gm'],'url':seed['base']}]);page=context.new_page()
        def record(request):
            if request.method=='POST' and '/api/tables/' in request.url and request.url.endswith(('/api','/storage')):
                requests.append({'url':request.url,**(request.post_data_json or {})})
        page.on('request',record);page.goto(seed['base']+'/game/'+seed['campaign'])
        expect(page.locator('.game-menubar__presence')).to_have_attribute('data-presence','seated',timeout=20000)
        tracker=show_tracker(page)
        for token in ('monsterToken','linkedToken','snapshotToken'):
            index=page.evaluate('''async({scene,token})=>{
              const [tokens,combat]=await Promise.all([gravewright.tokens.state({mapId:scene}),gravewright.combat.state({sceneId:scene})]);
              return tokens.tokens.filter(row=>!combat.combatants.some(entry=>entry.id===row.id)).findIndex(row=>row.id===token);
            }''',{'scene':seed['scene'],'token':seed[token]})
            action(tracker,'add').click();settled(tracker)
            modal=page.locator('.gw5-combat-modal');modal.locator('select').select_option(str(index))
            started=time.monotonic();first=len(requests);modal.locator('button[type=submit]').click()
            expect(modal).to_have_count(0,timeout=20000);settled(tracker)
            sample={'action':'add','seconds':round(time.monotonic()-started,3),'httpPosts':len(requests)-first}
            samples.append(sample);print(json.dumps(sample),flush=True);page.wait_for_timeout(1000)
        action(tracker,'start').click();settled(tracker);page.wait_for_timeout(1000)
        for index in range(2):
            started=time.monotonic();first=len(requests);action(tracker,'next').click();settled(tracker)
            own=requests[first:];mutations=[row for row in own if row.get('domain')=='combat' and row.get('method')=='nextTurn']
            assert len(mutations)==1 and '/modules/' in mutations[0]['url'],mutations
            sample={'action':'next-no-effects','seconds':round(time.monotonic()-started,3),'httpPosts':len(own)}
            samples.append(sample);print(json.dumps(sample),flush=True);page.wait_for_timeout(1000)
        assert native(page,seed)['turn']==2
        browser.close()
    return {'result':'PASS','samples':samples,'fixture':seed['fixture']}


def smoke(seed,output):
    errors,dialogs,calls,timings,requests=[],[],[],[],[]
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(env={**os.environ,'CHROME_LOG_FILE':str(output/'chromium.log')})
        pages={}
        for role in ('gm','player','reader'):
            context=browser.new_context(viewport={'width':1440,'height':1050},locale='en')
            context.add_cookies([{**seed['sessions'][role],'url':seed['base']}])
            page=context.new_page();page.on('pageerror',lambda failure:errors.append(str(failure)))
            page.on('dialog',lambda dialog:(dialogs.append(dialog.type),dialog.dismiss()))
            page.goto(seed['base']+'/game/'+seed['campaign'])
            expect(page.locator('.game-menubar__presence')).to_have_attribute('data-presence','seated',timeout=20000)
            page.wait_for_function('!!window.gravewright')
            pages[role]=page
        gm,player,reader=(pages[role] for role in ('gm','player','reader'))
        def record(response):
            if '/modules/gravewright.5e-srd/api' in response.url:
                request=response.request.post_data_json or {}
                calls.append({'domain':request.get('domain'),'method':request.get('method'),'status':response.status,
                    'requestId':request.get('requestId'),'payload':request.get('payload',{})})
        gm.on('response',record)
        def record_request(request):
            if request.method=='POST' and '/api/tables/' in request.url and request.url.endswith(('/api','/storage')):
                body=request.post_data_json or {}
                requests.append({'url':request.url,'domain':body.get('domain'),'method':body.get('method'),
                    'requestId':body.get('requestId')})
        gm.on('request',record_request)
        installed=gm.request.get(seed['base']+'/api/module-packages').json()
        assert [row['id'] for row in installed]==['gravewright.5e-srd'],installed
        assert installed[0]['version']=='0.1.1' and 'django' not in installed[0]
        assert installed[0]['system']['combat']['requiresProvider'] is False
        library=gm.context.new_page();library.goto(seed['base']+'/inside?section=addons')
        expect(library.locator('[data-module-catalog="installed"] .module-catalog__card')).to_have_count(0)
        library.goto(seed['base']+'/inside?section=systems')
        expect(library.locator('[data-module-catalog="installed"] .module-catalog__card')).to_have_count(2)
        library.screenshot(path=str(output/'systems.png'));library.close()

        def duration(value=3,**extra):return {'data':{'duration':{'type':'turns','value':value,'expires':'start',**extra}}}
        def periodic(value):return {'data':{'modifiers':[{'operation':'damage_over_time','target':'damage.self','value':value}]}}
        set_data(gm,seed['actor'],{'rulesEdition':'2014','exhaustion':1,'effects':[duration(),
            duration(2,expires='end',sourceTokenId=seed['monsterToken']),periodic(3)],'notes':'Authored hero data'})
        set_data(gm,seed['actor'],{'rulesEdition':'2024','exhaustion':2,'conditions':['invisible'],
            'effects':[duration(),periodic('1d6')],'notes':'Independent authored data'},seed['snapshotToken'])
        set_data(gm,seed['monster'],{'effects':[duration(4)],'notes':'Authored monster data'})
        tracker=show_tracker(gm)
        # The chooser is a real SDK-backed list, usable without selected-token
        # private globals or undocumented tabletop focus events.
        for token in ('monsterToken','linkedToken','snapshotToken'):
            index=gm.evaluate('''async({scene,token})=>{
              const [tokens,combat]=await Promise.all([gravewright.tokens.state({mapId:scene}),gravewright.combat.state({sceneId:scene})]);
              const present=new Set(combat.combatants.map(entry=>entry.id));
              return tokens.tokens.filter(entry=>!present.has(entry.id)).findIndex(entry=>entry.id===token);
            }''',{'scene':seed['scene'],'token':seed[token]})
            assert index>=0
            action(tracker,'add').click()
            chooser=gm.locator('.gw5-combat-modal')
            settled(tracker)
            choice=chooser.locator('select[name=combatant]')
            expect(choice).to_be_visible();choice.select_option(str(index))
            began=time.monotonic();call_count=len(calls);request_count=len(requests)
            chooser.locator('button[type=submit]').click()
            try:expect(chooser).to_have_count(0,timeout=20000)
            except AssertionError:
                gm.screenshot(path=str(output/'failure-add.png'))
                print(json.dumps({'chooser':chooser.inner_text(),'tracker':tracker.inner_text(),'errors':errors,
                    'combat':native(gm,seed),'calls':calls[-20:]},ensure_ascii=False),flush=True)
                raise
            settled(tracker)
            timing={'action':'add','token':token,'seconds':round(time.monotonic()-began,3),'sdkCalls':len(calls)-call_count,
                'sdkAndStorageRequests':len(requests)-request_count}
            timings.append(timing);print(json.dumps(timing),flush=True)
        expect(tracker.locator('.gw-combat-combatant')).to_have_count(3)
        for row in tracker.locator('.gw-combat-combatant').all():
            expect(row.locator('.gw-combat-combatant__position')).to_be_visible()
            expect(row.locator('.gw-combat-combatant__portrait')).to_be_visible()
            expect(row.locator('.gw-combat-combatant__main')).to_be_visible()
            expect(row.locator('[data-gw5-combat-initiative]')).to_be_visible()

        # All initiative facts are native receipt-backed rolls. Both editions
        # retain their condition/exhaustion preparation before dice execution.
        action(tracker,'roll-all').click();settled(tracker)
        dice=[call for call in calls if call['domain']=='dice' and call['method']=='roll' and call['status']==200]
        assert len(dice)==3,dice
        expressions=[call['payload']['expression'] for call in dice]
        assert any('2d20kl1' in expression for expression in expressions),expressions
        assert any('2d20kh1' in expression and '- 4' in expression for expression in expressions),expressions
        # Explicit scores make following turn checks independent of random facts.
        for token,value in (('monsterToken','30'),('linkedToken','20'),('snapshotToken','10')):
            row=tracker.locator(f'[data-gw5-token-id="{seed[token]}"]')
            field=row.locator('[data-gw5-combat-initiative]');field.fill(value);field.press('Tab');settled(tracker)
            expect(field).to_have_value(value)
        action(tracker,'start').click();settled(tracker)
        initial=native(gm,seed);assert initial['active'] and initial['round']==1 and initial['turn']==0
        assert actor(gm,seed['actor'])['data']['effects'][0]['data']['duration'].get('remaining') is None
        # Previous has no native history immediately after Start. A definitive
        # native validation rejection shows an error and releases only this
        # unaccepted command; it must not strand an ordinary combat session.
        action(tracker,'previous').click();settled(tracker)
        expect(tracker.locator('[role=alert]')).to_be_visible()
        expect(action(tracker,'next')).to_be_enabled()
        assert native(gm,seed)['version']==initial['version']
        player_tracker=show_tracker(player);reader_tracker=show_tracker(reader)
        for view in (player_tracker,reader_tracker):
            assert action(view,'next').count()==0 and action(view,'start').count()==0
        action(tracker,'pause').click();settled(tracker)
        expect(action(tracker,'next')).to_be_disabled()
        before=native(gm,seed);gm.wait_for_timeout(2200);assert native(gm,seed)==before
        action(tracker,'resume').click();settled(tracker)

        # Native next succeeds and actor save succeeds, then its response is lost.
        # Retrying after a complete page reload must never advance a second time.
        lost={'save':False}
        def lose_save(route):
            request=route.request.post_data_json or {}
            if not lost['save'] and request.get('domain')=='actors' and request.get('method')=='saveSheet' and \
                    request.get('payload',{}).get('data',{}).get('combatAutomation',{}).get('receipts'):
                response=route.fetch();assert response.ok;lost['save']=True
                route.fulfill(status=503,json={'error':'unavailable'})
            else:route.continue_()
        gm.route(SCOPED_API,lose_save)
        began=time.monotonic();call_count=len(calls);request_count=len(requests)
        action(tracker,'next').click();settled(tracker)
        timing={'action':'next-with-lost-save','seconds':round(time.monotonic()-began,3),'sdkCalls':len(calls)-call_count}
        timings.append(timing);print(json.dumps(timing),flush=True)
        assert lost['save'],{'tracker':tracker.inner_text(),'calls':calls[-20:]}
        interrupted=native(gm,seed);assert interrupted['turn']==1,interrupted
        mutations=[call for call in requests[request_count:] if call['domain']=='combat' and call['method']=='nextTurn']
        assert len(mutations)==1 and '/modules/' in mutations[0]['url'],mutations
        hero=actor(gm,seed['actor']);assert hero['data']['bars']['bar_1']['value']==17
        gm.unroute(SCOPED_API,lose_save);gm.reload()
        expect(gm.locator('.game-menubar__presence')).to_have_attribute('data-presence','seated',timeout=15000)
        tracker=show_tracker(gm);action(tracker,'retry').click();settled(tracker)
        assert native(gm,seed)['version']==interrupted['version']
        hero=actor(gm,seed['actor']);assert hero['data']['bars']['bar_1']['value']==17
        assert hero['data']['effects'][0]['data']['duration']['remaining']==2
        assert hero['data']['effects'][1]['data']['duration']['remaining']==1
        assert actor(gm,seed['actor'],seed['snapshotToken'])['data']['bars']['bar_1']['value']==20

        # A lost native formula roll response reuses both the initiative command
        # and its periodic die receipt. Recovery is available after remount.
        lost={'dice':False};dice_calls=[]
        def lose_dice(route):
            request=route.request.post_data_json or {}
            if request.get('domain')=='dice' and request.get('method')=='roll':
                dice_calls.append(request)
                if not lost['dice']:
                    response=route.fetch();assert response.ok;lost['dice']=True
                    route.fulfill(status=503,json={'error':'unavailable'});return
            route.continue_()
        gm.route(SCOPED_API,lose_dice);action(tracker,'next').click();settled(tracker)
        assert lost['dice'];turn=native(gm,seed);assert turn['turn']==2
        action(tracker,'retry').click();settled(tracker);gm.unroute(SCOPED_API,lose_dice)
        assert native(gm,seed)['version']==turn['version']
        assert len(dice_calls)==2 and dice_calls[0]['requestId']==dice_calls[1]['requestId'],dice_calls
        independent=actor(gm,seed['actor'],seed['snapshotToken'])
        assert 14<=independent['data']['bars']['bar_1']['value']<=19
        assert independent['data']['effects'][0]['data']['duration']['remaining']==2
        assert actor(gm,seed['actor'])['data']['bars']['bar_1']['value']==17
        expected_hp=independent['data']['bars']['bar_1']['value']

        began=time.monotonic();call_count=len(calls);request_count=len(requests)
        action(tracker,'next').click();settled(tracker)
        timing={'action':'next-normal','seconds':round(time.monotonic()-began,3),'sdkCalls':len(calls)-call_count,
            'sdkAndStorageRequests':len(requests)-request_count}
        timings.append(timing);print(json.dumps(timing),flush=True)
        mutations=[call for call in requests[request_count:] if call['domain']=='combat' and call['method']=='nextTurn']
        assert len(mutations)==1 and '/modules/' in mutations[0]['url'],mutations
        assert native(gm,seed)['turn']==0

        action(tracker,'previous').click();settled(tracker)
        assert actor(gm,seed['actor'],seed['snapshotToken'])['data']['bars']['bar_1']['value']==expected_hp
        action(tracker,'next-round').click();settled(tracker)
        assert native(gm,seed)['round']==2
        assert actor(gm,seed['actor'],seed['snapshotToken'])['data']['bars']['bar_1']['value']==expected_hp

        # Native owner permissions remain in force for personal resources.
        owned=player_tracker.locator(f'[data-gw5-token-id="{seed["linkedToken"]}"]')
        owned.locator('.gw-combat-bar').first.click()
        modal=player.locator('.gw5-combat-modal');settled(player_tracker);modal.locator('input').fill('-2')
        modal.locator('button[type=submit]').click();expect(modal).to_have_count(0)
        assert actor(gm,seed['actor'])['data']['bars']['bar_1']['value']==15
        for bar in reader_tracker.locator('.gw-combat-bar').all():expect(bar).to_be_disabled()
        row=tracker.locator(f'[data-gw5-token-id="{seed["linkedToken"]}"]')
        row.locator('.gw-combat-menu__trigger').click();action(row,'open-sheet').click()
        sheet=gm.locator('.gw5-combat-sheet');expect(sheet.locator('.gw5-sheet')).to_be_visible(timeout=15000)
        sheet.locator('.gw5-modal-title button').click();expect(sheet).to_have_count(0)
        enemy=tracker.locator(f'[data-gw5-token-id="{seed["monsterToken"]}"]')
        enemy.locator('.gw-combat-menu__trigger').click();action(enemy,'open-sheet').click()
        monster_sheet=gm.locator('.gw5-combat-sheet');expect(monster_sheet.locator('.gw5-monster')).to_be_visible(timeout=15000)
        name=monster_sheet.locator('[data-gw5-path="core.name"]');name.fill('Monster edit flushed on close')
        # Close immediately, before the autosave debounce; the existing native
        # modal flush contract must wait for this package sheet's pending save.
        monster_sheet.locator('.gw5-modal-title button').click();expect(monster_sheet).to_have_count(0,timeout=15000)
        assert actor(gm,seed['monster'])['name']=='Monster edit flushed on close'

        tracker.screenshot(path=str(output/'tracker-desktop.png'))
        gm.set_viewport_size({'width':390,'height':844});gm.wait_for_timeout(300)
        bounds=tracker.bounding_box();assert bounds and bounds['width']<=390,bounds
        assert tracker.evaluate('node=>node.scrollWidth<=node.clientWidth+2')
        tracker.screenshot(path=str(output/'tracker-mobile.png'))
        gm.set_viewport_size({'width':1440,'height':1050})
        action(tracker,'stop').click();settled(tracker);assert native(gm,seed)['active'] is False
        assert gm.locator('dialog').count()==0 and not dialogs and not errors,(errors,dialogs)
        browser.close()
    return {'result':'PASS','hostVersion':'0.2.3','systemVersion':'0.1.1','oneSystem':True,
        'initiativeEditions':['2014','2024'],'nativeReceipts':True,'reloadRecovery':True,
        'linkedAndIndependent':True,'gmControls':True,'ownerResources':True,'dialogs':dialogs,'errors':errors,
        'fixture':seed['fixture'],'timings':timings,'calls':calls,'requests':requests}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root');parser.add_argument('--archive',type=Path,default=default_archive())
    parser.add_argument('--seed',type=Path);parser.add_argument('--output',type=Path)
    parser.add_argument('--benchmark',action='store_true')
    parser.add_argument('--port',type=int,default=30041);args=parser.parse_args()
    root=host_root(args.host_root)
    output=(args.output or MODULE/'test-results'/'combat'/secrets.token_hex(8)).resolve();output.mkdir(parents=True,exist_ok=True)
    local_temp=output/'runtime'/'temp';local_cache=output/'runtime'/'cache'
    local_temp.mkdir(parents=True,exist_ok=True);local_cache.mkdir(parents=True,exist_ok=True)
    os.environ.update({'TEMP':str(local_temp),'TMP':str(local_temp),'TMPDIR':str(local_temp),'XDG_CACHE_HOME':str(local_cache)})
    initial=fingerprint(root/'.env');server=log=None
    try:
        if args.seed:seed=json.loads(args.seed.read_text(encoding='utf-8'))
        else:server,log,seed=start_fixture(root,output,args.archive.resolve(),args.port)
        result=(benchmark if args.benchmark else smoke)(seed,output)
        result['archiveSha256']=fingerprint(args.archive.resolve())
        (output/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'result':result['result'],'output':str(output),'fixture':seed['fixture']}))
    finally:
        if server:server.terminate();server.wait(timeout=15)
        if log:log.close()
        assert fingerprint(root/'.env')==initial,'The native host .env changed during isolated testing.'


if __name__=='__main__':main()
