"""Resolve optional host and development fixtures without a checkout layout."""
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
            raise SystemExit('GRAVEWRIGHT_TEST_HOST_ROOT must point to a Gravewright VTT source checkout (0.2.1 or newer).')
        return candidate
    for candidate in SYSTEM_ROOT.parents:
        if _is_host(candidate):
            return candidate
    if required:
        raise SystemExit('This integration test needs a Gravewright VTT source checkout (0.2.1 or newer). Set GRAVEWRIGHT_TEST_HOST_ROOT to its root; no host code is bundled in this system.')
    return None


def development_path(environment, name):
    configured = os.environ.get(environment)
    if configured:
        return Path(configured).expanduser().resolve()
    return (host_root() or SYSTEM_ROOT) / 'data' / name


def srd_cache():
    return development_path('GRAVEWRIGHT_SRD_CACHE', 'srd-compendium-cache')


def srd_tools():
    return development_path('GRAVEWRIGHT_SRD_TOOLS', 'srd-compendium-tools')


def require_srd_cache(commit):
    cache = srd_cache()
    if not (cache / commit / 'packs/_source').is_dir():
        raise SystemExit('The optional SRD converter tests need pinned source fixtures. Run python scripts/fetch_srd.py first, or set GRAVEWRIGHT_SRD_CACHE to an existing verified cache. These fixtures and official PDFs are not included in release ZIPs.')
    return cache
