# Historical DnD 5e SRD server reference

This directory preserves the source of the earlier Server Rules companion for
regression comparisons and explicit migration fixtures. It is not installed,
activated or included in the current **0.1.1** system ZIP. The current system runs
its browser rules on the published **Gravewright VTT 0.2.3** without a core patch.

`combat-rules.js`, `combat-controller.js` and `tracker.js` own current initiative,
duration and periodic-effect automation. The GM operates the tracker. Native
permissions, revisions and retry receipts protect each persisted document;
different sheets are recoverable steps, rather than one cross-document
transaction. Automation does not run after every table client closes.

Existing installations of `gravewright.5e-srd-server` can be reviewed through
**Customize → Previous installation**. Only the host owner can authorize the old
module's deactivation and the existing host restart. Removal needs another
confirmation with the affected-table preview. Fresh installations only install
the browser system; there is no standalone server release asset or manifest.

Optional historical checks still use `server/run_tests.py`, with
`GRAVEWRIGHT_TEST_HOST_ROOT` pointing to a disposable VTT 0.2.3 checkout and that
host's Python environment. This explicitly loads archived source into a temporary
test process and never validates current browser automation. Current release
checks use `tests/run_host_tests.py`, JavaScript suites and native browser fixtures.

Original source remains MIT-licensed; licensed SRD rules retain CC BY 4.0
attribution in [NOTICE.md](../NOTICE.md). No new content, artwork or premium material
is added. See the current [installation guide](../README.md).
