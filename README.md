# TAMLoop

TAMLoop is an open-source foundation for fast, evidence-first total addressable market scans. It combines a streaming account pipeline with [RunTune](https://github.com/kkrlstrm/runtune)-compatible telemetry. The first map can appear while source pulls and verification continue; each account keeps its provenance and review state.

This repository is an initial, provider-neutral implementation. It has no live search credentials or provider adapters. The included demo uses synthetic data. A production integration supplies source adapters, a durable job store, and client-specific qualification rules.

## What it does now

- Runs independent source lanes concurrently and emits map updates as pages arrive.
- Can sample-gate a low-fit source before its first page is committed and cap pages per source.
- Applies deterministic guards, entity-aware deduplication, exclusions, and source-preserving review states.
- Never marks an account qualified or gives it an ICP score without evidence.
- Returns an initial snapshot at a configurable deadline while the scan continues in the background.
- Writes the provisional CLI map at the first-snapshot deadline, then replaces it with the completed map.
- Records stage/provider durations and costs as portable JSONL events that RunTune can read.
- Analyzes a trace for wall time, provider service time, peak concurrency, and long serial stages.

## Try it

Requires Node 22 or newer. No install is needed for the demo:

```bash
node src/cli.mjs demo --trace ./demo-trace.jsonl
node src/cli.mjs analyze ./demo-trace.jsonl
npm test
```

To inspect the same trace with RunTune, install RunTune separately and use its portable source:

```bash
runtune scan --jsonl ./demo-trace.jsonl
runtune derive --jsonl ./demo-trace.jsonl
```

On Windows PowerShell, set `$env:PYTHONUTF8='1'` before running RunTune's `derive` command so its report file can contain Unicode. A tiny synthetic trace may produce no proposals; the point of the demo is to verify ingestion and timing.

TAMLoop sends fixed stage labels and aggregate counts to RunTune, not raw account rows or API secrets. Read [architecture](docs/ARCHITECTURE.md) and the [Helix integration contract](docs/HELIX_INTEGRATION.md) before connecting a paid source.

## Scope

The first snapshot is a *candidate map*. A source claim is not automatically verified. Qualified status requires an evidence URL and an explicit qualification decision from the supplied judge. Coverage, unresolved claims, and entity counts must remain visible. The roughly two-minute first-map target is a benchmark goal, not a guarantee for every market.

## Relationship to RunTune

RunTune remains an upstream, independently maintained project. TAMLoop uses its documented portable event format to let RunTune identify repeated agent work, failure patterns, and promising specialization. TAMLoop owns the TAM job, account state, source timings, and customer-visible progress. This avoids maintaining a full fork of RunTune while offering one workflow to the operator.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
