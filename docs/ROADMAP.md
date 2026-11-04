# From the GRID scan to a production TAM job

TAMLoop's first release is a provider-neutral execution and measurement core. The owner's GRID process sets the production target. The table distinguishes what runs now from what a Helix adapter must add.

| GRID stage | TAMLoop 0.1 | Production work |
| --- | --- | --- |
| Start guards and hypothesis | Requires region, vertical, ICP profiles; accepts exclusions | Read approved wiki/dossier, version hypotheses, reject duplicate scans, preserve question warnings |
| Parallel Phase 1 | Concurrent page streams, first-page sample gate, page cap, time-bounded initial snapshot | Approved source planner, registry/search/model-recall/list adapters, request budgets, rate-limit queues |
| Each page | Cleaning, hard exclusions, entity key, evidence gate, incremental updates | Durable idempotent page commits, revenue bands, detailed ICP trait evidence, account exclusions |
| Background | Source lanes continue after initial snapshot | Revenue waterfall, missing-field verification, people, carried-over account recheck |
| Result | Candidate counts, source status, trace analysis | Live map and coverage, low/high TAM estimate, review workflow, separate later intent run |

## Delivery sequence

1. Replay synthetic and approved historical fixtures through the same adapters. Record first 50/250 candidate times, reviewed precision, unresolved rate, duplicates, source coverage, and cost. This creates a baseline before replacing Helix's live path.
2. Add durable jobs, source cursors, page keys, and budget reservations in Helix's existing Supabase Postgres. Run bounded workers and resume after crashes. Publish initial and incremental map snapshots.
3. Add approved live source adapters one at a time. Each adapter must preserve source IDs and URLs, supply stable pagination keys, report cost, and expose rate-limit behavior. Start with the fastest high-yield sources seen in the replay.
4. Add revenue and missing-field verification as independent background jobs. Add people and intent only after the account map is visible and the operator chooses them.
5. Run a parallel pilot against the current production path with a fixed spend cap. Review a stratified account sample and compare quality and speed; do not equate an unverified first map with a completed TAM.

RunTune is the optimization feedback reader. Its suggestions about repeated work or specialized agents should be reviewed against the recorded critical path and quality metrics before changing production routing.
