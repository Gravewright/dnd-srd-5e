"""Convert licensed SRD stat blocks to native monster sheets, without artwork."""
import hashlib
import json
import math
from pathlib import Path
import re
import uuid
from build_compendiums import ROOT, CACHE, COMMIT, SYSTEM, PDF_HASHES, PDF_URLS, load, norm, number, pymupdf

SKILLS = dict(zip('acr ani arc ath dec his ins itm inv med nat prc prf per rel slt ste sur'.split(), 'acrobatics animal_handling arcana athletics deception history insight intimidation investigation medicine nature perception performance persuasion religion sleight_of_hand stealth survival'.split()))
SIZES = {'tiny':'tiny','sm':'small','med':'medium','lg':'large','huge':'huge','grg':'gargantuan'}

def official_blocks(edition, names):
    path = CACHE / f'{edition}.pdf'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == PDF_HASHES[edition]
    result, current, rows, page_number = {}, None, [], None
    def finish():
        if current:
            text = '\n'.join(rows).replace('\u00ad','').replace('‐','-').replace('−','-')
            text = re.sub(r'([a-z])-\n([a-z])',r'\1\2',text)
            result[current] = {'description':text.strip(),'page':page_number}
    for page in pymupdf.open(path):
        if page.number < (260 if edition == '2014' else 234):
            continue
        for side in (0,1):
            clip=pymupdf.Rect(side*page.rect.width/2,30,(side+1)*page.rect.width/2,page.rect.height-45)
            lines=[]
            for block in page.get_text('dict',clip=clip)['blocks']:
                for line in block.get('lines',[]):
                    text=' '.join(''.join(s['text'] for s in line['spans']).split())
                    if text:lines.append((line['bbox'][1],line['bbox'][0],text,line['spans']))
            for _,_,text,spans in sorted(lines):
                text = {'Elf, Drow':'Drow','Gnome, Deep (Svirfneblin)':'Deep Gnome'}.get(text,text)
                heading = any(('Calibri-Bold' == s['font'] and abs(s['size']-12)<.2) if edition=='2014' else ('GillSans-SemiBold' == s['font'] and 14<s['size']<16) for s in spans)
                boundary = any(s['size']>=17 for s in spans)
                if heading or boundary:
                    finish();current=norm(text) if heading and norm(text) in names else None
                    rows=[];page_number=page.number+1
                elif current:
                    rows.append(text)
    finish()
    return result

def convert(source, edition, block, provenance):
    s=source['system'];a=s['attributes'];traits=s.get('traits',{});details=s['details'];cr=number(details.get('cr'))
    prof=2+max(0,math.floor((cr-1)/4))
    text=block['description']
    # Preserve the official stat block verbatim; spellcasting, conditional damage,
    # legendary actions and multiattack are reference text, not guessed automation.
    sections=re.split(r'\n(Traits|Actions|Bonus Actions|Reactions|Legendary Actions)\n',text)
    chunks=dict(zip(sections[1::2],sections[2::2]))
    speed=', '.join(f'{k} {v} ft.' for k,v in a.get('movement',{}).items() if k in {'walk','fly','swim','climb','burrow'} and number(v)>0)
    sense=a.get('senses',{});ranges=sense.get('ranges',sense)
    senses=', '.join(f'{k} {v} ft.' for k,v in ranges.items() if k in {'darkvision','blindsight','truesight','tremorsense'} and number(v)>0)
    languages=traits.get('languages',{})
    data={'rulesEdition':edition,'size':SIZES.get(traits.get('size'),'medium'),'type':details.get('type',{}).get('value',''),'alignment':details.get('alignment',''),'cr':str(cr),'prof':prof,
          'abilities':{k:{'score':number(v.get('value'),10)} for k,v in s['abilities'].items()},
          'saves':{k:{'prof':number(v.get('proficient'))>0} for k,v in s['abilities'].items()},
          'skills':{SKILLS[k]:{'prof':number(v.get('value'))>0,'expert':number(v.get('value'))>=2,'ability':v['ability']} for k,v in s.get('skills',{}).items() if k in SKILLS},
          'hp':{'value':number(a['hp']['max']),'max':number(a['hp']['max']),'formula':a['hp'].get('formula','')},'ac':int(re.search(r'(?:Armor Class|AC)\s+(\d+)',text)[1]),'acMode':'manual','acModeExplicit':True,
          'speed':speed,'senses':senses,'languages':', '.join(languages.get('value',[]))+(' '+languages.get('custom','')),
          'traits':chunks.get('Traits',sections[0]),'actions_text':'\n\n'.join(k+'\n'+chunks[k] for k in ('Actions','Bonus Actions','Reactions') if k in chunks),'legendary':chunks.get('Legendary Actions',''),
          'legendary_actions_enabled':1 if chunks.get('Legendary Actions') else 0,'legendary_resistance':number(s.get('resources',{}).get('legres',{}).get('max')),
          'resistances':'; '.join(k+': '+', '.join(traits.get(code,{}).get('value',[]))+' '+traits.get(code,{}).get('custom','') for k,code in (('Resistances','dr'),('Immunities','di'),('Vulnerabilities','dv'),('Condition immunities','ci')) if traits.get(code,{}).get('value') or traits.get(code,{}).get('custom')),
          'description':text,'source':f"SRD {'5.1' if edition=='2014' else '5.2.1'}, p. {block['page']}",'provenance':provenance,'attacks':[],'features':[]}
    initiative=re.search(r'Initiative\s+([+-]\d+)',text)
    if initiative:data['init_misc']=int(initiative[1])-math.floor((data['abilities']['dex']['score']-10)/2)
    # Only plain, single-damage attack rolls receive an executable weapon record.
    # Full descriptions remain available for every attack and special action.
    attack_pattern=r'([^\n]+?)\. (Melee|Ranged)(?: Weapon| Spell)? (?:Attack:|Attack Roll:)\s*([+-]\d+)(?: to hit)?,.*?Hit:\s*\d+\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*(\w+) damage'
    actions=chunks.get('Actions','')
    for match in re.finditer(attack_pattern,actions,re.S|re.I):
        if re.match(r'\s+plus\s+\d+',actions[match.end():],re.I):continue
        name=match[1].strip()
        if len(name)>100:continue
        identifier=str(uuid.uuid5(uuid.NAMESPACE_URL,provenance['sourcePath']+'/'+name))
        data['attacks'].append({'id':identifier,'name':name,'type':'weapon','quantity':1,'equipped':True,'data':{'rulesEdition':edition,'description':match[0],'attack_ability':'none','proficient':False,'attack_type':match[2].lower(),'attack_bonus':int(match[3]),'damage':re.sub(r'\s+','',match[4]),'damage_bonus':0,'damage_type':match[5].lower()}})
    return data

def main():
    tree=json.loads((CACHE/'tree.json').read_text());all_report={}
    for edition,pack in (('2014','monsters'),('2024','actors24')):
        rows=[r for r in tree['tree'] if r['path'].startswith(f'packs/_source/{pack}/') and r['path'].endswith('.yml') and not r['path'].endswith('/_folder.yml')]
        sources=[(row,load(CACHE/COMMIT/row['path'])) for row in rows]
        blocks=official_blocks(edition,{norm(s.get('name','')) for _,s in sources})
        entries=[];excluded=[]
        for row,s in sources:
            if s.get('type')!='npc':continue
            if s.get('system',{}).get('source',{}).get('license')!='CC-BY-4.0' or norm(s['name']) not in blocks:
                excluded.append({'name':s['name'],'path':row['path'],'reason':'missing-license-or-official-stat-block'});continue
            raw=(CACHE/COMMIT/row['path']).read_bytes()
            assert hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()==row['sha']
            block=blocks[norm(s['name'])]
            provenance={'sourceRepository':'https://github.com/foundryvtt/dnd5e','sourceCommit':COMMIT,'sourcePath':row['path'],'sourceId':s['_id'],'sourceGitSha':row['sha'],'sourceSha256':hashlib.sha256(raw).hexdigest(),'contentLicense':'CC-BY-4.0','officialSRD':PDF_URLS[edition],'officialPdfSha256':PDF_HASHES[edition],'officialPage':block['page']}
            entries.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,SYSTEM+'/'+edition+'/'+row['path'])),'name':s['name'],'type':'monster','systemId':SYSTEM,'data':convert(s,edition,block,provenance)})
        if edition=='2024':
            # These SRD creatures lack upstream license metadata. Build directly
            # from the licensed PDF rather than redistribute their YAML records.
            for name in ('Giant Centipede','Giant Wasp'):
                block=blocks[norm(name)];text=block['description']
                hp=re.search(r'HP (\d+) \(([^)]+)\)',text)
                abilities={k.lower():{'value':int(v)} for k,v in re.findall(r'(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)',text)}
                source={'system':{'abilities':abilities,'attributes':{'hp':{'max':int(hp[1]),'formula':hp[2]},'ac':{}},'details':{'cr':.25 if name=='Giant Centipede' else .5,'type':{'value':'beast'},'alignment':'Unaligned'},'traits':{'size':'sm' if name=='Giant Centipede' else 'med'}}}
                provenance={'sourceRepository':PDF_URLS[edition],'sourcePath':f'SRD-5.2.1/page-{block["page"]}/{norm(name)}','sourceSha256':PDF_HASHES[edition],'contentLicense':'CC-BY-4.0','officialSRD':PDF_URLS[edition],'officialPdfSha256':PDF_HASHES[edition],'officialPage':block['page'],'adaptation':'Direct official PDF transcription; upstream YAML not used.'}
                data=convert(source,edition,block,provenance)
                data['speed']=re.search(r'Speed ([^\n]+)',text)[1]
                data['senses']=re.search(r'Senses ([^\n]+)',text)[1]
                data['languages']='None'
                entries.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,SYSTEM+'/'+edition+'/'+provenance['sourcePath'])),'name':name,'type':'monster','systemId':SYSTEM,'data':data})
        entries.sort(key=lambda e:e['name'])
        output={'name':f"SRD {'5.1' if edition=='2014' else '5.2.1'} ({edition})",'license':'CC-BY-4.0','packs':[{'id':f'srd-{edition}-monsters','label':'Monsters','type':'actor_pack','entries':entries}]}
        (ROOT/'compendiums'/f'monsters-{edition}.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
        all_report[edition]={'included':len(entries),'excluded':excluded}
    (ROOT/'compendiums/MONSTER-PROVENANCE.json').write_text(json.dumps(all_report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:{'included':v['included'],'excluded':len(v['excluded'])} for k,v in all_report.items()}))

if __name__=='__main__':main()
