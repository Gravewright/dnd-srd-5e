# Combat performance

[Português](performance.pt-BR.md)

## Native initiative batches

DnD 0.2.1 uses `typeof api.combat.rollInitiativeBatch === 'function'` to select
the optional VTT 0.3.8 capability for new initiative operations. DnD rules stay
in the package: it reads current sheets, resolves formulas, visibility and
actor/sheet/token revisions, and freezes that plan before submission. Linked
tokens sharing an actor reuse one sheet read during preparation only;
independent tokens retain separate data. At most four sheet reads run together.

One durable batch checkpoint replaces per-participant roll/save checkpoints.
The host validates permissions and source revisions before rolling, commits
results and combat order atomically, and groups chat outcomes by public/GM
visibility. Hidden participants cannot become public through the client payload.
Twenty public rolls produce one chat message containing twenty results.
The host's chat quota still applies to messages actually created.

A lost response reuses the same prepared payload and UUID. A rejected revision
requires fresh combat, actor, token and sheet reads before a new plan and UUID.
The tracker retains ownership, pause, GM and Stop checks. Stopping does not undo
an already committed batch. Receipt replay returns current combat state.
The acknowledged private intent is retained and replaced by the next operation
using its revision.

Hosts 0.2.3 and 0.3.7 use the sequential path, as do journals started with an
older package. A pending native batch requires that capability to resume;
host downgrade never silently converts it into new individual rolls.
The native contract accepts at most 64 entries; oversized batches fail visibly
instead of partially rolling. Sheets are not cached across operations.

## Measurements in a real browser

Chromium, local SQLite, a GM and a player, and twenty participants with mixed
2014/2024 sheets and linked/independent tokens were used. Each formula has three
samples. Native measurements used the VTT 0.3.8 implementation and packaged DnD
runtime before its metadata was raised from 0.2.0 to 0.2.1; that version and
documentation update did not change the measured runtime behavior.

`fullFlowMilliseconds` starts at the browser's actual click event. It ends at
the later of the GM and player rendered frames containing the expected order
and chat results; the GM must also have released busy state and enabled the
roll button. All twenty result summaries are checked in both chat windows.
This includes HTTP, WebSocket delivery and rendering, not just server acceptance.

| Formula | Full-flow samples | Median | Interval between batches |
| --- | --- | ---: | ---: |
| `@init` | 842.6, 798.7, 781.0 ms | 798.7 ms | 10.1 s |
| `1d20 + @init` | 947.9, 924.7, 883.3 ms | 924.7 ms | 0.5 s |

Both runs had no browser errors or failed HTTP requests. Each batch produced
one public chat message. Batch HTTP calls took 25–51 ms; fresh reads of twenty
sheets occupied 342–396 ms. The random run observed 43, 39 and 39 module/storage
requests through GM completion, including event-driven reads and prior cleanup.
The remaining cost includes preparation and durable storage.

These are local results, not a subsecond guarantee for remote hosts, large
sheets or other machines. Three samples per formula cannot establish a reliable
tail-latency percentile. Turn advancement remains separate: its full-flow median
was 1,057 ms in the random run, without turn effects.

The earlier benchmark measured from the Playwright call until GM controls were
released, including automation waits. Preserve that metric when comparing old
reports; the new full-flow metric has no historical baseline:

| Operation, deterministic `@init` | Original package, VTT 0.3.7 | Optimized sequential path, VTT 0.3.7 | Native batch, VTT 0.3.8 |
| --- | ---: | ---: | ---: |
| Roll all initiatives | 13,360 ms | 7,605 ms | 941 ms |
| Advance without effects | 1,476 ms | 1,449 ms | 1,438 ms |

Sequential initiative improved by 43%; native batch then reduced that
measurement by a further 87.6%. Small turn differences do not establish a
material improvement. The sequential changes reduced combat reads from 66 to
24, actor-index reads from 23 to two, and observed tracker child-list mutations
from 143 to 11 per initiative operation.

## Sequential compatibility and interface updates

The sequential controller reads its starting state once and uses the revision
returned by each accepted command. It registers checkpoint names together and
avoids reads of checkpoints that cannot exist yet. Resumed operations still
read their checkpoints before replay. Formulas and private arguments stay in
user storage. Optional cleanup runs after controls are released.

Older hosts allow 20 chat/dice submissions per member in ten seconds. The
controller consults authorized history and paces rolls when the budget is
occupied. Waiting preserves UUIDs, supports disposal and rechecks ownership.
Other scenes, deleted messages or another client can consume unobserved quota.
Generic validation errors are never retried as if they were quota responses.
Until an accepted roll identifies the author, history counting is conservative;
afterwards it counts that author's messages and its own in-memory receipts.

The tracker consumes authorized projections, coalesces updates during commands
and preserves controls when the display is unchanged. Sheets share one actor
subscription per system instance, ignore unrelated revisions and serialize
reads. Token sheets revalidate independent data and permissions. Delayed reads
cannot replace newer local saves; editing defers refresh until safe.
Subscriptions and cached projections are released on disposal.

A separate Chromium probe used a synthetic 205 KB sheet, ten events in 100 ms
and an 80 ms read delay. Unrelated events fell from ten reads to zero; relevant
bursts fell from ten to three, with maximum concurrency reduced from nine to
one. This diagnoses request load, not every campaign's elapsed time.

## Reproduce

Build the package and run the browser scenario against a disposable host:

```sh
python scripts/build.py
python tests/e2e/combat_performance.py --host-root /path/to/gravewright \
  --archive dist/gravewright-5e-srd-0.2.1.zip --output /path/to/gravewright/data/perf-run \
  --browser-executable /path/to/chromium --participants 20 --repetitions 3 \
  --formula '1d20 + @init' --roll-interval 0.5
```

Each run uses synthetic accounts, a separate database and isolated installed
packages. Existing campaigns and `.env` are not used. Use a fresh output directory
and the same host/browser when comparing archives. JSON includes per-call timings,
counts, tracker mutations, click-to-frame timings and player validation.
The default formula is `@init` and the default interval is 10.1 seconds.
For legacy pacing, use more than twenty participants with `--roll-interval 0.5`.

The controller fixture isolates call sequencing with 10 ms per API/storage
call; it does not measure a real network, database or browser:

```sh
node tests/combat-performance.mjs legacy.json 3 10 legacy independent
node tests/combat-performance.mjs batch.json 3 10 batch independent
```

With twenty independent sheets, sequential changes reduced the median from
3,145 to 2,944, 2,784 and then 1,947 ms. Native batch preparation measured 272 ms;
removing redundant operation reads reduced it to 200 ms. Calls fell from 209
on the optimized sequential path to 38 with batch, and private SET payload bytes
from 71,827 to 12,433. These synthetic values explain request reduction only.

Correctness tests cover interrupted rolls, lost checkpoint/batch replies,
revision conflicts, concurrent GMs, Stop, pause, old journals, host downgrade,
token-specific data, permissions, disposal and stale sheet responses.
