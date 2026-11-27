"""Validate generated SRD data and release ZIPs without downloading source books."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import zipfile

from build import ROOT, browser_files, read
from validate_locales import load_locales

# VTT 0.3.8+ shows each edition's items, spells and monsters in one package folder.
FOLDERS = {'2014': ['DnD 5e SRD', 'SRD 5.1 · 2014'], '2024': ['DnD 5e SRD', 'SRD 5.2.1 · 2024']}


def validate(root=ROOT):
    root = Path(root).resolve()
    browser = read(root / 'manifest.json')
    assert browser['id'] == 'gravewright.5e-srd' and browser['name'] == 'DnD 5e SRD'
    assert browser['version'] == read(root / 'package.json')['version']
    assert 'django' not in browser
    assert browser['system']['combat']['requiresProvider'] is False
    system = read(root / 'system.json')
    assert system['locales'] == load_locales(root / 'locales'), 'Rebuild system.json after editing catalogs'
    assert system['actions'] == read(root / 'rules/actions.gw.json')['actions']
    assert system['schemas'] == {p.name.removesuffix('.schema.json'): read(p) for p in (root / 'schemas').glob('*.json')}
    assert system['layouts'] == {p.relative_to(root / 'layouts').as_posix().removesuffix('.sheet.gw.json'): read(p)
                                 for p in (root / 'layouts').rglob('*.json')}
    provenance = read(root / 'compendiums/PROVENANCE.json')
    notice_path = 'compendiums/THIRD-PARTY-DATA-LICENSE.txt'
    assert provenance['upstream']['license'] == 'MIT'
    assert provenance['upstream']['notice'] == notice_path
    assert (root / notice_path).read_text(encoding='utf-8').startswith('Copyright 2021 Andrew Clayton\n')
    allowed_types = {item['id'] for item in browser['system']['itemTypes']}
    assert browser['content']['compendiums'] == ['compendiums/2014.json', 'compendiums/2024.json', 'compendiums/monsters-2014.json', 'compendiums/monsters-2024.json']
    totals = {}
    for edition in ('2014', '2024'):
        collection = read(root / f'compendiums/{edition}.json')
        assert collection['license'] == 'CC-BY-4.0' and collection['folder'] == FOLDERS[edition]
        ids, counts = set(), Counter()
        for pack in collection['packs']:
            assert pack['type'] in {'item_pack', 'spell_pack'} and pack['entries']
            for entry in pack['entries']:
                assert entry['id'] not in ids and entry['name'].strip()
                ids.add(entry['id'])
                assert entry['systemId'] == browser['id'] and entry['type'] in allowed_types
                counts[entry['type']] += 1
                data = entry['data']
                assert data['rulesEdition'] == edition
                source = data['provenance']
                assert source['contentLicense'] == 'CC-BY-4.0'
                assert source['sourceCommit'] == provenance['upstream']['commit']
                assert source['sourcePath'] and source['sourceId']
                assert source['sourcePath'].startswith('packs/_source/') and '..' not in Path(source['sourcePath']).parts
                assert re.fullmatch('[a-f0-9]{40}', source['sourceGitBlob'])
                assert re.fullmatch('[a-f0-9]{64}', source['sourceSha256'])
                assert source['officialSRD'] == provenance['official'][edition]['url']
                assert source['officialPdfSha256'] == provenance['official'][edition]['sha256']
        assert dict(counts) == provenance['counts'][edition]
        totals[edition] = {'packs': len(collection['packs']), 'documents': len(ids)}
    for edition, count in [('2014',317),('2024',330)]:
        collection = read(root / f'compendiums/monsters-{edition}.json')
        assert collection['license'] == 'CC-BY-4.0' and collection['folder'] == FOLDERS[edition]
        assert len(collection['packs']) == 1 and collection['packs'][0]['type'] == 'actor_pack'
        entries = collection['packs'][0]['entries']
        assert len(entries) == count and len({e['id'] for e in entries}) == count
        for entry in entries:
            assert entry['type'] == 'monster' and entry['systemId'] == browser['id']
            assert entry['data']['rulesEdition'] == edition
            assert entry['data']['provenance']['contentLicense'] == 'CC-BY-4.0'
            source = entry['data']['provenance']
            if not source.get('adaptation', '').startswith('Direct official PDF'):
                assert source['sourceCommit'] == provenance['upstream']['commit']
                assert source['sourcePath'] and source['sourceId']
                assert source['sourcePath'].startswith('packs/_source/') and '..' not in Path(source['sourcePath']).parts
                assert re.fullmatch('[a-f0-9]{40}', source['sourceGitSha'])
                assert re.fullmatch('[a-f0-9]{64}', source['sourceSha256'])
            assert entry['data']['provenance']['officialPdfSha256'] == provenance['official'][edition]['sha256']
            assert entry['data']['hp']['max'] > 0 and entry['data']['ac'] > 0
        totals[edition]['monsters'] = len(entries)
    reports = []
    for prefix, files in [('gravewright-5e-srd', browser_files(root))]:
        path = root / 'dist' / f'{prefix}-{browser["version"]}.zip'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert path.with_suffix('.zip.sha256').read_text().strip() == f'{digest}  {path.name}'
        with zipfile.ZipFile(path) as archive:
            assert archive.namelist() == sorted(files) and archive.testzip() is None
            for name, source in files.items():
                assert archive.read(name) == source.read_bytes(), name
            assert {'manifest.json', 'LICENSE.md', 'NOTICE.md'} <= set(archive.namelist())
            assert notice_path in archive.namelist()
            assert json.loads(archive.read('manifest.json')) == browser
            assert not any(name.endswith(('.py', '.pyc', '.pyd')) or name.startswith(('server/', 'scripts/', 'tests/')) for name in archive.namelist())
        reports.append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest, 'files': len(files)})
    return {'version': browser['version'], 'compendiums': totals, 'archives': reports}


if __name__ == '__main__':
    print(json.dumps(validate(), indent=2))
