"""Review synthetic library/owned items, sorting, autosave and observer access.

Requires a disposable review_server.py fixture on the released VTT 0.2.3.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright
from sheet_density import MEASURE, native, sample_data, set_locale, window_metrics


MODULE=Path(__file__).resolve().parents[2]
TYPES=['weapon','armor','equipment','consumable','spell','feat','feature','race','background','class','effect']


def compare_names(page,names,locale):
    assert names==page.evaluate('({names,locale})=>[...names].sort(new Intl.Collator(locale,{sensitivity:"base",numeric:true}).compare)',{'names':names,'locale':locale}),names


def assert_layout(record):
    assert not record['tiny'] and not record['overflow'],record
    assert not record['readingColumnGaps'],record
    bounds=record['window'];view=record['viewport']
    assert bounds['x']>=-2 and bounds['y']>=-2 and bounds['x']+bounds['width']<=view['width']+2 and bounds['y']+bounds['height']<=view['height']+2,record


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--browser-executable',type=Path)
    args=parser.parse_args()
    seed=json.loads(args.seed.read_text(encoding='utf-8'))
    assert seed.get('kind')=='dnd-isolated-review'
    assert (Path(seed['fixture'])/'review.sqlite3').is_file()
    args.output.mkdir(parents=True,exist_ok=True)
    base=seed['base'];records=[];errors=[]
    messages={locale:json.loads((MODULE/f'locales/{locale}.json').read_text(encoding='utf-8')) for locale in ['en','pt-BR','es']}
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(**({'executable_path':str(args.browser_executable)} if args.browser_executable else {}))
        context=browser.new_context(viewport={'width':1366,'height':768})
        context.add_cookies([{**seed['sessions']['gm'],'url':base}])
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/game/'+seed['campaign'])
        page.wait_for_function('!!window.gravewrightActors&&!!window.gravewrightItems')
        data={'rulesEdition':'2014','weapons':[],'inventory':[],'spells':[],'features':[],'effects':[]}
        paths={typ:'weapons' if typ=='weapon' else 'spells' if typ=='spell' else 'effects' if typ=='effect' else 'inventory' if typ in ['armor','equipment','consumable'] else 'features' for typ in TYPES}
        identifiers={}
        # Intentionally reverse names; visible ordering must not rewrite this data.
        for typ in TYPES:
            for name in ['Zebra','Élan','Arma 10','Arma 2']:
                entry={'id':str(uuid4()),'name':name+' '+typ,'type':typ,'data':sample_data('2014','populated'),'quantity':2,'prepared':False,'equipped':False,'enabled':True,'source':{'synthetic':True}}
                if typ=='effect':entry['data']['duration']={'type':'permanent','value':0}
                data[paths[typ]].append(entry)
                if name=='Élan':identifiers[typ]=entry['id']
        native(page,'const view=await api.actors.sheet(args.id);return await api.actors.saveSheet({actorId:args.id,name:view.name,version:view.version,sheetVersion:view.sheetVersion,data:args.data});',{'id':seed['actor'],'data':data})
        original=native(page,'return await api.actors.sheet(args);',seed['actor'])
        for locale in ['en','pt-BR','es']:
            set_locale(page,locale,seed['campaign'])
            page.evaluate('id=>window.gravewrightActors.open(id)',seed['actor'])
            window=page.locator('.actor-directory__sheet[data-actor-id="'+seed['actor']+'"]')
            sheet=window.locator('.gw5-sheet');expect(sheet).to_be_visible(timeout=30000)
            for tab in ['main','spells','inventory','bio','effects']:
                sheet.locator('[data-gw5-tab="'+tab+'"]').click()
                if tab=='main':
                    names=sheet.locator('.gw5-weapons>.gw5-item>strong').all_text_contents();compare_names(page,names,locale)
                else:
                    for group in sheet.locator('.gw5-item-group').all():compare_names(page,group.locator('.gw5-item-name>strong').all_text_contents(),locale)
            # Real form interactions in each of the 11 owned-item editors.
            for typ in TYPES:
                tab='main' if typ=='weapon' else 'spells' if typ=='spell' else 'effects' if typ=='effect' else 'inventory' if typ in ['armor','equipment','consumable'] else 'bio'
                sheet.locator('[data-gw5-tab="'+tab+'"]').click()
                row=sheet.locator('[data-entry-id="'+identifiers[typ]+'"]').filter(has=page.locator('button')).first
                opener=row.get_by_role('button',name=messages[locale]['edit'],exact=True)
                opener.click()
                modal=page.locator('.gw5-embedded-editor');expect(modal).to_be_visible()
                editor=modal.locator('.gw5-item-editor')
                for view in [{'width':1366,'height':768},{'width':390,'height':844}]:
                    page.set_viewport_size(view)
                    for tab in editor.locator('[data-gw5-item-tab]').all():
                        tab.click()
                        metrics=editor.evaluate(MEASURE);record={'kind':'owned','type':typ,'locale':locale,'viewport':view,'tab':tab.get_attribute('data-gw5-item-tab'),'window':window_metrics(modal),**metrics};records.append(record)
                        assert_layout(record)
                        if locale=='pt-BR':modal.screenshot(path=str(args.output/f'owned-{typ}-{view["width"]}-{record["tab"]}.png'))
                page.set_viewport_size({'width':1366,'height':768})
                page.keyboard.press('Escape');expect(modal).to_have_count(0)
                expect(sheet.locator('[data-entry-id="'+identifiers[typ]+'"]').get_by_role('button',name=messages[locale]['edit'],exact=True)).to_be_focused()
            window.locator('[data-window=close]').click();expect(window).to_have_count(0)
        final=native(page,'return await api.actors.sheet(args);',seed['actor'])
        assert final['data']==original['data'],'Opening, reading and sorting must not rewrite stored item order or metadata.'
        assert final['version']==original['version'] and final['sheetVersion']==original['sheetVersion']
        # Persist an owned weapon/spell ability through the visible form and reopen.
        page.evaluate('id=>window.gravewrightActors.open(id)',seed['actor'])
        sheet=page.locator('.actor-directory__sheet .gw5-sheet');expect(sheet).to_be_visible()
        for typ,path,value in [('weapon','attack_ability','dex'),('spell','spell_ability','wis')]:
            sheet.locator('[data-gw5-tab="'+('main' if typ=='weapon' else 'spells')+'"]').click()
            row=sheet.locator('[data-entry-id="'+identifiers[typ]+'"]').filter(has=page.locator('button')).first
            row.get_by_role('button',name=messages['es']['edit'],exact=True).click()
            modal=page.locator('.gw5-embedded-editor')
            modal.locator('[data-gw5-item-tab=details]').click()
            modal.locator('[data-gw5-path="sheet.'+path+'"]').select_option(value)
            expect(modal.locator('.gw5-save-status').last).to_have_attribute('data-state','saved')
            modal.get_by_role('button',name=messages['es']['done'],exact=True).click();expect(modal).to_have_count(0)
            stored=native(page,'return await api.actors.sheet(args);',seed['actor'])
            entry=next(entry for entry in stored['data'][paths[typ]] if entry['id']==identifiers[typ])
            assert entry['data'][path]==value and entry['source']=={'synthetic':True}
            row=sheet.locator('[data-entry-id="'+identifiers[typ]+'"]').filter(has=page.locator('button')).first
            row.get_by_role('button',name=messages['es']['edit'],exact=True).click()
            modal=page.locator('.gw5-embedded-editor');modal.locator('[data-gw5-item-tab=details]').click()
            expect(modal.locator('[data-gw5-path="sheet.'+path+'"]').first).to_have_value(value)
            page.keyboard.press('Escape');expect(modal).to_have_count(0)
        page.locator('.actor-directory__sheet [data-window=close]').click()
        # All item types remain readable and immutable for an observer.
        documents=[]
        for typ in TYPES:
            data=sample_data('2014','long');data['privateReviewMarker']='Preserve Unicode: Ação / Élan'
            if typ=='effect':data['duration']={'type':'permanent','value':0}
            result=native(page,'return await api.items.create(args);',{'name':'Observer '+typ,'type':typ,'data':data,'permissions':{'default':'read'}})
            documents.append({'id':result['id'],'type':typ,'before':native(page,'return await api.items.get(args);',result['id'])})
        reader=browser.new_context(viewport={'width':1366,'height':768});reader.add_cookies([{**seed['sessions']['reader'],'url':base}])
        readpage=reader.new_page();readpage.on('pageerror',lambda error:errors.append(str(error)))
        readpage.goto(base+'/game/'+seed['campaign']);readpage.wait_for_function('!!window.gravewrightItems')
        for view in [{'width':1366,'height':768},{'width':390,'height':844}]:
            readpage.set_viewport_size(view)
            for document in documents:
                readpage.evaluate('id=>window.gravewrightItems.open(id)',document['id'])
                window=readpage.locator('.item-sheet[data-item-id="'+document['id']+'"]');editor=window.locator('.gw5-item-editor');expect(editor).to_be_visible(timeout=30000)
                for tab in editor.locator('[data-gw5-item-tab]').all():
                    tab.click()
                    for control in editor.locator('input,select,textarea').all():expect(control).to_be_disabled()
                    metrics=editor.evaluate(MEASURE);record={'kind':'observer','type':document['type'],'viewport':view,'tab':tab.get_attribute('data-gw5-item-tab'),'window':window_metrics(window),**metrics};records.append(record)
                    assert_layout(record)
                    window.screenshot(path=str(args.output/f'read-{document["type"]}-{view["width"]}-{record["tab"]}.png'))
                window.locator(':scope > form > header > [data-close]').click();expect(window).to_have_count(0)
        for document in documents:
            assert native(page,'return await api.items.get(args);',document['id'])==document['before']
        reader.close();context.close();browser.close()
    archive_hashes={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted((Path(seed['fixture'])/'modules/archives').glob('*.zip'))}
    report={'package':seed['package'],'host':seed['host'],'archiveSha256':archive_hashes,'checks':len(records),'pageErrors':errors,'records':records,'itemOrderUnchanged':True,'ownedAbilityAutosave':True,'observerDataUnchanged':True,'focusRestored':True,'locales':['en','pt-BR','es']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    assert not errors,errors
    print(json.dumps({key:value for key,value in report.items() if key!='records'}),flush=True)


if __name__=='__main__':main()
