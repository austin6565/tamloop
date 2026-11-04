import { randomUUID } from 'node:crypto';
import { applyJudgment, hardGate, mergeCandidate, normalizeCandidate } from './identity.mjs';
import { timed } from './telemetry.mjs';

function validate(hypothesis, sources) {
  if (!hypothesis?.region || !hypothesis?.vertical || !hypothesis?.icpProfiles?.length)
    throw new Error('region, vertical, and at least one ICP profile are required');
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('at least one source is required');
  if (sources.some((s) => !s?.name || typeof s.pages !== 'function'))
    throw new Error('each source needs a name and pages(context) async iterator');
  if (new Set(sources.map((s) => s.name)).size !== sources.length)
    throw new Error('source names must be unique');
  if (sources.some((s) => s.maxPages != null && (!Number.isInteger(s.maxPages) || s.maxPages < 1)))
    throw new Error('maxPages must be a positive integer');
}

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const at = index++;
      results[at] = await work(items[at]);
    }
  }));
  return results;
}

/**
 * Launch a streaming scan. Source pages run concurrently; no live provider is bundled.
 * `completion` must be owned by a durable worker in production.
 */
export function startScan({ hypothesis, sources, judge = async () => ({ status: 'candidate' }),
  record = async () => {}, persist = async () => {}, onUpdate = async () => {},
  phaseOneMs = 120_000, judgeConcurrency = 4, runId = randomUUID() }) {
  validate(hypothesis, sources);
  const accounts = new Map();
  const sourceStatus = Object.fromEntries(sources.map((s) => [s.name, 'pending']));
  const errors = [];
  let pages = 0;
  let initialResolved = false;
  let resolveInitial;
  const snapshot = (reason) => ({ runId, reason, pages, accounts: [...accounts.values()],
    sourceStatus: { ...sourceStatus }, errors: [...errors] });
  const initial = new Promise((resolve) => { resolveInitial = resolve; });
  const finishInitial = (reason) => {
    if (!initialResolved) { initialResolved = true; resolveInitial(snapshot(reason)); }
  };
  const timer = setTimeout(() => finishInitial('time_budget'), Math.max(0, phaseOneMs));

  async function processPage(source, page) {
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    const processed = await timed(record, 'page_process', source.name, () =>
      mapLimit(rows, Math.max(1, judgeConcurrency), async (row) => {
        const candidate = normalizeCandidate(row, source.name);
        const exclusion = hardGate(candidate, hypothesis);
        if (exclusion) return { ...candidate, status: 'excluded', reason: exclusion };
        if (!candidate.region && hypothesis.allowedRegions?.length)
          return { ...candidate, status: 'needs_review', reason: 'region_unknown' };
        const judgment = await timed(record, 'judge', source.name,
          () => judge(candidate, hypothesis), () => ({ itemsIn: 1, itemsOut: 1 }));
        return applyJudgment(candidate, judgment);
      }), (result) => ({ itemsIn: rows.length, itemsOut: result.length }));
    for (const candidate of processed) {
      if (!candidate.name) continue;
      const merged = mergeCandidate(accounts.get(candidate.key), candidate);
      await persist(merged, { runId, source: source.name, pageId: String(page.id ?? pages) });
      accounts.set(candidate.key, merged);
      await onUpdate({ type: 'account', runId, account: merged });
    }
    pages++;
    await onUpdate({ type: 'page', runId, source: source.name, pageId: String(page.id ?? pages),
      pageCount: pages, accountCount: accounts.size });
  }

  async function runSource(source) {
    sourceStatus[source.name] = 'running';
    try {
      const iterator = source.pages({ hypothesis, runId })[Symbol.asyncIterator]();
      let sourcePages = 0;
      while (true) {
        const next = await timed(record, 'source_fetch', source.name, () => iterator.next(),
          (result) => ({ itemsOut: result.done ? 0 : result.value?.rows?.length ?? 0 }));
        if (next.done) break;
        if (sourcePages === 0 && source.sampleGate) {
          const decision = await timed(record, 'source_sample', source.name,
            () => source.sampleGate(next.value?.rows ?? [], hypothesis),
            () => ({ itemsIn: next.value?.rows?.length ?? 0 }));
          if (decision === false || decision?.accept === false) {
            sourceStatus[source.name] = 'skipped';
            await onUpdate({ type: 'source_skipped', runId, source: source.name,
              reason: String(decision?.reason ?? 'sample_gate') });
            if (typeof iterator.return === 'function') await iterator.return();
            return;
          }
        }
        await processPage(source, next.value);
        sourcePages++;
        if (Number.isFinite(source.maxPages) && sourcePages >= source.maxPages) {
          sourceStatus[source.name] = 'limited';
          if (typeof iterator.return === 'function') await iterator.return();
          return;
        }
      }
      sourceStatus[source.name] = 'complete';
    } catch (error) {
      sourceStatus[source.name] = 'failed';
      errors.push({ source: source.name, message: error instanceof Error ? error.message : String(error) });
      await onUpdate({ type: 'source_error', runId, source: source.name });
    }
  }

  const completion = Promise.all(sources.map(runSource)).then(() => {
    clearTimeout(timer);
    const reason = errors.length ? 'partial' : 'complete';
    finishInitial(reason);
    return snapshot(reason);
  });
  return { runId, initial, completion };
}
