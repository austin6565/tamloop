import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeTrace, createRecorder, csvSource, parseCsv, startScan } from '../src/index.mjs';

const hypothesis = { region: 'US', vertical: 'healthcare', icpProfiles: ['care delivery'],
  allowedRegions: ['CA', 'IL'], excludedDomains: ['vendor.example'] };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test('CSV parser handles quoted commas, escaped quotes, and newlines', () => {
  assert.deepEqual(parseCsv('Name,Note\r\n"A, Inc.","line 1\nline ""2"""\r\n'),
    [{ Name: 'A, Inc.', Note: 'line 1\nline "2"' }]);
});

test('parallel lanes publish an initial map and preserve separate entities on one domain', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tamloop-'));
  try {
    const trace = join(dir, 'trace.jsonl');
    const updates = [];
    const sourceA = { name: 'registry', async *pages() {
      await pause(12);
      yield { id: 'a1', rows: [
        { name: 'Lakeside Hospital', region: 'IL', entityType: 'hospital',
          domain: 'shared.example', evidence: ['https://shared.example/lakeside'] },
      ] };
      await pause(40);
      yield { id: 'a2', rows: [
        { name: 'Excluded Vendor', region: 'CA', domain: 'vendor.example' },
      ] };
    } };
    const sourceB = { name: 'directory', async *pages() {
      await pause(45);
      yield { id: 'b1', rows: [
        { name: 'Riverside Hospital', region: 'IL', entityType: 'hospital',
          domain: 'shared.example' },
      ] };
    } };
    const scan = startScan({ hypothesis, sources: [sourceA, sourceB], phaseOneMs: 30,
      runId: 'test-run', record: createRecorder(trace, 'test-run'),
      onUpdate: async (event) => { updates.push(event.type); },
      judge: async (candidate) => candidate.evidence.length
        ? { status: 'qualified', score: 75 } : { status: 'qualified', score: 75 },
    });
    const initial = await scan.initial;
    assert.equal(initial.reason, 'time_budget');
    assert.equal(initial.accounts.length, 1);
    const final = await scan.completion;
    assert.equal(final.accounts.length, 3);
    assert.equal(final.accounts.find((x) => x.name === 'Lakeside Hospital').status, 'qualified');
    assert.equal(final.accounts.find((x) => x.name === 'Riverside Hospital').status, 'needs_review');
    assert.equal(final.accounts.find((x) => x.name === 'Riverside Hospital').score, null);
    assert.equal(final.accounts.find((x) => x.name === 'Excluded Vendor').status, 'excluded');
    assert.ok(updates.includes('page'));
    const events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.every((x) => x.type === 'event' && x.source === 'tamloop' && !JSON.stringify(x).includes('Lakeside')));
    assert.ok(events.some((x) => x.surface === 'tam:source_fetch'));
    const report = await analyzeTrace(trace, 'test-run');
    assert.ok(report.spanCount > 0);
    assert.ok(report.stages.some((x) => x.stage === 'source_fetch' && x.peakConcurrency >= 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CSV source keeps source status as a claim, not a verification decision', async () => {
  const source = csvSource({ name: 'fixture', path: new URL('../examples/accounts.csv', import.meta.url),
    columns: { name: 'Company', domain: 'Domain', region: 'State', entityType: 'Entity Type',
      sourceStatus: 'Source Claim', evidenceUrl: 'Evidence URL' } });
  const scan = startScan({ hypothesis, sources: [source], phaseOneMs: 1_000 });
  const result = await scan.completion;
  assert.equal(result.accounts.length, 4);
  assert.equal(result.accounts.find((x) => x.name === 'Northstar Clinics').sourceStatus, 'verified');
  assert.equal(result.accounts.find((x) => x.name === 'Northstar Clinics').status, 'candidate');
  assert.equal(result.accounts.find((x) => x.name === 'Excluded Vendor').status, 'excluded');
});

test('sample gate skips a poor source and page cap limits a source', async () => {
  const updates = [];
  const skipped = { name: 'poor-fit', sampleGate: async () => ({ accept: false, reason: 'wrong_vertical' }),
    async *pages() { yield { id: 's1', rows: [{ name: 'Wrong Market', region: 'IL' }] }; } };
  const limited = { name: 'capped', maxPages: 1, async *pages() {
    yield { id: 'c1', rows: [{ name: 'First', region: 'IL' }] };
    yield { id: 'c2', rows: [{ name: 'Second', region: 'IL' }] };
  } };
  const scan = startScan({ hypothesis, sources: [skipped, limited],
    onUpdate: async (event) => { updates.push(event); } });
  const result = await scan.completion;
  assert.deepEqual(result.accounts.map((x) => x.name), ['First']);
  assert.equal(result.sourceStatus['poor-fit'], 'skipped');
  assert.equal(result.sourceStatus.capped, 'limited');
  assert.equal(updates.find((x) => x.type === 'source_skipped').reason, 'wrong_vertical');
});

test('a failed source returns a partial result without hiding successful lanes', async () => {
  const failed = { name: 'failed', async *pages() { throw new Error('provider timeout'); } };
  const good = { name: 'good', async *pages() {
    yield { id: 'g1', rows: [{ name: 'Good', region: 'IL' }] };
  } };
  const result = await startScan({ hypothesis, sources: [failed, good] }).completion;
  assert.equal(result.reason, 'partial');
  assert.equal(result.accounts.length, 1);
  assert.equal(result.errors[0].source, 'failed');
});

test('trace analysis distinguishes summed service time from overlapping wall time', () => {
  const base = { source: 'tamloop', ok: true, usd: 0, duration_ms: 100,
    tam: { run_id: 'r', stage: 'source_fetch', provider: 'p', items_in: 0, items_out: 1 } };
  const events = [
    { ...base, tam: { ...base.tam, started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:00.100Z' } },
    { ...base, tam: { ...base.tam, started_at: '2026-01-01T00:00:00.020Z',
      ended_at: '2026-01-01T00:00:00.120Z' } },
  ];
  return import('../src/analyze.mjs').then(({ analyzeEvents }) => {
    const result = analyzeEvents(events, 'r');
    assert.equal(result.stages[0].serviceMs, 200);
    assert.equal(result.stages[0].wallMs, 120);
    assert.equal(result.stages[0].peakConcurrency, 2);
  });
});
