"""Explicit legacy migration choices through the real 0.2.3 native modal SDK.

All management responses are synthetic. No running VTT or real data is accessed.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


def main():
    source = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--host-root', type=Path, default=Path(os.environ.get('GRAVEWRIGHT_TEST_HOST_ROOT', source.parent / 'core')))
    parser.add_argument('--output', type=Path, default=source / 'test-results' / 'legacy')
    args = parser.parse_args()
    host = args.host_root.resolve()
    modules = host / 'gravewright/modules/static/gravewright_modules'
    assert modules.is_dir(), 'Use --host-root to select a Gravewright 0.2.3 checkout.'
    args.output.mkdir(parents=True, exist_ok=True)

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def translate_path(self, path):
            path = urlsplit(path).path
            if path == '/host/table-modal.js':
                return str(host / 'gravewright/table/static/gravewright_table/modal.js')
            if path == '/static/gravewright_web/escape.js':
                return str(host / 'gravewright/web/static/gravewright_web/escape.js')
            if path.startswith('/host/modules/'):
                target = (modules / path.removeprefix('/host/modules/')).resolve()
                if target.is_relative_to(modules.resolve()):
                    return str(target)
            return super().translate_path(path)

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(source)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1100, 'height': 800})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.add_style_tag(path=str(source / 'styles.css'))
            page.add_style_tag(content='body{background:#101315;color:#e1ded4;font-family:Arial}.ownership-modal-overlay{position:fixed;inset:0;display:grid;place-items:center;background:#0008}')
            result = page.evaluate(r"""async () => {
              const {createLegacyCompatibility,LEGACY_PACKAGE_ID}=await import('/legacy.js');
              const {openLegacyMigration}=await import('/legacy-ui.js');
              const {mountModal}=await import('/host/table-modal.js');
              const {createUiApi}=await import('/host/modules/modal-api.js');
              const words=await fetch('/locales/en.json').then(response=>response.json());
              const t=(key,params={})=>Object.entries(params).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',value),words[key]||key);
              const abort=new AbortController(),links=new Set(), life={signal:abort.signal,
                check(){if(abort.signal.aborted)throw Error('cancelled');},link(fn){links.add(fn);return()=>links.delete(fn);}};
              const api={ui:createUiApi(life,{}, {mountModal,document})};
              const unchanged={notes:'Keep player notes',powers:[{name:'User-authored power'}]},before=JSON.stringify(unchanged);
              let active=true,installed=true,owner=true,queued=false,polls=0,writes=[],record=null;
              const response=value=>({ok:true,status:200,json:async()=>structuredClone(value)});
              const fakeFetch=async(url,init)=>{
                if(url==='/api/module-packages'){
                  if(queued&&++polls>=2){active=false;queued=false;}
                  return response(installed?[{id:LEGACY_PACKAGE_ID,version:'0.1.0',django:{apps:['gravewright_5e']},globalEnabled:active}]:[]);
                }
                if(url==='/api/auth/session')return response({authenticated:true,account:{role:owner?'owner':'participant'}});
                if(url==='/api/admin/status')return response({updates:{automatic:{supported:true,busy:false,stage:'idle'}}});
                if(url==='/__gravewright/csrf')return response({token:'synthetic-csrf',header:'x-csrf-token'});
                if(init?.method!=='POST'||init.headers['x-csrf-token']!=='synthetic-csrf')throw Error('Missing native CSRF');
                writes.push(url);
                if(url==='/api/module-packages/activation'){queued=true;return response({restartRequired:true});}
                if(url==='/api/module-packages/removal-preview')return response({tables:[],system:false,resetsSystem:false});
                if(url==='/api/module-packages/remove'){installed=false;return response({removed:true});}
                throw Error('Unexpected management request '+url);
              };
              const context={api,root:document.body,signal:abort.signal,storage:{user:{get:async()=>record,
                set:async(_key,value)=>record={value,revision:String(Number(record?.revision||0)+1)}}}};
              const manager=createLegacyCompatibility(context,{fetch:fakeFetch,pollIntervalMs:1});
              const system={compatibility:manager,t};
              const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
              const until=async(predicate,label)=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Timeout '+label);};
              const button=(modal,key)=>[...modal.querySelectorAll('button')].find(node=>node.textContent===t(key));
              const click=async(modal,key)=>{const node=button(modal,key);if(!node||node.disabled)throw Error('Missing button '+key);node.click();await tick();};
              const opener=document.createElement('button');opener.textContent='Open migration';document.body.append(opener);opener.focus();
              let modal=await openLegacyMigration(context,system);
              await click(modal,'legacy.disable');
              if(writes.length||!button(modal,'legacy.confirmDisable'))throw Error('Disable skipped explicit confirmation');
              await modal.close();await tick();if(document.activeElement!==opener)throw Error('Close lost focus');
              modal=await openLegacyMigration(context,system);await click(modal,'legacy.disable');await click(modal,'legacy.confirmDisable');
              await until(()=>button(modal,'legacy.remove'),'inactive module');
              if(writes.filter(url=>url.endsWith('/activation')).length!==1)throw Error('Duplicate activation');
              await click(modal,'legacy.remove');
              if(writes.some(url=>url.endsWith('/remove'))||!button(modal,'legacy.confirmRemove'))throw Error('Removal skipped review');
              window.legacyReview={modal,manager,system,context,button,t};
              return {explicitDisable:true,explicitRemoval:true,actualNativeModal:modal.localName==='section',
                noDialog:!document.querySelector('dialog'),unchangedData:JSON.stringify(unchanged)===before};
            }""")
            page.screenshot(path=str(args.output / 'legacy-removal-confirmation.png'))
            page.set_viewport_size({'width': 390, 'height': 760})
            page.screenshot(path=str(args.output / 'legacy-mobile.png'))
            result.update(page.evaluate(r"""async () => {
              const {modal,manager,button,t}=window.legacyReview;
              if(modal.scrollWidth>modal.clientWidth+2)throw Error('Migration modal overflows mobile viewport');
              button(modal,'legacy.confirmRemove').click();
              for(let i=0;i<100&&manager.current.state!=='absent';i++)await new Promise(resolve=>setTimeout(resolve,5));
              if(manager.current.state!=='absent')throw Error('Legacy package not removed');
              await modal.close();manager.dispose();
              if(document.querySelector('.gw5-legacy-migration'))throw Error('Migration modal retained after close');
              return {removed:true,mobile:true,closed:true};
            }"""))
            assert not errors, errors
            (args.output / 'result.json').write_text(json.dumps({**result,'pageErrors':errors},indent=2)+'\n',encoding='utf-8')
            print(result)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
