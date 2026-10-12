"""Fetch pinned SRD YAML sources only; artwork and executable code are excluded.

Development-only: requires network access and PyYAML for the subsequent converter.
The source cache is deliberately outside the distributable system directory.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha1, sha256
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
from dev_paths import srd_cache

COMMIT = "87e94dbd9f930135e0694cd7e7d49f210603cd2c"
PACKS = {
    "spells", "spells24", "items", "equipment24", "classes", "subclasses",
    "classfeatures", "backgrounds", "races", "classes24", "origins24", "feats24",
}
CACHE = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else srd_cache()
CACHE.mkdir(parents=True, exist_ok=True)

def download(url, limit=2 * 1024 * 1024):
    request = Request(url, headers={"User-Agent": "Gravewright-SRD-content-adapter"})
    with urlopen(request, timeout=45) as response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('Source download exceeds its byte quota')
        return raw

tree_file = CACHE / "tree.json"
if not tree_file.exists():
    tree_file.write_bytes(download(f"https://api.github.com/repos/foundryvtt/dnd5e/git/trees/{COMMIT}?recursive=1"))
tree = json.loads(tree_file.read_text(encoding="utf-8"))
assert tree["sha"] == COMMIT and not tree.get("truncated")
rows = [row for row in tree["tree"] if row["type"] == "blob"
        and row["path"].startswith("packs/_source/")
        and row["path"].split("/")[2] in PACKS
        and row["path"].endswith(".yml") and not row["path"].endswith("/_folder.yml")]

def fetch(row):
    destination = CACHE / COMMIT / row["path"]
    raw = destination.read_bytes() if destination.is_file() else None
    for attempt in range(4):
        if raw is None:
            try:
                raw = download(f"https://raw.githubusercontent.com/foundryvtt/dnd5e/{COMMIT}/{row['path']}")
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt + 1)
                continue
        if len(raw) > 2 * 1024 * 1024 or sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() != row["sha"]:
            raise ValueError(f"Source digest mismatch: {row['path']}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            destination.write_bytes(raw)
        return row["path"]
    raise RuntimeError(row["path"])

failures = []
with ThreadPoolExecutor(max_workers=16) as pool:
    futures = {pool.submit(fetch, row): row for row in rows}
    for index, future in enumerate(as_completed(futures), 1):
        try:
            future.result()
        except Exception as exc:
            failures.append({"path": futures[future]["path"], "error": str(exc)})
        if index % 200 == 0:
            print(f"{index}/{len(rows)} source files; failures={len(failures)}", flush=True)
(CACHE / "fetch-result.json").write_text(json.dumps({"commit": COMMIT, "files": len(rows), "failures": failures}, indent=2), encoding="utf-8")
print(json.dumps({"commit": COMMIT, "files": len(rows), "failures": len(failures)}))
if failures:
    raise SystemExit(1)

pdfs = {
    '2014':('https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf','2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0'),
    '2024':('https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf','8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87'),
}
for edition, (url, digest) in pdfs.items():
    destination = CACHE / (edition + '.pdf')
    raw = destination.read_bytes() if destination.exists() else download(url, 25 * 1024 * 1024)
    if sha256(raw).hexdigest() != digest:
        raise ValueError('Official PDF digest mismatch: ' + edition)
    if not destination.exists():
        destination.write_bytes(raw)
print('Official SRD PDF digests verified; PDFs remain in the development cache.')
