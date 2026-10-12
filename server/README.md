# DnD 5e SRD - Server Rules

Trusted server companion **0.1.0** for [DnD 5e SRD](https://github.com/Gravewright/dnd-srd-5e).
Requires **Gravewright VTT 0.2.1 or newer**, SDK 1.x, and browser system **0.1.0**.
The system and companion are separate installable packages; their stable IDs are
`gravewright.5e-srd` and `gravewright.5e-srd-server`.

This system-owned Django app contains the system's 2014/2024 initiative, damage,
healing, death, concentration, explicit expiry clocks and periodic effects.
The VTT provides encounter identity, permissions, linked/independent document
resolution, transactions, validation and persistence. No model writes occur in
the callbacks. Other systems cannot select these rules through a browser profile.

## Install

The host owner installs **DnD 5e SRD - Server Rules** from the official
Marketplace under **Modules**, or installs
`gravewright-5e-srd-server-0.1.0.zip` from the
[0.1.0 release](https://github.com/Gravewright/dnd-srd-5e/releases/tag/v0.1.0)
as a local package. Verify its companion SHA-256 file for local installation.
Explicitly approve and activate the Django extension, then complete the managed
Runner restart. Install the browser system under **Systems** as well.

Installing browser JavaScript alone does not execute Python or activate this app.
The companion's code runs on the host with server privileges; activation is an
operator action, separate from enabling browser modules in a table. Without it,
initiative and supported turn automation report an unavailable provider.

Back up the VTT database, media and configuration before changing packages.
Keep browser system and companion versions aligned. Reload pages after a restart.
If activation fails, inspect the Runner log and confirm the VTT minimum version,
the installed package's approval and the Django extension's active state.

## Source development

For source development, put this checkout's `server` directory on
`GRAVEWRIGHT_SERVER_APP_PATHS` and add
`gravewright_5e.apps.Gravewright5eConfig` to `GRAVEWRIGHT_SERVER_APPS` before
starting Django. The app registers only the `gravewright.5e-srd` system ID.

Run the isolated suite from this repository's root, with the **Python 3.14+**
environment and dependencies from a separate **VTT 0.2.1+** checkout. The
standalone build tools' Python 3.12 minimum does not apply to the VTT backend.
Set `GRAVEWRIGHT_TEST_HOST_ROOT` to that
checkout so the runner can import the VTT's settings and generic services:

```powershell
$env:GRAVEWRIGHT_TEST_HOST_ROOT = 'C:\src\gravewright'
& "$env:GRAVEWRIGHT_TEST_HOST_ROOT\.venv\Scripts\python.exe" -X utf8 server/run_tests.py
```

On POSIX shells:

```sh
GRAVEWRIGHT_TEST_HOST_ROOT=/path/to/gravewright /path/to/gravewright/.venv/bin/python server/run_tests.py
```

The runner explicitly enables this app, disables dotenv loading, uses temporary
database/media/module/content paths, and removes them after the run. It does not
read or change an existing campaign database, `.env`, or a running server.

## Provider behavior

`prepare_initiative(formula, data, *, conditions=())` returns a formula and a
private data copy. `advance_effects(data, event)` mutates only the supplied copy
and returns whether the host must persist it. Expiry needs explicit
`duration.expires: "start" | "end"`; informational durations remain manual.
Clocks use the source token first, then source actor, then owner, and share the
host's processed-clock set. Periodic HP runs only at the owner's turn start,
honors enabled/equipped/attuned gates, and applies each damage instance once
before temporary HP. Resistance, death and concentration rules are local to this
app. Generic math/path helpers are the only combat utilities imported from core.

Automation requires recognized metadata and explicit clocks. Arbitrary effect
prose, targeting, contextual rules and unsupported exceptions remain manual.
The complete source checkout documents these boundaries in
[AUTOMATION.md](https://github.com/Gravewright/dnd-srd-5e/blob/main/AUTOMATION.md).

## Licenses

Original companion software is MIT-licensed. SRD-derived rules material retains
CC BY 4.0 attribution in [NOTICE.md](NOTICE.md). This archive contains no
compendium collections, official artwork, Foundry runtime or premium content.
The independent project is not affiliated with or endorsed by Wizards of the
Coast or Foundry VTT.
