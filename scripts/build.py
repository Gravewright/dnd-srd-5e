"""Build deterministic browser and trusted-server packages without local fixtures."""
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
        elif path.is_file() and path.suffix in SUFFIXES and not path.name.startswith('.'):
            selected.append(path)
    return {p.relative_to(root).as_posix(): checked(p, root) for p in sorted(selected)
            if p.suffix in SUFFIXES and not any(part in EXCLUDED or part.startswith('.env')
                                               for part in p.relative_to(root).parts)}


def server_files(root=ROOT):
    server = root / 'server'
    result = {'LICENSE.md': checked(root / 'LICENSE.md', root),
              'NOTICE.md': checked(server / 'NOTICE.md', root)}
    for path in sorted(server.rglob('*')):
        relative = path.relative_to(server)
        if (path.is_file() and not any(part in EXCLUDED for part in relative.parts)
                and path.name not in {'tests.py', 'run_tests.py', 'NOTICE.md'}
                and path.suffix in {'.py', '.json', '.md', '.txt'}):
            result[relative.as_posix()] = checked(path, root)
    return result


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
    manifest, server = read(root / 'manifest.json'), read(root / 'server/manifest.json')
    version = manifest['version']
    if manifest['id'] != 'gravewright.5e-srd' or server['id'] != 'gravewright.5e-srd-server':
        raise ValueError('Package identifiers must retain campaign compatibility')
    if version != server['version'] or len(version.split('.')) != 3 or not all(p.isdigit() for p in version.split('.')):
        raise ValueError('Browser and server must use the same numeric release version')
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
    return [write_archive(output / f'{prefix}-{version}.zip', files, moment.timetuple()[:6])
            for prefix, files in [('gravewright-5e-srd', browser_files(root)), ('gravewright-5e-srd-server', server_files(root))]]


if __name__ == '__main__':
    for report in build():
        print(json.dumps(report))
