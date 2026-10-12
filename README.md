# DnD 5e SRD

A fifth-edition game system for Gravewright VTT, with selectable **2014 / SRD 5.1** and **2024 / SRD 5.2.1** rules. First release: **0.1.0 Alpha**.

[Português brasileiro](README.pt-BR.md) · [Download 0.1.0](https://github.com/Gravewright/dnd-srd-5e/releases/tag/v0.1.0) · [Release notes](docs/releases/0.1.0.md) · [Report an issue](https://github.com/Gravewright/dnd-srd-5e/issues)

The Noturno sheet brings a dark background, ivory typography, gold frames and an illustrated character header. Character, monster and item sheets use native Gravewright windows, automatic saving and chat rolls. The system includes licensed, edition-separated SRD compendiums and declarative automation for supported rules.

This is an independent project, not affiliated with or endorsed by Wizards of the Coast or Foundry VTT. It does not include official artwork, rulebooks or premium content. The software adapts the user-supplied Gravewright 5e SRD legacy framework; its current public name is **DnD 5e SRD**.

## Requirements

| Component | Required version | Purpose |
| --- | --- | --- |
| [Gravewright VTT](https://github.com/Gravewright/gravewright/releases/tag/v0.2.1) | **0.2.1 or newer**, SDK 1.x | Native sheets, compendiums, modal lifecycle and generic server providers |
| **DnD 5e SRD** | **0.1.0** | Browser system and licensed content |
| **DnD 5e SRD - Server Rules** | **0.1.0** | Trusted Django companion for initiative and turn automation |
| [Official Translator](https://github.com/Gravewright/translator) | **0.1.2 or newer** for localized use | English, Brazilian Portuguese and Spanish interface through the official API |

English is the fallback without an active language package. VTT 0.2.0 lacks contracts required by this system. The SDK requirement remains `>=1.0.0 <2.0.0`; that range alone does not express the minimum VTT release.

## Install and choose an edition

1. In the official Marketplace, install **DnD 5e SRD** under **Systems**. Alternatively, download `gravewright-5e-srd-0.1.0.zip` from the release and install it as a local system package.
2. As the host owner, install **DnD 5e SRD - Server Rules** under **Modules**, or use `gravewright-5e-srd-server-0.1.0.zip`. Explicitly enable its trusted Django extension and complete the managed Runner restart. This package executes system-owned Python code; installing browser JavaScript does not enable it. See [the companion documentation](server/README.md).
3. Install and activate the official Translator for Portuguese or Spanish. Create a table using **DnD 5e SRD** and enable Translator in that table's extensions.
4. The GM chooses the default edition for new sheets in **Settings → Extensions → Customize**. Each sheet retains its own explicit edition: **2014 / SRD 5.1** or **2024 / SRD 5.2.1**.
5. Set each player's language in their account preferences. Grant compendium read access through the native permissions when players need it.

The release provides SHA-256 files beside both ZIPs. Verify the checksum before local installation. Do not extract either ZIP into the VTT source tree; use the native package installer.

Technical IDs (`gravewright.5e-srd`, `gravewright.5e-srd-server`) and ZIP basenames remain stable. Existing installations and documents retain their identity after the display-name change. System and companion version **0.1.0** are independent of VTT version **0.2.1**.

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

The browser implementation lives in this repository, including `rules.js`; server rules live in `server/gravewright_5e/`. The VTT core provides generic permissions, documents, persistence, transactions and provider contracts. It contains no D&D rules or content.

## Content and automation boundaries

The native compendiums include **2,535 entries**: **1,259** for 2014 and **1,276** for 2024, across twenty packs. They cover weapons, armor, equipment, consumables, spells, feats, features/subclasses, races/species, backgrounds and classes, with **319** and **338** spells respectively. These are **partial collections**, including variants, rather than a complete SRD.

Content remains in English. There are no monster compendiums or ready-made effect packs. The monster sheet is available for your own documents. No official artwork, logos, books, PDFs, premium packs, Foundry runtime or Foundry translations are redistributed. Legacy files under `content/` are not registered as compendiums.

Entries derive from licensed public structured data, checked against the official SRD PDFs. Spell descriptions come from the PDFs; other descriptions are converted to plain text. Source editions, paths and digests are retained. See [compendium coverage and provenance](compendiums/README.md), [NOTICE.md](NOTICE.md) and [CONTENT_POLICY.md](CONTENT_POLICY.md).

Importing a description does not automate every rule in it. The system applies recognized declarative data. Weapon Mastery, map targeting and areas, spell targets' saving throws, ammunition, occupied hands, material costs, contextual triggers, unsupported prerequisites and unrepresented exceptions still require table decisions. Informational durations do not expire automatically without explicit clocks. The Portuguese [automation reference](AUTOMATION.md) details implemented behavior, edition differences and manual boundaries.

Changing a sheet's edition does not convert imported classes, items, spell text or formulas. Items from either edition may coexist while preserving their source edition. There is no automatic campaign migration from the legacy framework.

## Update and troubleshoot

Back up the VTT database, media and configuration before updating. Update the browser system and server companion together, confirm server-code activation, and reload open pages. Updating a compendium does not overwrite independent copies already embedded in character sheets.

| Symptom | Check |
| --- | --- |
| Missing compendiums | The table uses the approved, active system version; the GM has granted players read permission |
| Initiative or effects report a missing provider | The host owner installed/enabled the companion and the Runner restart completed |
| Interface stays in English | Translator is active for the table, the account language is selected, and the page was reloaded |
| SRD item descriptions remain English | Expected: interface localization does not translate game content in 0.1.0 |
| An equipment bonus is absent | Equipment/attunement state, armor mode, sheet edition and supported declarative metadata |
| Save fails | Keep the sheet open, restore connectivity and retry; resolve the visible error before reloading |

For [issue reports](https://github.com/Gravewright/dnd-srd-5e/issues), include VTT, system, companion and Translator versions; the rules edition; and reproduction steps. Remove secrets and personal information from logs.

## Develop and package

Run from this repository's root with **Node.js 22+**. The standard-library build and package validation tools require **Python 3.12+**. A separate **VTT 0.2.1+ checkout** is required by the JavaScript integration tests as well as the backend suite; the VTT backend requires **Python 3.14+** and its own dependencies. No npm dependencies are needed.

For example, in PowerShell, prepare a sibling host checkout and its Python environment, then run this system's tests and build:

```powershell
git clone --branch v0.2.1 --depth 1 https://github.com/Gravewright/gravewright.git ../gravewright
$env:GRAVEWRIGHT_TEST_HOST_ROOT = (Resolve-Path ../gravewright).Path
uv sync --project "$env:GRAVEWRIGHT_TEST_HOST_ROOT" --locked
npm test
& "$env:GRAVEWRIGHT_TEST_HOST_ROOT\.venv\Scripts\python.exe" -X utf8 server/run_tests.py
python scripts/validate_locales.py
python scripts/build.py
python scripts/validate_package.py
```

Reuse an existing compatible host checkout instead of cloning if one is available. On POSIX shells, use `export GRAVEWRIGHT_TEST_HOST_ROOT=/path/to/gravewright` before `npm test`, and use that host's `.venv/bin/python` for `server/run_tests.py`. The integration tests import the real host API; `npm test` is not independent of the host source.

The build validates catalogs and generates `system.json` from the authoring schemas, layouts, locales and actions. Do not edit that generated file directly. `dist/` receives separate browser/server ZIPs and their SHA-256 files; development scripts and tests are excluded. ZIP timestamps use `SOURCE_DATE_EPOCH`, defaulting to `1791849600`, so unchanged sources produce deterministic artifacts. `validate_package.py` then checks the generated archives, compiled system data and content provenance offline.

See [server/README.md](server/README.md) for backend setup. Optional source-conversion tests additionally require the pinned licensed source cache; [compendiums/README.md](compendiums/README.md) documents rebuilding and the `GRAVEWRIGHT_SRD_CACHE` / `GRAVEWRIGHT_SRD_TOOLS` overrides. These source downloads are unnecessary for the ordinary JavaScript/backend tests and package build.

End-to-end scripts under `tests/e2e/` require an already prepared disposable VTT fixture and Playwright. They do not provision or protect a production instance. Inspect each script's fixture expectations and set `GRAVEWRIGHT_REVIEW_URL` before using them.

## Licenses

Original software is [MIT-licensed](LICENSE.md). SRD-derived content is **CC BY 4.0**, with required attribution and modification notices in [NOTICE.md](NOTICE.md). Adapted Foundry structured data retains the [upstream MIT representation notice](compendiums/FOUNDRY-DATA-LICENSE.txt). These software licenses do not grant rights to third-party brands or artwork. The decorative banner was created originally for Gravewright with AI assistance; no Wizards or Foundry artwork is included.
