"""Review every native DnD sheet and tab using disposable synthetic documents.

Start review_server.py with an isolated fixture, then pass its seed.json. The
fixture marker is checked before public-API writes; live campaigns are rejected.
Screenshots and measured layout/font issues are saved outside the package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from jsonschema import validate
from playwright.sync_api import expect, sync_playwright


MODULE = Path(__file__).resolve().parents[2]
MEASURE = """root => {
  const visible = el => el.checkVisibility({checkVisibilityCSS:true}) &&
    !el.closest('[hidden]') && el.getBoundingClientRect().width > 0;
  const rect = root.getBoundingClientRect();
  const tiny=[], overflow=[], gaps=[], clippedStatText=[], readingColumnGaps=[];
  for (const el of [root,...root.querySelectorAll('*')]) {
    if(!visible(el)||el.closest('svg'))continue;
    const css=getComputedStyle(el),r=el.getBoundingClientRect();
    const text=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    const control=el.matches('input:not([type=checkbox]):not([type=range]),select,textarea');
    const size=parseFloat(css.fontSize);
    if((text||control)&&size>0&&size<12)tiny.push({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60),size});
    if(r.right>rect.right+2||r.left<rect.left-2)overflow.push({tag:el.tagName,cls:el.className,right:r.right-rect.right,left:r.left-rect.left});
    const stat=el.closest('.gw5-stat');
    if(text&&stat) {
      const bounds=stat.getBoundingClientRect();
      for(const node of [...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim())) {
        const range=document.createRange();range.selectNodeContents(node);
        if([...range.getClientRects()].some(line=>line.right>bounds.right+1||line.left<bounds.left-1))
          clippedStatText.push({cls:el.className,text:node.textContent.trim(),stat:stat.dataset.gw5Stat});
      }
    }
    if(el.matches('.gw5-section,.gw5-item-group-box,.gw5-browser-empty,.gw5-ability')) {
      const children=[...el.children].filter(visible);
      const bottom=children.reduce((max,c)=>Math.max(max,c.getBoundingClientRect().bottom),r.top);
      const blank=Math.round(r.bottom-bottom-parseFloat(css.paddingBottom));
      if(blank>24)gaps.push({cls:el.className,height:Math.round(r.height),bottomBlank:blank});
    }
    if(el.matches('.gw5-item-description-grid')) {
      const columns=[...el.children].filter(visible).map(child=>child.getBoundingClientRect());
      if(columns.length===2&&Math.abs(columns[0].top-columns[1].top)<4) {
        const blank=Math.round(Math.abs(columns[0].bottom-columns[1].bottom));
        if(blank>160)readingColumnGaps.push({height:Math.round(r.height),blank});
      }
    }
  }
  return {width:Math.round(rect.width),height:Math.round(rect.height),tiny,overflow,gaps,clippedStatText,readingColumnGaps,
    textareas:[...root.querySelectorAll('textarea')].filter(visible).map(el=>({path:el.dataset.gw5Path,height:Math.round(el.getBoundingClientRect().height),scrollHeight:el.scrollHeight,empty:!el.value})),
    sections:[...root.querySelectorAll('.gw5-header,.gw5-section,.gw5-ability,.gw5-skills,.gw5-stat,.gw5-browser-empty,.gw5-item-hero,.gw5-item-group-box')].filter(visible).map(el=>({cls:el.className,height:Math.round(el.getBoundingClientRect().height),top:Math.round(el.getBoundingClientRect().top-rect.top),bottom:Math.round(el.getBoundingClientRect().bottom-rect.top)}))};
}"""


def viewport(value):
    try:
        width,height=map(int,value.lower().split('x'))
        if width<320 or height<320:raise ValueError
        return {'width':width,'height':height}
    except ValueError:
        raise argparse.ArgumentTypeError('Use WIDTHxHEIGHT, with each dimension at least 320.')


def expand_window(page,window,view):
    """Exercise the host's drag and resize handles, without forcing CSS sizes."""
    header=window.locator(':scope > header, :scope > form > header').first
    box=window.bounding_box();handle=header.bounding_box()
    assert box and handle,'The native sheet must expose its normal window header.'
    start={'x':box['x']+16,'y':handle['y']+handle['height']/2}
    page.mouse.move(**start);page.mouse.down()
    page.mouse.move(start['x']+8-box['x'],start['y']+8-box['y'],steps=6);page.mouse.up()
    box=window.bounding_box()
    page.mouse.move(box['x']+box['width']-3,box['y']+box['height']-3);page.mouse.down()
    page.mouse.move(view['width']-10,view['height']-10,steps=10);page.mouse.up()
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')


def window_metrics(window):
    return window.evaluate("""root=>{
      const r=root.getBoundingClientRect();
      return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),
        scrolls:[root,...root.querySelectorAll('*')].filter(el=>!el.matches('textarea')&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+2)
          .map(el=>({cls:el.className,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}))};
    }""")


def native(page, code, args):
    return page.evaluate('async args=>{const api=window.gravewright;'+code+'}',args)


def set_locale(page,locale,campaign):
    """Use the host account preference endpoint, including its real CSRF flow."""
    if page.evaluate('()=>window.gravewright?.i18n.locale')==locale:return
    result=page.evaluate('''async ({locale,next})=>{
      const csrfPath=document.querySelector('meta[name=gravewright-csrf-url]')?.content||'/__gravewright/csrf';
      const csrfResponse=await fetch(csrfPath,{credentials:'same-origin'});
      const csrf=await csrfResponse.json();
      if(!csrfResponse.ok||!csrf.token||!csrf.header)throw Error('Missing native CSRF token');
      const response=await fetch('/inside/language',{method:'POST',credentials:'same-origin',
        headers:{Accept:'application/json',[csrf.header]:csrf.token,'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({locale,next})});
      return {status:response.status,body:await response.json()};
    }''',{'locale':locale,'next':'/game/'+campaign})
    assert result['status']==200 and result['body']['locale']==locale,result
    page.reload()
    page.wait_for_function('locale=>!!window.gravewrightActors&&!!window.gravewrightItems&&window.gravewright?.i18n.locale===locale',arg=locale)


def sample_data(edition, state, actor=False):
    if state == 'empty':
        return {'rulesEdition':edition}
    sentence='Synthetic review text with a longer label, punctuation, and Unicode: Ação — Élan. '
    text=(sentence*12 if state=='long' else 'Synthetic description for layout review.')
    data={'rulesEdition':edition,'description':text,'notes':text,'category':'Synthetic category',
          'subtype':'Synthetic subtype','source':'Synthetic source','prerequisite':text if state=='long' else 'Level 1',
          'damage':'1d8 + 3','damage_type':'slashing','range':'30/120 ft','weight':2,'cost':'10 gp',
          'quantity':2,'level':3,'school':'abjuration','casting_time':'1 action','duration':'1 minute',
          'materials':text,'classes':'Wizard, Cleric','feature_name':'Synthetic feature',
          'languages':'Common, Elvish','hit_die':'d8','primary_ability':'Intelligence',
          'saving_throws':'Intelligence, Wisdom','skill_proficiencies':'Insight, History',
          'tool_proficiencies':'Artisan tools','armor_proficiencies':'Light armor',
          'weapon_proficiencies':'Simple weapons','equipment':text,'recharge':'short',
          'uses':{'value':2,'max':3},'props':{'finesse':True,'light':True},
          'components':{'v':True,'s':True,'m':True}}
    if actor:
        data.update({'level':5,'class':'Synthetic Wizard','race':'Synthetic ancestry',
            'background':'Synthetic background','alignment':'Neutral','size':'medium','type':'Construct',
            'cr':'3','ac':14,'speed':30,'prof':3,
            'abilities':{key:{'score':14} for key in ('str','dex','con','int','wis','cha')},
            'traits':{key:text for key in ('personality','ideals','bonds','flaws')},
            'proficiencies':text,
            'bars':{'bar_1':{'value':25,'max':40},'bar_2':{'value':3,'max':10}},
            'slots':{'l1':{'value':2,'max':4},'l2':{'value':1,'max':2}},
            'spell':{'ability':'int'},'currency':{'cp':12,'sp':34,'ep':0,'gp':56,'pp':7},
            'weapons':[{'id':'synthetic-weapon','name':'Synthetic review weapon '+('with a particularly long name '*4 if state=='long' else ''),'type':'weapon','quantity':1,'data':{'damage':'1d8','description':text,'range':'30/120 ft','rulesEdition':edition}}],
            'inventory':[{'id':'synthetic-equipment','name':'Synthetic review equipment','type':'equipment','quantity':2,'data':{'description':text,'weight':2}}],
            'spells':[{'id':'synthetic-spell','name':'Synthetic review spell','type':'spell','prepared':True,'data':{'description':text,'level':1,'school':'abjuration','casting_time':'1 action','range':'30 ft'}}],
            'features':[{'id':'synthetic-feature','name':'Synthetic review feature','type':'feature','data':{'description':text,'uses':{'value':1,'max':3}}}],
            'effects':[{'id':'synthetic-effect','name':'Synthetic review effect','type':'effect','enabled':True,'data':{'description':text,'category':'buff','duration':{'type':'permanent'}}}]})
        if actor=='monster':
            data.update({'speed':'30 ft.','traits':text,'actions_text':text,'legendary':text,
                'senses':text,'resistances':text,'attacks':data['weapons']})
    return data


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--strict',action='store_true')
    parser.add_argument('--locale',choices=['en','pt-BR','es'],default='en')
    parser.add_argument('--browser-executable',type=Path)
    parser.add_argument('--states',nargs='+',default=['empty','populated','long'])
    parser.add_argument('--editions',nargs='+',default=['2014','2024'])
    parser.add_argument('--widths',nargs='+',type=int,default=[1000,700,360])
    parser.add_argument('--native-viewports',nargs='+',type=viewport,
        help='Review the host default window at WIDTHxHEIGHT viewports, without assigning sheet/window styles.')
    parser.add_argument('--expanded',action='store_true',
        help='Use native drag/resize handles to expand the window in --native-viewports mode.')
    parser.add_argument('--require-overview-fit',action='store_true',
        help='Require the empty desktop character overview to fit vertically inside its native window.')
    parser.add_argument('--types',nargs='+')
    parser.add_argument('--tabs',nargs='+')
    parser.add_argument('--resume',action='store_true',help='Continue records from the same seed and output directory.')
    parser.add_argument('--capture-bottom',action='store_true',help='Also capture the bottom of every scrollable sheet.')
    parser.add_argument('--source-preview',action='store_true',help='Preview local item-editor.js/styles.css through isolated browser routes before rebuilding; excluded from release verification.')
    parser.add_argument('--expand-details',action='store_true',help='Review disclosure content without changing document data.')
    args=parser.parse_args()
    if args.expanded and not args.native_viewports:parser.error('--expanded requires --native-viewports.')
    if args.require_overview_fit and not args.native_viewports:parser.error('--require-overview-fit requires --native-viewports.')
    seed=json.loads(args.seed.read_text(encoding='utf-8'))
    assert seed.get('kind')=='dnd-isolated-review','Only review_server.py fixtures are supported.'
    assert (Path(seed['fixture'])/'review.sqlite3').is_file()
    base=seed['base'];args.output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((MODULE/'manifest.json').read_text(encoding='utf-8'))
    record_file=args.output/'records.json'
    records=json.loads(record_file.read_text(encoding='utf-8')) if args.resume and record_file.exists() else []
    errors=[]
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(**({'executable_path':str(args.browser_executable)} if args.browser_executable else {}))
        initial_view=args.native_viewports[0] if args.native_viewports else {'width':1440,'height':1000}
        context=browser.new_context(viewport=initial_view)
        if args.source_preview:
            for name,content_type in [('item-editor.js','text/javascript'),('styles.css','text/css')]:
                context.route('**/api/module-packages/gravewright.5e-srd/**/'+name,lambda route,request,name=name,content_type=content_type:route.fulfill(path=str(MODULE/name),content_type=content_type))
        context.add_cookies([{**seed['sessions']['gm'],'url':base}])
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/game/'+seed['campaign'])
        page.wait_for_function('!!window.gravewrightActors && !!window.gravewrightItems')
        set_locale(page,args.locale,seed['campaign'])
        types=[('actor',t['id']) for t in manifest['system']['actorTypes']]+[('item',t['id']) for t in manifest['system']['itemTypes']]
        if args.types:types=[entry for entry in types if entry[1] in args.types]
        for edition in args.editions:
            for state in args.states:
                for kind,typ in types:
                    prefix=f'{edition}-{state}-{typ}-'
                    layout=(MODULE/f'layouts/{typ}.sheet.gw.json') if kind=='actor' else MODULE/f'layouts/items/{typ}.sheet.gw.json'
                    expected_tabs=([t['id'] for t in json.loads(layout.read_text(encoding='utf-8'))['body']['tabs']]
                        if kind=='actor' else ['description','details']+(['modifiers'] if 'modifierBuilder' in layout.read_text(encoding='utf-8') else []))
                    if args.tabs:expected_tabs=[tab for tab in expected_tabs if tab in args.tabs]
                    if not expected_tabs:continue
                    samples=([(f'{view["width"]}x{view["height"]}-'+('expanded' if args.expanded else 'default'),view) for view in args.native_viewports]
                        if args.native_viewports else [(str(width),{'width':max(400,width+40),'height':1000}) for width in args.widths])
                    if records and all(any(r['key']==prefix+sample+'-'+tab for r in records)
                        for sample,view in samples for tab in expected_tabs):continue
                    name=(f'Density {edition} {state} {typ}'+(' — synthetic long document name '*3 if state=='long' else ''))[:120]
                    data=sample_data(edition,state,typ if kind=='actor' else False)
                    if typ=='effect':data['duration']={'type':'permanent','value':0}
                    validate(data,json.loads((MODULE/f'schemas/{typ if kind=="actor" else "item"}.schema.json').read_text(encoding='utf-8')))
                    result=native(page,f'return await api.{kind}s.create(args);',{'name':name,'type':typ,'data':data})
                    read='return await api.actors.sheet(args);' if kind=='actor' else 'return await api.items.get(args);'
                    original=native(page,read,result['id'])
                    # Actor navigation also verifies persistence. Native item open
                    # refreshes its public directory state itself; keep the page
                    # mounted across items to exercise repeated window disposal.
                    page.set_viewport_size(initial_view)
                    if kind=='actor':
                        page.goto(base+'/game/'+seed['campaign'])
                        page.wait_for_function('!!window.gravewrightActors && !!window.gravewrightItems')
                    page.evaluate('(args)=>window[args.kind==="actor"?"gravewrightActors":"gravewrightItems"].open(args.id)',{'kind':kind,'id':result['id']})
                    window=page.locator(f'.actor-directory__sheet[data-actor-id="{result["id"]}"]' if kind=='actor' else f'.item-sheet[data-item-id="{result["id"]}"]')
                    sheet=window.locator('.gw5-sheet');expect(sheet).to_be_visible(timeout=30000)
                    tabs=sheet.locator('[data-gw5-tab]' if kind=='actor' else '[data-gw5-item-tab]').evaluate_all('(els)=>els.map(el=>el.dataset.gw5Tab||el.dataset.gw5ItemTab)')
                    if args.tabs:tabs=[tab for tab in tabs if tab in args.tabs]
                    assert tabs==expected_tabs,(typ,tabs,expected_tabs)
                    for sample,view in samples:
                        page.set_viewport_size(view)
                        if args.native_viewports:
                            # Restore through the public native control, which also
                            # clears any remembered geometry from earlier samples.
                            window.locator('[data-window-action=reset]').click()
                            if args.expanded:expand_window(page,window,view)
                        else:
                            width=int(sample)
                            window.evaluate('(el,width)=>{el.style.width=width+"px";el.style.left="8px";el.style.top="8px";el.style.maxHeight="960px";el.style.height="auto";}',width)
                        for tab in tabs:
                            sheet.locator(f'[data-gw5-tab="{tab}"]' if kind=='actor' else f'[data-gw5-item-tab="{tab}"]').click()
                            if args.expand_details:sheet.locator('details').evaluate_all('(els)=>els.forEach(el=>el.open=true)')
                            page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                            metrics=sheet.evaluate(MEASURE)
                            key=f'{edition}-{state}-{typ}-{sample}-{tab}'
                            window.screenshot(path=str(args.output/(key+'.png')))
                            record={'key':key,'kind':kind,'type':typ,'edition':edition,'state':state,'targetWidth':None if args.native_viewports else width,
                                    'viewport':view,'windowMode':('expanded' if args.expanded else 'default') if args.native_viewports else 'resized',
                                    'window':window_metrics(window),'tab':tab,**metrics}
                            if args.native_viewports:
                                bounds=record['window']
                                assert bounds['x']>=-2 and bounds['y']>=-2 and bounds['x']+bounds['width']<=view['width']+2 and bounds['y']+bounds['height']<=view['height']+2,('Native frame outside viewport',key,bounds,view)
                            if args.require_overview_fit and typ=='character' and state=='empty' and tab=='main' and view['width']>=1024:
                                assert not record['window']['scrolls'],('Empty overview requires vertical scrolling',key,record['window']['scrolls'])
                            if args.capture_bottom and record['window']['scrolls']:
                                scroll='''(root,bottom)=>{for(const el of [root,...root.querySelectorAll('*')])if(!el.matches('textarea')&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+2)el.scrollTop=bottom?el.scrollHeight:0;}'''
                                window.evaluate(scroll,True)
                                page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(resolve))')
                                bottom=key+'-bottom.png';window.screenshot(path=str(args.output/bottom));record['bottomScreenshot']=bottom
                                window.evaluate(scroll,False)
                            records.append(record)
                            (args.output/'records.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
                    window.locator('[data-window=close], :scope > form > header > [data-close]').click()
                    expect(window).to_have_count(0)
                    final=native(page,read,result['id'])
                    assert {key:original.get(key) for key in ('name','data','version','sheetVersion')}=={key:final.get(key) for key in ('name','data','version','sheetVersion')},'Opening or resizing changed stored data.'
                    print(json.dumps({'reviewed':f'{edition}-{state}-{typ}','tabs':tabs,'checks':len(records)}),flush=True)
        browser.close()
    archives=Path(seed['fixture'])/'modules/archives'
    archive_hashes={archive.name:hashlib.sha256(archive.read_bytes()).hexdigest() for archive in sorted(archives.glob('*.zip'))}
    report={'host':seed['host'],'module':str(MODULE),'package':seed['package'],'archiveSha256':archive_hashes,'locale':args.locale,'sheetTypes':len(types),
            'checks':len(records),'pageErrors':errors,'records':records,'sourcePreview':args.source_preview}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    summary={k:report[k] for k in ('host','sheetTypes','checks','pageErrors')}
    summary.update({'tinyTextCases':sum(bool(r['tiny']) for r in records),'overflowCases':sum(bool(r['overflow']) for r in records),
                    'clippedStatTextCases':sum(bool(r.get('clippedStatText')) for r in records),'bottomGapCases':sum(bool(r['gaps']) for r in records),
                    'readingColumnGapCases':sum(bool(r.get('readingColumnGaps')) for r in records)})
    print(json.dumps(summary),flush=True)
    if args.strict:
        assert not errors,errors
        assert not any(r['tiny'] for r in records),'Text smaller than 12px; see report.json'
        assert not any(r['overflow'] for r in records),'Horizontal overflow; see report.json'
        assert not any(r.get('clippedStatText') for r in records),'Combat stat text outside its card; see report.json'
        assert not any(r.get('readingColumnGaps') for r in records),'Long properties leave excessive blank space beside the description; see report.json'


if __name__=='__main__':main()
