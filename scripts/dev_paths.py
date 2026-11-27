"""Resolve an optional VTT host checkout for integration tests."""
import os
from pathlib import Path


SYSTEM_ROOT = Path(__file__).resolve().parents[1]


def _is_host(path):
    return (path / 'config/settings.py').is_file() and (path / 'gravewright/modules').is_dir()


def host_root(*, required=False):
    """Use an explicit VTT source checkout, or discover the legacy nested one."""
    configured = os.environ.get('GRAVEWRIGHT_TEST_HOST_ROOT')
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if not _is_host(candidate):
            raise SystemExit('GRAVEWRIGHT_TEST_HOST_ROOT must point to a Gravewright VTT source checkout (0.2.3 or newer).')
        return candidate
    for candidate in SYSTEM_ROOT.parents:
        if _is_host(candidate):
            return candidate
    if required:
        raise SystemExit('This integration test needs a Gravewright VTT source checkout (0.2.3 or newer). Set GRAVEWRIGHT_TEST_HOST_ROOT to its root; no host code is bundled in this system.')
    return None
