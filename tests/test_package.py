"""Exercise the distributed system archive without executing historical Python."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile


SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'scripts'))
from build import browser_files, build
from validate_package import validate


@contextmanager
def package_source():
    with tempfile.TemporaryDirectory(prefix='dp-') as temporary:
        root = Path(temporary)
        for name, source in browser_files(SOURCE).items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        shutil.copyfile(SOURCE / 'package.json', root / 'package.json')
        yield root


def rewrite(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


class BrowserPackageTests(unittest.TestCase):
    def test_one_reproducible_archive_preserves_licensed_content(self):
        with package_source() as root:
            original = {name: hashlib.sha256(path.read_bytes()).hexdigest()
                        for name, path in browser_files(root).items()
                        if name.startswith(('compendiums/', 'content/', 'assets/'))
                        or name in {'NOTICE.md', 'LICENSE.md', 'CONTENT_POLICY.md'}}
            first = build(root)
            second = build(root)
            self.assertEqual(first, second)
            self.assertEqual(len(first), 1)
            result = validate(root)
            self.assertEqual(result['compendiums'], {
                '2014': {'packs': 10, 'documents': 1259},
                '2024': {'packs': 10, 'documents': 1276},
            })
            with zipfile.ZipFile(root / 'dist' / first[0]['archive']) as archive:
                names = archive.namelist()
                self.assertFalse(any(name.endswith(('.py', '.pyc', '.pyd')) for name in names))
                self.assertFalse(any(name.startswith(('server/', 'tests/', 'scripts/')) for name in names))
                for name, digest in original.items():
                    self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), digest, name)
                    self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), digest, name)

    def test_private_and_historical_files_are_not_distributed(self):
        with package_source() as root:
            private = ['.env', 'private-key.json', 'package.json', 'server/manifest.json',
                       'server/gravewright_5e/__init__.py', 'tests/result.json',
                       'assets/.private/token.json', 'locales/.env.json']
            for name in private:
                if name == 'package.json':
                    continue
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('private fixture', encoding='utf-8')
            names = browser_files(root)
            for name in private:
                self.assertNotIn(name, names)

    def test_server_provider_or_version_mismatch_cannot_be_built(self):
        for change in ('django', 'provider', 'version'):
            with self.subTest(change=change), package_source() as root:
                path = root / 'manifest.json'
                manifest = json.loads(path.read_text(encoding='utf-8'))
                if change == 'django':
                    manifest['django'] = {'apps': ['gravewright_5e']}
                elif change == 'provider':
                    manifest['system']['combat']['requiresProvider'] = True
                else:
                    manifest['version'] = '0.1.999'
                rewrite(path, manifest)
                with self.assertRaises(ValueError):
                    build(root)
                self.assertFalse((root / 'dist').exists())

    def test_checksum_and_source_bytes_are_verified(self):
        with package_source() as root:
            report = build(root)[0]
            archive = root / 'dist' / report['archive']
            sidecar = archive.with_suffix('.zip.sha256')
            expected = sidecar.read_bytes()
            sidecar.write_text('0' * 64 + f'  {archive.name}\n', encoding='ascii')
            with self.assertRaises(AssertionError):
                validate(root)
            sidecar.write_bytes(expected)
            (root / 'README.md').write_text('Changed after build.\n', encoding='utf-8')
            with self.assertRaises(AssertionError):
                validate(root)


if __name__ == '__main__':
    unittest.main()
