"""Run the opt-in backend against a temporary database without reading .env."""
import os
from pathlib import Path
import sys
import subprocess
from tempfile import TemporaryDirectory

if not sys.flags.utf8_mode:
    raise SystemExit(subprocess.run([
        sys.executable, '-X', 'utf8', str(Path(__file__).resolve()), *sys.argv[1:],
    ], check=False).returncode)


SERVER = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER.parent / 'scripts'))
from dev_paths import host_root
ROOT = host_root(required=True)
sys.path.insert(0, str(ROOT))
with TemporaryDirectory(prefix='gravewright-5e-tests-') as temporary:
    fixture = Path(temporary).resolve()
    os.environ.update(
        PYTHON_DOTENV_DISABLED='1', DJANGO_SETTINGS_MODULE='config.settings',
        GRAVEWRIGHT_DATABASE=str(fixture / 'review.sqlite3'),
        GRAVEWRIGHT_MEDIA_ROOT=str(fixture / 'media'),
        GRAVEWRIGHT_MODULES_ROOT=str(fixture / 'modules'),
        GRAVEWRIGHT_CONTENT_ROOT=str(fixture / 'content'),
        GRAVEWRIGHT_MARKETPLACE_KEYS_FILE='', GRAVEWRIGHT_CHANNEL_LAYER='memory',
        GRAVEWRIGHT_SERVER_APP_PATHS=str(SERVER),
        GRAVEWRIGHT_SERVER_APPS='gravewright_5e.apps.Gravewright5eConfig',
    )
    import django
    django.setup()
    from django.conf import settings
    from django.test.utils import get_runner
    assert Path(settings.DATABASES['default']['NAME']).resolve() == fixture / 'review.sqlite3'
    settings.DATABASES['default']['TEST']['NAME'] = str(fixture / 'test-review.sqlite3')
    result = get_runner(settings)(verbosity=1, interactive=False).run_tests(sys.argv[1:] or ['gravewright_5e'])
    raise SystemExit(bool(result))
