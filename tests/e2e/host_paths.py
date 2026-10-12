"""Shared locations for tests against an explicitly disposable VTT host."""
import os
from pathlib import Path
import shutil
import sys


MODULE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(MODULE / 'scripts'))
from dev_paths import host_root

ROOT = host_root(required=True)


def node_executable():
    configured = os.environ.get('GRAVEWRIGHT_TEST_NODE')
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if not candidate.is_file():
            raise SystemExit('GRAVEWRIGHT_TEST_NODE must point to a Node.js executable.')
        return str(candidate)
    if found := shutil.which('node'):
        return found
    import playwright
    candidate = Path(playwright.__file__).resolve().parent / 'driver' / ('node.exe' if os.name == 'nt' else 'node')
    if candidate.is_file():
        return str(candidate)
    raise SystemExit('Install Node.js or set GRAVEWRIGHT_TEST_NODE for the offline compendium planner.')
