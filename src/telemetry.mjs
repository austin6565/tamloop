import { appendFile } from 'node:fs/promises';

/** Emits both RunTune's portable event fields and TAM-specific aggregate fields. */
export function createRecorder(path, runId) {
  if (!path) return async () => {};
  let pending = Promise.resolve();
  return async function record(input) {
    const started = input.startedAt ?? new Date();
    const ended = input.endedAt ?? new Date();
    const stage = String(input.stage);
    const provider = String(input.provider ?? 'internal');
    const event = {
      type: 'event', source: 'tamloop', session: runId,
      ts: started.toISOString(), surface: `tam:${stage}`,
      text: `${stage}:${provider}`, ok: input.ok !== false,
      duration_ms: Math.max(0, ended - started), usd: Number(input.usd ?? 0),
      tam: { run_id: runId, stage, provider,
        started_at: started.toISOString(), ended_at: ended.toISOString(),
        items_in: Number(input.itemsIn ?? 0), items_out: Number(input.itemsOut ?? 0),
        cache_hit: Boolean(input.cacheHit) },
    };
    if (!event.ok) event.error = String(input.error ?? 'stage failed').slice(0, 200);
    pending = pending.then(() => appendFile(path, `${JSON.stringify(event)}\n`, 'utf8'));
    await pending;
  };
}

export async function timed(record, stage, provider, work, counts = () => ({})) {
  const startedAt = new Date();
  try {
    const result = await work();
    await record({ stage, provider, startedAt, endedAt: new Date(), ...counts(result), ok: true });
    return result;
  } catch (error) {
    await record({ stage, provider, startedAt, endedAt: new Date(), ok: false,
      error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
