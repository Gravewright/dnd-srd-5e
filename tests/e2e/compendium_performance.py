"""Exercise every installed SRD item type against a disposable browser fixture.

Run serially, after data/review_5e_server.py has produced its disposable seed:
  $env:GRAVEWRIGHT_TEST_HOST_ROOT = 'path/to/gravewright-vtt-checkout'
  $env:GRAVEWRIGHT_REVIEW_URL = 'http://127.0.0.1:30009'
  python -X utf8 tests/e2e/compendium_performance.py

Optional --types class,race --editions 2024 --samples maximum narrows debugging.
Each selected document is dropped into fresh actors in cold and warm module
lifetimes. Timing uses browser MutationObserver/performance.now, never API
polling. Choice interaction is reported separately from readiness and the final
confirmation/save. Missing manifest types receive explicitly synthetic library
documents; these are not reported as compendium coverage.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

from host_paths import ROOT, MODULE, node_executable
OUTPUT = ROOT / "test-results/5e-compendium"
BASE = os.environ.get("GRAVEWRIGHT_REVIEW_URL", "http://127.0.0.1:30009").rstrip("/")
TIMEOUT = int(os.environ.get("GRAVEWRIGHT_REVIEW_TIMEOUT_MS", "120000"))
ROUTES = {"weapon": ("weapons", "inventory"), "armor": ("inventory", "inventory"),
          "equipment": ("inventory", "inventory"), "consumable": ("inventory", "inventory"),
          "spell": ("spells", "spells"), "feat": ("features", "bio"),
          "feature": ("features", "bio"), "race": ("features", "bio"),
          "background": ("features", "bio"), "class": ("features", "bio"),
          "effect": ("effects", "effects")}
COLLECTIONS = ("weapons", "inventory", "equipment", "spells", "features", "effects", "attacks")

# A persistent, offline planner supplies legal answers without warming the
# browser module's authorized document cache. The browser still presents and
# submits every actual choice through its UI.
PLANNER = r"""
import fs from 'node:fs';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
const base=process.argv[1];
const {planAdvancement}=await import(pathToFileURL(base+'/advancement.js'));
const {derive}=await import(pathToFileURL(base+'/rules.js'));
const {ownedItem}=await import(pathToFileURL(base+'/item-drop.js'));
const schema=JSON.parse(fs.readFileSync(base+'/system.json','utf8')).schemas.character;
const entries=['2014','2024'].flatMap(edition=>JSON.parse(fs.readFileSync(base+'/compendiums/'+edition+'.json','utf8')).packs.flatMap(pack=>pack.entries));
const book=new Map(entries.map(item=>[item.id,item]));
const initial=edition=>derive({rulesEdition:edition,level:1,abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(id=>[id,{score:10}])),features:[],inventory:[],weapons:[],spells:[],effects:[],hpBaseMax:10,bars:{bar_1:{value:10,max:10},bar_2:{value:0,max:0}}},'character',schema,edition);
function seed(item,level=1){
  const data=initial(item.data.rulesEdition);
  if(item.type!=='class')data.level=level;
  const subclass=item.data.subclass===true||item.data.isSubclass===true||item.data.classType==='subclass';
  const requiredClass=subclass?item.data.classIdentifier:item.data.prerequisiteClass;
  if(requiredClass){
    const cls=entries.find(entry=>entry.type==='class'&&entry.data.rulesEdition===item.data.rulesEdition&&entry.data.identifier===requiredClass);
    if(!cls)throw Error('Missing subclass prerequisite class: '+item.name);
    // An existing matching class is a prerequisite fixture, not the subject of
    // this drop. No origin grant or catalog read is performed in the browser.
    const id='adv-'+cls.id;
    const classLevel=Math.max(level,Number(item.data.prerequisiteLevel)||1);
    data.level=classLevel;data.class=cls.name;
    data.advancementLedger={version:1,parents:{[id]:{id,source:cls.id,type:'class',item:cls,classLevel,primaryClass:true,contributions:[],owned:[],hpRolls:{}}},fields:{},grants:{}};
  }
  return data;
}
function resolve(item,draft,classLevel){
  const answers={},trace=[];
  for(let stage=0;stage<120;stage++){
    const plan=planAdvancement(draft,item,book,answers,{type:'character',role:'gm',edition:draft.rulesEdition||item.data.rulesEdition,classLevel});
    if(!plan.choices.length)return {answers,stages:trace,expected:derive(plan.data,'character',schema,draft.rulesEdition||item.data.rulesEdition),parentId:plan.parentId,warnings:plan.warnings};
    trace.push(plan.choices.map(choice=>({id:choice.id,type:choice.type,kind:choice.kind,count:choice.count,points:choice.points,options:choice.options?.length})));
    for(const choice of plan.choices){
      if(choice.type==='number')answers[choice.id]=choice.average??choice.min??0;
      else if(choice.type==='ability'||choice.type==='asi'){
        let remaining=choice.points??choice.count,values={};
        for(const ability of choice.abilities||[]){values[ability.id]=Math.min(ability.max??choice.cap??2,remaining);remaining-=values[ability.id];}
        if(remaining!==0)throw Error('Impossible ability choice '+item.name+' '+choice.id);
        answers[choice.id]=values;
      }else{
        const options=choice.options||[],count=choice.count??1;
        if(options.length<count)throw Error('Impossible choice '+item.name+' '+choice.id);
        answers[choice.id]=choice.type==='select'?options[0].id:options.slice(0,count).map(option=>option.id);
      }
    }
  }
  throw Error('Advancement did not converge: '+item.name);
}
for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{
    const request=JSON.parse(line),item=book.get(request.id)||request.item;
    if(request.op==='seed')process.stdout.write(JSON.stringify({data:seed(item,request.level||1)})+'\n');
    else if(request.op==='copy'){
      const draft=derive(request.draft,'character',schema,request.draft.rulesEdition||item.data.rulesEdition),entry=ownedItem(item,draft);
      const collection={weapon:'weapons',armor:'inventory',equipment:'inventory',consumable:'inventory',spell:'spells',feat:'features',feature:'features',race:'features',background:'features',class:'features',effect:'effects'}[item.type];
      draft[collection]=[...(draft[collection]||[]),entry];
      const expected=derive(draft,'character',schema,request.draft.rulesEdition||item.data.rulesEdition)[collection].find(row=>row.id===entry.id).data;
      const normalizedFields=Object.keys({...item.data,...expected}).filter(key=>JSON.stringify(item.data[key])!==JSON.stringify(expected[key]));
      process.stdout.write(JSON.stringify({data:expected,normalizedFields})+'\n');
    }
    else process.stdout.write(JSON.stringify(resolve(item,derive(request.draft,'character',schema,request.draft.rulesEdition||item.data.rulesEdition),request.level||1))+'\n');
  }catch(error){process.stdout.write(JSON.stringify({error:error.stack})+'\n');}
}
"""

OBSERVER = r"""({actorId,name,timeout})=>{
  window.__gwCompendiumBench?.stop();
  const surface=document.querySelector(`.actor-directory__sheet[data-actor-id="${actorId}"]`);
  if(!surface)throw Error('Actor surface missing');
  const timing={started:performance.now(),ready:null,readyKind:null,inserted:null,saved:null,confirmed:null,choiceSubmissions:0};
  let changed=false,resolveReady,resolveInserted,resolveSaved;
  const ready=new Promise(resolve=>resolveReady=resolve),inserted=new Promise(resolve=>resolveInserted=resolve),saved=new Promise(resolve=>resolveSaved=resolve);
  const visible=node=>!!node&&node.isConnected&&!node.hidden&&node.getClientRects().length>0;
  function scan(){
    const now=performance.now(),modal=document.querySelector('.gw5-advancement-modal');
    const row=[...surface.querySelectorAll('[data-entry-id].gw5-item--added')].find(row=>row.textContent.includes(name));
    if(timing.ready===null&&(visible(modal)||visible(row))){timing.ready=now;timing.readyKind=visible(modal)?'choices':'inserted';resolveReady({...timing});}
    if(timing.inserted===null&&visible(row)){timing.inserted=now;resolveInserted({...timing});}
    const state=surface.querySelector('.gw5-footer .gw5-save-status')?.dataset.state;
    if(state==='waiting'||state==='saving')changed=true;
    if(changed&&state==='saved'&&timing.saved===null){timing.saved=now;resolveSaved({...timing});}
  }
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-state','aria-current','hidden']});
  const deadline=setTimeout(()=>{const failure={timeout:true,...timing,notices:[...surface.querySelectorAll('.gw5-notice')].filter(visible).map(node=>node.textContent)};resolveReady(failure);resolveInserted(failure);resolveSaved(failure);},timeout);
  window.__gwCompendiumBench={ready,inserted,saved,timing,confirm(){timing.confirmed=performance.now();timing.choiceSubmissions++;},stop(){observer.disconnect();clearTimeout(deadline);}};
}"""


class OfflinePlanner:
    def __init__(self):
        node = node_executable()
        self.process = subprocess.Popen([str(node), "--input-type=module", "-e", PLANNER, str(MODULE)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        encoding="utf-8", text=True)

    def call(self, **payload):
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError("Offline planner exited: " + self.process.stderr.read())
        result = json.loads(line)
        assert "error" not in result, result.get("error")
        return result

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        self.process.stdout.close()
        self.process.stderr.close()


def dependency_score(item, catalog):
    """Rank actual portable reference closure, not an English document name."""
    seen, rows, choices, pools = set(), 0, 0, 0

    def visit(entry):
        nonlocal rows, choices, pools
        if entry["id"] in seen:
            return
        seen.add(entry["id"])
        advancements = entry["data"].get("advancement", [])
        if isinstance(advancements, dict):
            advancements = advancements.values()
        for advancement in advancements:
            rows += 1
            if advancement["type"] in ("ItemChoice", "Trait", "Size", "AbilityScoreImprovement"):
                choices += 1

        def references(value):
            nonlocal pools
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == "pool" and isinstance(child, list):
                        pools += len(child)
                    references(child)
            elif isinstance(value, list):
                for child in value:
                    references(child)
            elif isinstance(value, str) and value in catalog:
                visit(catalog[value])

        references(entry["data"].get("advancement", []))
        references(entry["data"].get("startingEquipment", []))

    visit(item)
    return {"referencedDocuments": len(seen) - 1, "advancementRows": rows,
            "choiceRows": choices, "poolEntries": pools}


def native(page, expression, args=None):
    return page.evaluate("async args=>{" + expression + "}", args)


def sheet_data(page, seed, actor_id):
    response = page.request.get(BASE + f'/api/containers/{seed["campaign"]}/actors/{actor_id}/sheet')
    assert response.ok, response.text()
    return response.json()


def library(page):
    return native(page, "return await window.gravewright.items.state();")


def page_for(browser, seed):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_cookies([{**seed["sessions"]["gm"], "url": BASE}])
    page = context.new_page()
    page.set_default_timeout(TIMEOUT)
    page.goto(BASE + "/game/" + seed["campaign"])
    page.wait_for_function("!!window.gravewrightActors&&!!window.gravewright")
    return context, page


def open_actor(page, actor_id):
    native(page, "window.gravewrightActors.open(args);", actor_id)
    window = page.locator(f'.actor-directory__sheet[data-actor-id="{actor_id}"]')
    sheet = window.locator(".gw5-sheet")
    expect(sheet.locator(".gw5-footer .gw5-save-status")).to_have_attribute("data-state", "saved")
    # Exclude sheet mount work, but not drop dependency reads, from the interval.
    page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    return window, sheet


def close_actor(page, window):
    window.locator('[data-window="close"]').click()
    expect(window).to_have_count(0)
    # Module content is disposed before its native window has fully closed.
    # Reopening in that gap races the native actor-window lifecycle.
    page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")


def create_actor(page, name, data):
    created = native(page, "return await window.gravewright.actors.create(args);", {
        "name": name, "type": "character", "data": data})
    # SDK creation and the native directory's socket projection are separate.
    # Its open(id) resolves actorType from that projection, so wait for the row
    # rather than opening an untyped {id} fallback or polling the HTTP API.
    expect(page.locator("#actors-panel .actor-directory__list strong").get_by_text(name, exact=True)).to_have_count(1)
    return created["id"]


def drop(page, target, reference, synthetic=False):
    mime = "application/x-gravewright-item" if synthetic else "application/x-gravewright-compendium"
    transfer = page.evaluate_handle("({mime,reference})=>{const data=new DataTransfer();data.setData(mime,JSON.stringify(reference));return data;}",
                                    {"mime": mime, "reference": reference})
    target.dispatch_event("dragover", {"dataTransfer": transfer})
    target.dispatch_event("drop", {"dataTransfer": transfer})
    transfer.dispose()


def resolve_choices(page, recipe, level):
    modal = page.locator(".gw5-advancement-modal")
    class_level = modal.locator('[name="classLevel"]')
    if class_level.count() and class_level.input_value() != str(level):
        class_level.fill(str(level))
        class_level.dispatch_event("change")
    stages = 0
    while modal.count():
        assert stages < 120, "Choice UI failed to converge"
        for fieldset in modal.locator("[data-choice-id]").all():
            key = fieldset.get_attribute("data-choice-id")
            assert key in recipe["answers"], f"UI introduced an unplanned choice: {key}"
            answer = recipe["answers"][key]
            selects = fieldset.locator("select")
            if selects.count():
                selects.select_option(str(answer[0] if isinstance(answer, list) else answer))
            elif fieldset.locator("[data-ability]").count():
                for control in fieldset.locator("[data-ability]").all():
                    control.fill(str(answer.get(control.get_attribute("data-ability"), 0)))
            elif fieldset.locator('input[type="number"]').count():
                fieldset.locator('input[type="number"]').fill(str(answer))
            else:
                selected = set(answer if isinstance(answer, list) else [answer])
                for control in fieldset.locator('input[type="checkbox"]').all():
                    control.set_checked(control.get_attribute("value") in selected)
        page.evaluate("()=>window.__gwCompendiumBench.confirm()")
        modal.locator('button[type="submit"]').click()
        stages += 1
    return stages


def timing(page, key):
    value = page.evaluate("key=>window.__gwCompendiumBench[key]", key)
    assert not value.get("timeout"), value
    return value


def assert_owned(data, before, item, recipe=None, expected_copy=None):
    collection, _ = ROUTES[item["type"]]
    matches = [entry for entry in data.get(collection, []) if entry.get("source") == item["id"]]
    assert len(matches) == 1, (item["name"], collection, matches)
    owned = matches[0]
    assert owned["id"] != item["id"] and owned["name"] == item["name"] and owned["type"] == item["type"]
    assert owned["data"].get("rulesEdition") == item["data"].get("rulesEdition")
    for key in ("provenance", "source", "identifier"):
        if key in item["data"]:
            assert owned["data"].get(key) == item["data"][key], (item["name"], key)
    if recipe:
        expected = recipe["expected"]
        for key in COLLECTIONS:
            actual_rows, expected_rows = data.get(key, []), expected.get(key, [])
            assert len(actual_rows) == len(expected_rows), (item["name"], key, len(actual_rows), len(expected_rows))
            for predicted in expected_rows:
                actual = next((entry for entry in actual_rows if entry["id"] == predicted["id"]), None)
                assert actual is not None, (item["name"], key, predicted["name"])
                assert (actual["source"], actual["type"], actual["name"]) == (predicted["source"], predicted["type"], predicted["name"])
                for metadata in ("rulesEdition", "provenance", "source"):
                    assert actual["data"].get(metadata) == predicted["data"].get(metadata)
        parent = data["advancementLedger"]["parents"][recipe["parentId"]]
        assert parent["source"] == item["id"] and parent["answers"] == recipe["answers"]
    else:
        # A portable usesProfile legitimately initializes the owned resource,
        # e.g. Acid2024 uses:1 becomes {max:1,value:1}. Compare every field
        # against the module's complete derivation, never drop differing keys.
        assert expected_copy is not None
        assert owned["data"] == expected_copy["data"], {
            "message": "A direct copy differs from its complete derived source data",
            "fields": [key for key in owned["data"].keys() | expected_copy["data"].keys()
                       if owned["data"].get(key) != expected_copy["data"].get(key)]}
        for key in COLLECTIONS:
            assert len(data.get(key, [])) == len(before.get(key, [])) + (key == collection)
    return owned


def measured_drop(page, seed, planner, case, mode, sequence):
    item = case["item"]
    initial = planner.call(op="seed", id=item["id"], item=item, level=case["level"])["data"]
    actor_id = create_actor(page, f'Compendium benchmark {sequence} {mode} {case["edition"]} {item["type"]} {secrets.token_hex(3)}', initial)
    window, sheet = open_actor(page, actor_id)
    before = sheet_data(page, seed, actor_id)
    advanced = item["type"] in ("race", "background", "class") or bool(item["data"].get("advancement"))
    recipe = planner.call(op="resolve", id=item["id"], item=item, draft=before["data"], level=case["level"]) if advanced else None
    expected_copy = planner.call(op="copy", id=item["id"], item=item, draft=before["data"]) if not advanced else None
    calls = []

    def request_listener(request):
        if request.method == "POST" and request.url.endswith("/api"):
            payload = request.post_data_json or {}
            calls.append({"domain": payload.get("domain"), "method": payload.get("method"),
                          "ids": len(payload.get("payload", {}).get("ids", []))})

    page.on("request", request_listener)
    page.evaluate(OBSERVER, {"actorId": actor_id, "name": item["name"], "timeout": TIMEOUT})
    try:
        drop(page, sheet.locator(".gw5-header"), case["reference"], case.get("synthetic", False))
        ready = timing(page, "ready")
        choice_steps = resolve_choices(page, recipe, case["level"]) if ready["readyKind"] == "choices" else 0
        assert recipe is not None or choice_steps == 0
        insertion = timing(page, "inserted")
        saved = timing(page, "saved")
        page.remove_listener("request", request_listener)
        calls = list(calls)
        collection, tab = ROUTES[item["type"]]
        expect(sheet.locator(f'[data-gw5-tab="{tab}"]')).to_have_attribute("aria-current", "true")
        # Validation reads occur only AFTER the saved DOM event ends timing.
        after = sheet_data(page, seed, actor_id)
        assert after["sheetVersion"] > before["sheetVersion"], "Autosave did not persist"
        owned = assert_owned(after["data"], before["data"], item, recipe, expected_copy)
        assert not any(row["domain"] == "compendiums" and row["method"] == "import" for row in calls), calls
        expect(sheet.locator(f'[data-entry-id="{owned["id"]}"]')).to_be_visible()
        metrics = {"readyMilliseconds": round(ready["ready"] - ready["started"], 2),
                   "readyKind": ready["readyKind"],
                   "insertMilliseconds": round(insertion["inserted"] - insertion["started"], 2),
                   "savedMilliseconds": round(saved["saved"] - saved["started"], 2),
                   "interactionMilliseconds": round((saved["confirmed"] or ready["ready"]) - ready["ready"], 2),
                   "confirmationToInsertMilliseconds": round(insertion["inserted"] - (insertion["confirmed"] or insertion["started"]), 2),
                   "confirmationToSavedMilliseconds": round(saved["saved"] - (saved["confirmed"] or saved["started"]), 2),
                   "choiceSubmissions": choice_steps, "requests": calls,
                   "normalizedFields": expected_copy["normalizedFields"] if expected_copy else [],
                   "requestCounts": dict(Counter(row["domain"] + "." + row["method"] for row in calls)),
                   "actorId": actor_id, "ownedCollection": collection, "ownedId": owned["id"],
                   "grantedEntries": sum(len(after["data"].get(key, [])) - len(before["data"].get(key, [])) for key in COLLECTIONS)}
        close_actor(page, window)
        # Reopen proves persisted content, rather than merely a private UI draft.
        reopened, reopened_sheet = open_actor(page, actor_id)
        reopened_sheet.locator(f'[data-gw5-tab="{tab}"]').click()
        expect(reopened_sheet.locator(f'[data-entry-id="{owned["id"]}"]')).to_be_visible()
        close_actor(page, reopened)
        return metrics, recipe
    finally:
        page.remove_listener("request", request_listener)
        page.evaluate("()=>window.__gwCompendiumBench?.stop()")


def cancellation(page, seed, planner, case, sequence):
    item = case["item"]
    initial = planner.call(op="seed", id=item["id"], item=item, level=case["level"])["data"]
    actor_id = create_actor(page, f'Compendium cancellation {sequence} {item["type"]} {secrets.token_hex(3)}', initial)
    window, sheet = open_actor(page, actor_id)
    before, library_before = sheet_data(page, seed, actor_id), library(page)
    page.evaluate(OBSERVER, {"actorId": actor_id, "name": item["name"], "timeout": TIMEOUT})
    try:
        drop(page, sheet.locator(".gw5-header"), case["reference"], case.get("synthetic", False))
        ready = timing(page, "ready")
        assert ready["readyKind"] == "choices"
        modal = page.locator(".gw5-advancement-modal")
        # Changing an answer/level must remain private even when canceled.
        if modal.locator('[name="classLevel"]').count():
            modal.locator('[name="classLevel"]').fill(str(case["level"]))
            modal.locator('[name="classLevel"]').dispatch_event("change")
        selects = modal.locator("select")
        checks = modal.locator('input[type="checkbox"]')
        if selects.count():
            values = selects.first.locator("option").evaluate_all("nodes=>nodes.map(node=>node.value).filter(Boolean)")
            assert values
            selects.first.select_option(values[0])
        elif checks.count():
            checks.first.check()
        page.keyboard.press("Escape")
        expect(modal).to_have_count(0)
        # Flush on close exposes any accidentally queued partial save without
        # arbitrary sleeps or HTTP polling.
        close_actor(page, window)
        assert sheet_data(page, seed, actor_id) == before, "Canceled choices changed actor/version"
        assert library(page) == library_before, "Canceled choices changed the item library"
        return {"actorId": actor_id, "atomic": True,
                "readyMilliseconds": round(ready["ready"] - ready["started"], 2)}
    finally:
        page.evaluate("()=>window.__gwCompendiumBench?.stop()")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--types", help="Comma-separated item types (default: all installed types)")
    parser.add_argument("--editions", default="2014,2024")
    parser.add_argument("--samples", default="representative,maximum", help="representative,maximum")
    parser.add_argument("--report", default="performance-all-types.json", help="JSON filename inside test-results/5e-compendium")
    args = parser.parse_args()
    assert urlparse(BASE).hostname in ("localhost", "127.0.0.1") and urlparse(BASE).port not in (None, 3000), "Disposable local fixture only"
    seed = json.loads((ROOT / "data/5e-review-seed.json").read_text(encoding="utf-8"))
    assert Path(seed["fixture"]).resolve().parent == (ROOT / "data/5e-review").resolve(), "Not a disposable seed"
    editions = args.editions.split(",")
    assert set(editions) <= {"2014", "2024"}
    samples = args.samples.split(",")
    assert set(samples) <= {"representative", "maximum"}
    assert Path(args.report).name == args.report and args.report.endswith(".json")
    documents = {edition: [item for pack in json.loads((MODULE / f"compendiums/{edition}.json").read_text(encoding="utf-8"))["packs"] for item in pack["entries"]] for edition in editions}
    catalog = {item["id"]: item for entries in documents.values() for item in entries}
    declared = {row["id"] for row in json.loads((MODULE / "manifest.json").read_text(encoding="utf-8"))["system"]["itemTypes"]}
    requested = set(args.types.split(",")) if args.types else declared
    assert requested <= declared, requested - declared
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"base": BASE, "started": datetime.now(timezone.utc).isoformat(),
              "method": "MutationObserver/performance.now; no validation API polling inside timing; cold=new browser context/module, warm=same page/module and a fresh actor",
              "selection": "Representative is deterministic lexical first. Maximum ranks transitive portable reference closure, advancement rows, choice rows and pool size; maximum advancement cases use character/class level 20.",
              "ownedNormalization": "Direct owned data must exactly equal derive(ownedItem(source)); original source, rulesEdition and provenance are checked separately. Normalized top-level fields are reported, not ignored.",
              "actualTypes": {edition: dict(Counter(item["type"] for item in entries)) for edition, entries in documents.items()},
              "cases": [], "errors": [], "pageErrors": []}
    filename = OUTPUT / args.report

    def save():
        filename.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    planner = OfflinePlanner()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        setup_context, setup = page_for(browser, seed)
        packs = native(setup, "return (await window.gravewright.compendiums.state()).packs;")
        indexes = {entry["id"]: {"campaign": seed["campaign"], "packId": pack["id"], "id": entry["id"], "kind": "item"}
                   for pack in packs if pack.get("systemId") == "gravewright.5e-srd" and pack["id"].startswith("native:") for entry in pack["entries"]}
        assert all(item["id"] in indexes for item in catalog.values()), "Installed fixture differs from current compendium JSON"
        cases = []
        for edition in editions:
            for kind in sorted(requested):
                entries = sorted((item for item in documents[edition] if item["type"] == kind), key=lambda item: (item["name"].casefold(), item["id"]))
                if not entries:
                    assert kind == "effect", f"Add a deliberate synthetic fixture for missing type {kind}"
                    name = "Synthetic benchmark effect " + edition + " " + secrets.token_hex(3)
                    data = {"rulesEdition": edition, "description": "Disposable synthetic coverage; no SRD effect pack exists.",
                            "duration": {"type": "permanent", "value": 0}, "category": "buff", "modifiers": [{"target": "roll.check", "mode": "add", "value": 1}]}
                    created = native(setup, "return await window.gravewright.items.create(args);", {"name": name, "type": kind, "data": data})
                    item = native(setup, "return await window.gravewright.items.get(args);", created["id"])
                    cases.append({"edition": edition, "sample": "synthetic", "item": item, "level": 1,
                                  "reference": {"id": item["id"], "tableId": seed["campaign"]}, "synthetic": True,
                                  "complexity": {"referencedDocuments": 0, "advancementRows": 0, "choiceRows": 0, "poolEntries": 0}})
                    continue
                scores = {item["id"]: dependency_score(item, catalog) for item in entries}
                maximum = max(entries, key=lambda item: tuple(scores[item["id"]].values()))
                for sample in samples:
                    item = entries[0] if sample == "representative" else maximum
                    cases.append({"edition": edition, "sample": sample, "item": item,
                                  "level": 20 if sample == "maximum" and kind in ("class", "race", "background", "feature", "feat") else 1,
                                  "reference": indexes[item["id"]], "complexity": scores[item["id"]]})
        # Synthetic fixtures are created before the baseline. Drops and canceled
        # choices must leave the entire library unchanged from here onward.
        library_before = library(setup)
        report["libraryBaselineCount"] = len(library_before["items"])
        save()
        setup_context.close()
        for sequence, case in enumerate(cases, 1):
            context, page = page_for(browser, seed)
            page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
            result = {"edition": case["edition"], "type": case["item"]["type"], "sample": case["sample"],
                      "name": case["item"]["name"], "sourceId": case["item"]["id"], "classLevel": case["level"],
                      "synthetic": case.get("synthetic", False), "complexity": case["complexity"]}
            report["cases"].append(result)
            try:
                for mode in ("cold", "warm"):
                    metrics, recipe = measured_drop(page, seed, planner, case, mode, sequence)
                    result[mode] = metrics
                    print(f'{sequence}/{len(cases)} {case["edition"]} {case["item"]["type"]} {case["sample"]} {mode}: ready={metrics["readyMilliseconds"]}ms save-after-confirm={metrics["confirmationToSavedMilliseconds"]}ms', flush=True)
                if result["cold"]["readyKind"] == "choices":
                    result["cancellation"] = cancellation(page, seed, planner, case, sequence)
                assert library(page) == library_before, "Drops changed the library"
                result["passed"] = True
            except Exception as error:
                result["passed"] = False
                result["error"] = str(error)
                report["errors"].append({"case": sequence, "type": case["item"]["type"], "edition": case["edition"], "error": str(error)})
                print(f'FAIL {sequence}/{len(cases)} {case["item"]["name"]}: {error}', flush=True)
                try:
                    page.screenshot(path=str(OUTPUT / f'failure-{sequence:02d}-{case["edition"]}-{case["item"]["type"]}.png'))
                except Exception:
                    pass
            finally:
                context.close()
                save()
        final_context, final_page = page_for(browser, seed)
        report["libraryUnchanged"] = library(final_page) == library_before
        final_context.close()
        browser.close()
    planner.close()
    report["finished"] = datetime.now(timezone.utc).isoformat()
    report["passed"] = not report["errors"] and not report["pageErrors"] and report["libraryUnchanged"]
    save()
    print(json.dumps({"passed": report["passed"], "cases": len(report["cases"]), "failures": len(report["errors"]),
                      "pageErrors": len(report["pageErrors"]), "libraryUnchanged": report["libraryUnchanged"], "report": str(filename)}), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
