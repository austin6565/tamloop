import { readFile } from 'node:fs/promises';

function unionMs(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals.toSorted((a, b) => a[0] - b[0]);
  let [start, end] = sorted[0], total = 0;
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else { total += end - start; start = nextStart; end = nextEnd; }
  }
  return total + end - start;
}

function peakConcurrency(intervals) {
  const edges = intervals.flatMap(([start, end]) => [[start, 1], [end, -1]])
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0;
  for (const [, change] of edges) { active += change; peak = Math.max(peak, active); }
  return peak;
}

export function analyzeEvents(events, runId) {
  const spans = events.filter((x) => x.source === 'tamloop' && x.tam &&
    (!runId || x.tam.run_id === runId)).map((x) => ({
      stage: x.tam.stage, provider: x.tam.provider, ok: x.ok,
      start: Date.parse(x.tam.started_at), end: Date.parse(x.tam.ended_at),
      durationMs: Number(x.duration_ms ?? 0), costUsd: Number(x.usd ?? 0),
      itemsIn: Number(x.tam.items_in ?? 0), itemsOut: Number(x.tam.items_out ?? 0),
    })).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end >= x.start);
  const byStage = new Map();
  for (const span of spans) {
    const group = byStage.get(span.stage) ?? [];
    group.push(span);
    byStage.set(span.stage, group);
  }
  const stages = [...byStage].map(([stage, group]) => {
    const intervals = group.map((x) => [x.start, x.end]);
    return {
      stage, calls: group.length, failures: group.filter((x) => !x.ok).length,
      serviceMs: group.reduce((sum, x) => sum + x.durationMs, 0),
      wallMs: unionMs(intervals), peakConcurrency: peakConcurrency(intervals),
      costUsd: group.reduce((sum, x) => sum + x.costUsd, 0),
      itemsIn: group.reduce((sum, x) => sum + x.itemsIn, 0),
      itemsOut: group.reduce((sum, x) => sum + x.itemsOut, 0),
      providers: [...new Set(group.map((x) => x.provider))],
    };
  }).toSorted((a, b) => b.wallMs - a.wallMs);
  const windowMs = spans.length
    ? Math.max(...spans.map((x) => x.end)) - Math.min(...spans.map((x) => x.start)) : 0;
  const findings = [];
  for (const stage of stages) {
    if (stage.calls >= 4 && stage.peakConcurrency === 1 && stage.serviceMs >= 1_000)
      findings.push(`${stage.stage}: ${stage.calls} serial calls; test bounded concurrency with provider limits.`);
    if (stage.failures) findings.push(`${stage.stage}: ${stage.failures} failed calls; inspect retries and source coverage.`);
  }
  return { runId: runId ?? null, spanCount: spans.length, observedWindowMs: windowMs,
    totalCostUsd: stages.reduce((sum, x) => sum + x.costUsd, 0), stages, findings,
    caveat: 'Stage wall times overlap. They are not an additive critical path; customer quality needs separate evidence review.' };
}

export async function analyzeTrace(path, runId) {
  const events = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return analyzeEvents(events, runId);
}
