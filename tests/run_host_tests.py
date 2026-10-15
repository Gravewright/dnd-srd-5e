"""Check the browser package against an unchanged released Gravewright 0.2.3."""
import json
import os
from pathlib import Path
import sys
import tempfile
import tomllib


def main():
    source = Path(__file__).resolve().parents[1]
    host = Path(os.environ.get('GRAVEWRIGHT_TEST_HOST_ROOT') or source.parents[2]).resolve()
    if not (host / 'manage.py').is_file():
        raise RuntimeError('Set GRAVEWRIGHT_TEST_HOST_ROOT to the released Gravewright 0.2.3 checkout.')
    host_version = tomllib.loads((host / 'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    if host_version != '0.2.3':
        raise RuntimeError(f'This compatibility suite requires the released VTT 0.2.3; received {host_version}.')
    version = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))['version']
    archive = source / 'dist' / f'gravewright-5e-srd-{version}.zip'
    if not archive.is_file():
        raise RuntimeError('Build the system ZIP with python scripts/build.py first.')
    sys.path[:0] = [str(host), str(source / 'tests')]
    with tempfile.TemporaryDirectory(prefix='sh-') as directory:
        isolated = Path(directory)
        os.environ.update({
            'PYTHON_DOTENV_DISABLED': '1', 'DJANGO_SETTINGS_MODULE': 'config.settings',
            'DJANGO_DEBUG': 'true', 'DJANGO_ALLOWED_HOSTS': '127.0.0.1,localhost,testserver',
            'DJANGO_SECURE_COOKIES': 'false', 'GRAVEWRIGHT_PUBLIC_ORIGIN': '',
            'GRAVEWRIGHT_DATABASE': ':memory:', 'GRAVEWRIGHT_MEDIA_ROOT': str(isolated / 'media'),
            'GRAVEWRIGHT_MODULES_ROOT': str(isolated / 'modules'),
            'GRAVEWRIGHT_CONTENT_ROOT': str(isolated / 'content'),
            'GRAVEWRIGHT_DJANGO_REGISTRY': str(isolated / 'modules' / 'server-apps.json'),
            'GRAVEWRIGHT_SERVER_APPS': '', 'GRAVEWRIGHT_SERVER_APP_PATHS': '',
            'GRAVEWRIGHT_MARKETPLACE_URL': '', 'GRAVEWRIGHT_MARKETPLACE_KEYS_FILE': '',
            'GRAVEWRIGHT_REDIS_URL': '', 'GRAVEWRIGHT_RELEASES_REPOSITORY': '', 'TRUSTED_PROXIES': '',
            'DND_TEST_ARCHIVE': str(archive),
        })
        import django
        django.setup()
        from django.conf import settings
        from django.test.runner import DiscoverRunner
        settings.DATABASES['default']['TEST']['NAME'] = ':memory:'
        assert settings.DATABASES['default']['NAME'] == ':memory:'
        assert settings.DATABASES['default']['TEST']['NAME'] == ':memory:'
        assert Path(settings.MEDIA_ROOT).is_relative_to(isolated)
        assert Path(settings.GRAVEWRIGHT_MODULES_ROOT).is_relative_to(isolated)
        print('Original VTT 0.2.3; browser-only system ZIP; memory databases; isolated media/modules; .env disabled')
        return DiscoverRunner(verbosity=2).run_tests(['host_contract'])


if __name__ == '__main__':
    raise SystemExit(main())
