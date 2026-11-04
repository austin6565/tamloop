#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { analyzeTrace, createRecorder, csvSource, startScan } from './index.mjs';

function option(args, name, fallback) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
}

async function demo(args) {
  const trace = option(args, '--trace', resolve('demo-trace.jsonl'));
  await writeFile(trace, '');
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const sources = [
    { name: 'registry', async *pages() {
      await wait(10);
      yield { id: 'registry-1', rows: [
        { name: 'Northstar Clinics', region: 'CA', domain: 'northstar.example',
          entityType: 'clinic group', evidence: ['https://northstar.example/about'] },
        { name: 'Northstar Clinics', region: 'CA', domain: 'northstar.example',
          entityType: 'clinic group', evidence: ['https://northstar.example/team'] },
      ] };
      await wait(130);
      yield { id: 'registry-2', rows: [
        { name: 'Lakeside Hospital', region: 'IL', domain: 'shared.example', entityType: 'hospital',
          evidence: ['https://shared.example/lakeside'] },
      ] };
    } },
    { name: 'directory', async *pages() {
      await wait(120);
      yield { id: 'directory-1', rows: [
        { name: 'Riverside Hospital', region: 'IL', domain: 'shared.example', entityType: 'hospital' },
      ] };
    } },
  ];
  const runId = 'synthetic-demo';
  const scan = startScan({ runId, phaseOneMs: 80,
    hypothesis: { region: 'US', vertical: 'healthcare', icpProfiles: ['care delivery'],
      allowedRegions: ['CA', 'IL'] }, sources, record: createRecorder(trace, runId),
    judge: async (candidate) => candidate.evidence.length
      ? { status: 'qualified', score: 80, reason: 'synthetic example' }
      : { status: 'needs_review', reason: 'source evidence missing' },
  });
  const initial = await scan.initial;
  const final = await scan.completion;
  process.stdout.write(`${JSON.stringify({ trace, initialCount: initial.accounts.length,
    initialElapsedMs: initial.elapsedMs, finalCount: final.accounts.length,
    finalElapsedMs: final.elapsedMs, statuses: Object.fromEntries(
      ['candidate', 'qualified', 'needs_review', 'excluded'].map((s) =>
        [s, final.accounts.filter((x) => x.status === s).length])) }, null, 2)}\n`);
}

async function scanCsv(args) {
  const configPath = args[0];
  if (!configPath) throw new Error('usage: tamloop scan <config.json> --out <map.json> --trace <trace.jsonl>');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const base = dirname(resolve(configPath));
  const out = option(args, '--out', resolve('tam-map.json'));
  const trace = option(args, '--trace', resolve('tam-trace.jsonl'));
  await writeFile(trace, '');
  const sources = config.sources.map((source) => csvSource({ ...source, path: resolve(base, source.path) }));
  const runId = config.runId ?? `csv-${Date.now()}`;
  const scan = startScan({ runId, hypothesis: config.hypothesis, sources,
    phaseOneMs: Number(config.phaseOneMs ?? 120_000),
    record: createRecorder(trace, runId),
    judge: async (candidate) => candidate.evidence.length
      ? { status: 'candidate', reason: 'source claim; qualification pending' }
      : { status: 'needs_review', reason: 'source evidence missing' },
  });
  const initial = await scan.initial;
  await writeFile(out, `${JSON.stringify(initial, null, 2)}\n`);
  const result = await scan.completion;
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ runId, output: out, trace,
    initialAccounts: initial.accounts.length, initialElapsedMs: initial.elapsedMs,
    accounts: result.accounts.length, finalElapsedMs: result.elapsedMs,
    errors: result.errors }, null, 2)}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'demo') await demo(args);
  else if (command === 'scan') await scanCsv(args);
  else if (command === 'analyze') {
    if (!args[0]) throw new Error('usage: tamloop analyze <trace.jsonl> [--run <run-id>]');
    process.stdout.write(`${JSON.stringify(await analyzeTrace(args[0], option(args, '--run')), null, 2)}\n`);
  } else process.stdout.write('tamloop demo [--trace path]\ntamloop scan config.json [--out path] [--trace path]\ntamloop analyze trace.jsonl [--run id]\n');
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
