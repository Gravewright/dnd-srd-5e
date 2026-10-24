# DnD 5e SRD

A fifth-edition game system for Gravewright VTT, with selectable **2014 / SRD 5.1** and **2024 / SRD 5.2.1** rules. **0.1.6 Alpha**.

[Português brasileiro](README.pt-BR.md) · [Download 0.1.6](https://github.com/Gravewright/dnd-srd-5e/releases/tag/v0.1.6) · [Release notes](docs/releases/0.1.6.md) · [Report an issue](https://github.com/Gravewright/dnd-srd-5e/issues)

The Noturno sheet brings a dark background, ivory typography, gold frames and an illustrated character header. Character, monster and item sheets use native Gravewright windows, automatic saving and chat rolls. The system includes licensed, edition-separated SRD compendiums and declarative automation for supported rules.

This is an independent project, not affiliated with or endorsed by Wizards of the Coast or Foundry VTT. It does not include official artwork, rulebooks or premium content. The software adapts the user-supplied Gravewright 5e SRD legacy framework; its current public name is **DnD 5e SRD**.

## Requirements

| Component | Required version | Purpose |
| --- | --- | --- |
| [Gravewright VTT](https://github.com/Gravewright/gravewright/releases/tag/v0.2.3) | **Released 0.2.3**, SDK 1.x | Native documents, compendiums, dice, combat and modals |
| **DnD 5e SRD** | **0.1.6 Alpha** | One browser system with sheets, licensed content and automation |
| [Official Translator](https://github.com/Gravewright/translator) | **0.1.2 or newer** for localized use | English, Brazilian Portuguese and Spanish through the official API |

English is the default without an active language package. The system runs on
the published VTT 0.2.3 without a core patch or a separately installed rules module.

## Install and choose an edition

1. As host owner, download
   [`gravewright-5e-srd-0.1.6.zip`](https://github.com/Gravewright/dnd-srd-5e/releases/download/v0.1.6/gravewright-5e-srd-0.1.6.zip)
   from the GitHub release and install it through the running host's native
   local system installer. The Marketplace version may differ until its catalog
   is updated.
2. Create a table using **DnD 5e SRD**. Existing tables can select the new exact
   package version in **Settings → Extensions**.
3. The GM chooses the default edition for new sheets in **Settings → Extensions
   → Customize**. Each sheet retains **2014 / SRD 5.1** or **2024 / SRD 5.2.1**.
4. For Portuguese or Spanish, install and activate the official Translator and
   choose your account language. Grant compendium read access through native
   permissions when players need it.

One system ZIP contains character, monster and item sheets, compendiums,
translations, settings, initiative and supported turn automation. Its SHA-256
sidecar accompanies the download. Install through the VTT; do not extract the ZIP
into the VTT source tree. The stable system ID `gravewright.5e-srd` preserves
existing character data, table settings and embedded copies.

Version 0.1.6 installs alongside earlier releases, including local builds
0.1.3–0.1.5. Select 0.1.6 in the table's extensions and reload open table pages
to load the correction; restarting the host alone does not change that
selection. Keep the previous version installed for rollback by selecting it
again. Installed ID/version pairs are immutable and cannot be overwritten with
different bytes.

Confirm that the selected package's scripts load successfully in the browser.
Installing through the running host gives its server process access to the
extracted files; copying a source folder or restarting alone does not validate
the installed assets. Combatant three-dot menus stay within the viewport and
scroll internally when needed, including on the last row of a short tracker.
They remain open when the browser finishes scrolling the selected row into
view. Use arrow keys, Home or End to navigate, and Escape to close and return
focus to the button. Clicking outside, scrolling again or resizing closes the
menu.

Actor and token sheets initially open at up to 1000 × 760px and adapt to the
viewport. Native manual resizing remains available. If a previous larger window
size was saved, use **Reset window layout (↺)** in its title bar to apply the new
default. The overview uses a shorter banner, compact ability and combat cards,
and life controls arranged beside their related values. Visible text stays at
least 12px; long content remains scrollable.

Skills appear alphabetically by their translated name in character and monster
sheets. The attribute selector in each row saves that skill's default ability.
The skill roll window can choose another ability for that roll alone, retaining
proficiency, expertise and applicable effects. Existing sheets keep the standard
ability until a selection is saved. Roll windows open at the height their
controls require, with compact field groups and scrolling on smaller screens.

Item editors use a smaller header, unframed detail groups and compact text fields
that grow with authored content. Empty reading sidebars disappear. Item lists
sort names within their existing type or spell-level groups, using the active
language; stored collection order and item copies are preserved. Native item
windows keep resizing and the title-bar reset control. The host owns the shared
item directory and compendium browser presentation.

Before disabling an old companion, select **DnD 0.1.1 or newer in every DnD table** that
uses it; older system versions still require that server module.
If the old Server Rules companion is installed, **Customize → Previous installation**
allows the host owner to review and disable it using existing VTT management
controls. That historical deactivation restarts the host. Removing the old module
requires a separate confirmation after reviewing affected tables. A fresh 0.1.1-or-newer
installation has no server-code activation step.

## Play

- **Character and monster sheets:** responsive Noturno layout with overview, spells, inventory, biography and effects; configurable header cropping; native token resources and upload controls.
- **Ability and skill rolls:** derived modifiers, saving-throw proficiency in ability cards, expertise, passive values, advantage/disadvantage, extra modifiers and public or GM visibility. Results go directly to native chat.
- **Combat and resources:** armor and shield calculations, declared unarmored defense, HP and temporary HP, death and concentration handling, initiative and supported turn effects. Equipped/attuned requirements gate recognized item passives.
- **Short and long rests:** edition-specific recovery of HP, Hit Dice, spell slots, Pact Magic and explicitly configured resources. Short-rest healing remains a preview until confirmed; canceling discards it.
- **Drag and drop:** drag compendium entries or library items into the sheet. Supported types go to their corresponding collection, with source edition and provenance preserved. Origins and classes request required advancement choices before applying a plan.
- **Origins and advancement:** declared ability increases, skills, languages, size, movement, senses, traits, feature/spell grants, starting equipment, class/subclass progression, level HP and multiclass/Pact spell slots. A contribution ledger avoids duplicate grants and preserves supported manual changes.
- **Items and spells:** native item editor; all eleven item types; inventory, quantities, weight, coins, uses, spell preparation and spell slots. Typed formulas preserve supported spellcasting modifiers and explicit character/slot scaling.
- **Automatic saving:** revision-controlled writes, visible errors and retry, with pending changes flushed before closing. Independent tokens retain independent sheet data.
- **Localization:** English, Brazilian Portuguese and Spanish interface through Translator's module-scoped catalogs. User-authored names, descriptions and English SRD content are preserved.

All current rules run from this package, including `rules.js`, `combat-rules.js` and `combat-controller.js`. The VTT core provides generic permissions, documents, dice, persistence and combat contracts. It contains no D&D rules or content.

## Content and automation boundaries

The native compendiums include **2,535 entries**: **1,259** for 2014 and **1,276** for 2024, across twenty packs. They cover weapons, armor, equipment, consumables, spells, feats, features/subclasses, races/species, backgrounds and classes, with **319** and **338** spells respectively. These are **partial collections**, including variants, rather than a complete SRD.

Content remains in English. There are no monster compendiums or ready-made effect packs. The monster sheet is available for your own documents. No official artwork, logos, books, PDFs, premium packs, Foundry runtime or Foundry translations are redistributed. Legacy files under `content/` are not registered as compendiums.

Entries derive from licensed public structured data, checked against the official SRD PDFs. Spell descriptions come from the PDFs; other descriptions are converted to plain text. Source editions, paths and digests are retained. See [compendium coverage and provenance](compendiums/README.md), [NOTICE.md](NOTICE.md) and [CONTENT_POLICY.md](CONTENT_POLICY.md).

Importing a description does not automate every rule in it. The system applies recognized declarative data. Weapon Mastery, map targeting and areas, spell targets' saving throws, ammunition, occupied hands, material costs, contextual triggers, unsupported prerequisites and unrepresented exceptions still require table decisions. Informational durations do not expire automatically without explicit clocks. The Portuguese [automation reference](AUTOMATION.md) details implemented behavior, edition differences and manual boundaries.

Changing a sheet's edition does not convert imported classes, items, spell text or formulas. Items from either edition may coexist while preserving their source edition. There is no automatic campaign migration from the legacy framework.

## Update and troubleshoot

Preserve your VTT database, media and configuration when updating the system.
Reload open table pages after selecting the new package version. Compendium
updates never overwrite independent copies already embedded in character sheets.

The GM advances turns using the package combat tracker. After every completed
**Roll all initiatives**, active combat selects the first participant in the
server's final initiative order. This includes hidden or defeated participants;
ties retain the server's existing order. Individual, NPC-only and missing-only
initiative rolls preserve the current participant. Rolling before combat starts
does not start it. Selecting the first participant keeps the current round and
does not advance effect clocks.

Progress messages such as **Rolling initiatives…** and **Advancing turn…**
describe normal work; the retry action stays hidden while local work runs. A
shared operation marker alone does not indicate failure. The warning about an
incomplete operation is reserved for failed operations, with recovery available
to the responsible GM when work can resume. The tracker's operation journal,
native document revisions and receipts reuse each step's UUID on retry, so
interrupted work resumes without repeating completed rolls or turn selection.
Different sheets are recoverable writes, not one shared database transaction.
Moving backward does not undo resolved outcomes.
Automation does not run in the background after all table clients close.

| Symptom | Check |
| --- | --- |
| Compendiums are missing | The table uses an installed active system version and the GM has granted player read access |
| Previous server module detected | The host owner can open Previous installation in Customize and review migration |
| Interface stays English | Activate Translator, choose your account language and reload; SRD content stays English |
| Interrupted combat operation | Restore connectivity and use the tracker's retry action before issuing another advance |
| Save fails | Keep the sheet open and resolve the visible error before closing or reloading |

For [issue reports](https://github.com/Gravewright/dnd-srd-5e/issues), include VTT,
system and Translator versions, rules edition and reproduction steps. Remove
secrets and personal information from logs.

## Develop and package

Use **Node.js 22+** and **Python 3.12+** for build tools. Native host integration
requires the **Python 3.14+** environment of a separate unchanged VTT **0.2.3**
checkout. There are no npm dependencies.

```powershell
git clone --branch v0.2.3 --depth 1 https://github.com/Gravewright/gravewright.git ../gravewright
$env:GRAVEWRIGHT_TEST_HOST_ROOT = (Resolve-Path ../gravewright).Path
uv sync --project "$env:GRAVEWRIGHT_TEST_HOST_ROOT" --locked
python scripts/validate_locales.py
python scripts/build.py
python scripts/validate_package.py
npm test
& "$env:GRAVEWRIGHT_TEST_HOST_ROOT\.venv\Scripts\python.exe" -X utf8 tests/run_host_tests.py
```

Use an existing checkout if available. On POSIX, export the same host variable
and use that host's `.venv/bin/python`. JavaScript integration imports the actual
host translation adapter; no host code is bundled.

Build regenerates `system.json` from schemas, layouts, locales and actions and
writes **one browser system ZIP** plus its checksum under `dist/`. It excludes
Python, tools, tests, fixtures and the historical `server/` source. ZIP timestamps
use `SOURCE_DATE_EPOCH`, defaulting to `1791849600`, so identical source bytes
produce the same archive. Validation checks compiled data, bytes, licenses and
the unchanged content provenance offline.

Optional converter tests need the pinned licensed source cache documented in
[compendiums/README.md](compendiums/README.md). Those downloads are unnecessary
for ordinary rules, native-host tests and packaging. Historical Python reference
checks are documented in [server/README.md](server/README.md) and are not the
current system runtime.

`tests/e2e/review_server.py` creates disposable browser fixtures with isolated
databases, media, modules and synthetic accounts. Older E2E scripts expect their
documented review seed and local URL; never point them at a production table.

## Licenses

Original software is [MIT-licensed](LICENSE.md). SRD-derived content is **CC BY 4.0**, with required attribution and modification notices in [NOTICE.md](NOTICE.md). Adapted Foundry structured data retains the [upstream MIT representation notice](compendiums/FOUNDRY-DATA-LICENSE.txt). These software licenses do not grant rights to third-party brands or artwork. The decorative banner was created originally for Gravewright with AI assistance; no Wizards or Foundry artwork is included.
