"""Validate authoring catalogs against Translator's host-adapter contract.

The adapter permits partial non-English catalogs; this system additionally
requires complete English, Brazilian Portuguese and Spanish catalogs at build
time. This module does not translate messages or run in the browser.
"""

import json
from pathlib import Path
import re


REQUIRED_LOCALES = ("en", "pt-BR", "es")
MAX_ENTRIES = 15_000
MAX_MESSAGE_LENGTH = 12_000
LOCALE_PATTERN = re.compile(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\Z")
PLACEHOLDER_PATTERN = re.compile(r"\{([A-Za-z_][A-Za-z0-9_.]*|\d+)\}")


def _length(value):
    # The browser validates String.length, measured in UTF-16 code units.
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _sample(keys):
    keys = sorted(keys)
    sample = ", ".join(repr(key) for key in keys[:8])
    return sample + (f", ... ({len(keys)} total)" if len(keys) > 8 else "")


def validate_locales(catalogs, *, required_locales=REQUIRED_LOCALES):
    """Raise an actionable ValueError before packaging any invalid catalog."""
    if not isinstance(catalogs, dict) or not isinstance(catalogs.get("en"), dict):
        raise ValueError("locales: an English object catalog (en.json) is required")
    missing_locales = set(required_locales) - catalogs.keys()
    if missing_locales:
        raise ValueError(f"locales: missing required catalogs: {_sample(missing_locales)}")
    english = catalogs["en"]
    total = 0
    for locale, messages in catalogs.items():
        if not isinstance(locale, str) or not LOCALE_PATTERN.fullmatch(locale):
            raise ValueError(f"locales: invalid locale ID {locale!r}")
        if not isinstance(messages, dict) or not messages:
            raise ValueError(f"locales/{locale}.json: expected a nonempty message object")
        for key, text in messages.items():
            location = f"locales/{locale}.json key {key!r}"
            if not isinstance(key, str) or not key.strip() or _length(key) > MAX_MESSAGE_LENGTH:
                raise ValueError(f"{location}: key must be nonblank text of at most {MAX_MESSAGE_LENGTH} characters")
            if not isinstance(text, str) or not text.strip() or _length(text) > MAX_MESSAGE_LENGTH:
                raise ValueError(f"{location}: translation must be nonblank text of at most {MAX_MESSAGE_LENGTH} characters")
            total += 1
            if total > MAX_ENTRIES:
                raise ValueError(f"locales: {total} entries exceed Translator's {MAX_ENTRIES}-entry registration limit")
            if key not in english or not isinstance(english[key], str):
                raise ValueError(f"{location}: key must also exist as text in en.json")
            expected = sorted(PLACEHOLDER_PATTERN.findall(english[key]))
            actual = sorted(PLACEHOLDER_PATTERN.findall(text))
            if expected != actual:
                raise ValueError(f"{location}: placeholders must match en.json, including repetitions; expected {expected!r}, got {actual!r}")
        if locale in required_locales:
            missing = english.keys() - messages.keys()
            if missing:
                raise ValueError(f"locales/{locale}.json: missing translations: {_sample(missing)}")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate message key {key!r}")
        result[key] = value
    return result


def load_locales(directory):
    """Load UTF-8 source catalogs and reject malformed JSON before build output."""
    catalogs = {}
    for path in sorted(Path(directory).glob("*.json")):
        try:
            catalogs[path.stem] = json.loads(
                path.read_text(encoding="utf-8-sig"), object_pairs_hook=_unique_object
            )
        except (ValueError, UnicodeError) as error:
            raise ValueError(f"{path}: {error}") from error
    validate_locales(catalogs)
    return catalogs


if __name__ == "__main__":
    import sys

    try:
        catalogs = load_locales(Path(__file__).resolve().parents[1] / "locales")
    except ValueError as error:
        raise SystemExit(f"Locale validation failed: {error}") from error
    print(f"Validated {len(catalogs)} catalogs / {sum(map(len, catalogs.values()))} messages")
