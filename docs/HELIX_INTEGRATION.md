# Helix integration contract

Helix remains the product and Supabase Postgres remains its canonical database. TAMLoop is a provider-neutral package; it does not create a second account database. The integration belongs on a dedicated Helix branch after the standalone package is benchmarked.

1. Parse the approved Strand dossier into a versioned TAM hypothesis. Preserve the current approval gate.
2. Add Helix source adapters for the approved registry/directory, Exa, and existing account imports. Each yields pages with source IDs and evidence metadata. The source planner may skip a source after a small sample fails the vertical-fit gate.
3. Persist job, source cursor, page key, entity, claim, evidence, and budget reservation in Supabase Postgres through Drizzle migrations. Reuse existing company, engagement, exclusion, and run ledgers where their semantics match; add tables only for missing page/job state.
4. Run source lanes in bounded parallel workers. Commit each page idempotently. Publish a provisional first snapshot after the time budget, then stream or poll updates as later pages finish.
5. Apply deterministic cleaning and hard ICP gates in code. Use the existing Anthropic client factory for ambiguous evidence/fit judgments. Require source URLs before qualification or scoring. Keep unknown fields and needs-review accounts visible.
6. Run revenue fallback, unresolved verification, people, recheck, and intent as background stages. Keep their cost ceilings separate and show their status in the map.
7. Emit TAMLoop events alongside Helix's existing run and provider ledgers. RunTune reads the aggregate event stream for engineering feedback; it does not become the customer account store.

The integration should begin where source discovery, candidate persistence, and background job execution meet. Keep Helix's existing approval and spend gates in force while replacing serial source and judgment work with bounded, checkpointed workers.

No live source call should be made in a test or benchmark by default. Use synthetic adapters or saved, licensed fixtures first. A paid pilot needs an explicit cost ceiling and a captured baseline.
