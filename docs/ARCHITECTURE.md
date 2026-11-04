# Architecture

The pipeline follows the owner's TAM scan reference: guards, hypothesis, parallel source lanes, per-page cleaning and judgment, live map, then background completion. It does not distribute the reference image or any client dataset.

## Scan contract

`startScan()` accepts a versioned hypothesis, independent async source adapters, a judge callback, and a persistence callback. Each page is processed as it arrives. It returns `initial`, a promise for a bounded-time snapshot, and `completion`, a promise for the finished scan. A production worker must persist job and page checkpoints; an in-process promise alone cannot survive a restart.

The hypothesis contains region, vertical, ICP profiles, exclusions, and optional company seeds. A source adapter yields pages of candidates with source IDs. Registry and directory rows are source claims. Model recall can suggest names, but a registry or official source must confirm them before they enter a qualified account set.

A source can provide `sampleGate(rows, hypothesis)` to inspect its first page before that page is committed. Returning `false` or `{ accept: false, reason }` marks the lane `skipped`. `maxPages` caps how many pages the lane commits. These are deterministic controls; a production adapter must also enforce provider request budgets and rate limits before making paid calls.

The pipeline uses an entity key containing normalized name, region, and entity type. A shared hospital-system domain alone cannot collapse separate hospitals or clinical groups. When a source cannot establish the exact entity, the row stays in review.

## Evidence and stages

Each candidate has a status: `candidate`, `needs_review`, `qualified`, or `excluded`. Hard exclusions run before model judgment. A judge may qualify only when the candidate or judgment has a source URL for the specific claim. Unknown revenue, size, ownership, or operation remains unknown. Intent, people, and deep verification are background stages and never block the first candidate map.

The initial phase should have a budget in both time and money. Sources keep running after the time budget, so the map can grow in place. The production job store must enforce idempotent page claims, source request keys, budget reservations, leases, and resume after restarts. Provider concurrency is bounded per provider and adjusted to observed rate limits.

## Measurement

The recorder emits RunTune-compatible `event` JSONL with stage, provider, duration, cost, items in/out, and run ID. Account names and evidence text are absent from this telemetry. The analyzer reports stage wall time and summed provider time separately because parallel work makes their sum misleading. The trace should be joined to Helix's own run and spend ledgers by `run_id`.

Evaluate against prior accepted maps: time to first 50/250 candidates, candidate recall, verified precision on a reviewed sample, cost per qualified account, duplicate and unresolved rates, and coverage by source/segment/geography. Optimize the measured critical path before creating a specialist agent.
