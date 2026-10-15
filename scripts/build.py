"""Build one deterministic browser system without local or historical fixtures."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile
from validate_locales import load_locales

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = {'assets', 'compendiums', 'content', 'layouts', 'locales', 'mappings', 'rules', 'schemas', 'docs'}
SUFFIXES = {'.js', '.json', '.css', '.md', '.txt', '.webp', '.svg'}
ROOT_DATA = {'manifest.json', 'system.json', 'LICENSE.md', 'NOTICE.md', 'README.md',
             'README.pt-BR.md', 'CONTENT_POLICY.md', 'AUTOMATION.md'}
EXCLUDED = {'.git', 'dist', 'tests', 'scripts', 'server', 'node_modules', '__pycache__', '.venv'}
read = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))


def checked(path, root):
    for candidate in (path, *path.parents):
        if candidate == root:
            break
        if candidate.is_symlink() or candidate.is_junction():
            raise ValueError(f'Package files cannot be links: {path.relative_to(root)}')
    if not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f'Package file is missing or outside its source: {path}')
    return path


def browser_files(root=ROOT):
    selected = []
    for path in root.iterdir():
        if path.name in RUNTIME:
            if path.is_symlink() or path.is_junction():
                raise ValueError(f'Package directories cannot be links: {path.name}')
            selected.extend(p for p in path.rglob('*') if p.is_file())
        elif path.is_file() and (path.suffix in {'.js', '.css'} or path.name in ROOT_DATA):
            selected.append(path)
    return {p.relative_to(root).as_posix(): checked(p, root) for p in sorted(selected)
            if p.suffix in SUFFIXES and not any(part in EXCLUDED or part.startswith('.')
                                               for part in p.relative_to(root).parts)}


def write_archive(target, files, stamp):
    if not files or len({name.casefold() for name in files}) != len(files):
        raise ValueError('Empty package or duplicate paths')
    descriptor, temporary_name = tempfile.mkstemp(prefix='.package-', suffix='.zip', dir=target.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, path in sorted(files.items()):
                info = zipfile.ZipInfo(name, stamp)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError('Package CRC verification failed')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(f'{digest}  {target.name}\n', encoding='utf-8', newline='\n')
    return {'archive': target.name, 'bytes': target.stat().st_size, 'sha256': digest, 'files': len(files)}


def build(root=ROOT):
    root = Path(root).resolve()
    manifest, package = read(root / 'manifest.json'), read(root / 'package.json')
    version = manifest['version']
    if manifest['id'] != 'gravewright.5e-srd':
        raise ValueError('Package identifiers must retain campaign compatibility')
    if version != package['version'] or len(version.split('.')) != 3 or not all(p.isdigit() for p in version.split('.')):
        raise ValueError('Manifest and package must use the same numeric release version')
    if 'django' in manifest or manifest['system']['combat'].get('requiresProvider') is not False:
        raise ValueError('The system must run in the browser on the released VTT 0.2.3 without a server provider')
    data = {
        'schemas': {p.name.removesuffix('.schema.json'): read(p) for p in sorted((root / 'schemas').glob('*.json'))},
        'layouts': {p.relative_to(root / 'layouts').as_posix().removesuffix('.sheet.gw.json'): read(p) for p in sorted((root / 'layouts').rglob('*.json'))},
        'locales': load_locales(root / 'locales'),
        'actions': read(root / 'rules/actions.gw.json')['actions'],
    }
    (root / 'system.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    moment = datetime.fromtimestamp(int(os.environ.get('SOURCE_DATE_EPOCH', '1791849600')), timezone.utc)
    if not 1980 <= moment.year <= 2107:
        raise ValueError('SOURCE_DATE_EPOCH is outside the ZIP timestamp range')
    output = root / 'dist'
    output.mkdir(exist_ok=True)
    return [write_archive(output / f'gravewright-5e-srd-{version}.zip', browser_files(root), moment.timetuple()[:6])]


if __name__ == '__main__':
    for report in build():
        print(json.dumps(report))
