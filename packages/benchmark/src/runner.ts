#!/usr/bin/env node
/**
 * Benchmark runner CLI
 *
 * Usage:
 *   node --loader ts-node/esm src/runner.ts --all
 *   node --loader ts-node/esm src/runner.ts --scenario enqueue-throughput
 *   node --loader ts-node/esm src/runner.ts --scenario processing-throughput --iterations 5
 *   node --loader ts-node/esm src/runner.ts --all --env-file .env.bench
 *   node --loader ts-node/esm src/runner.ts --all --save          # write results/latest.json
 *
 * Environment variables (all optional):
 *   REDIS_URL     - default: redis://localhost:6379
 *   POSTGRES_URL  - default: postgresql://localhost:5432/vasto_bench
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import util from 'node:util';
import dotenv from 'dotenv';
import type { ScenarioOptions, ScenarioReport } from './types.js';
import { writeChartArtifacts } from './chart-artifacts.js';

const require = createRequire(import.meta.url);

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }

  try {
    return util.inspect(err, { depth: 5, breakLength: 120 });
  } catch {
    return 'Unknown error';
  }
}

const SCENARIOS = [
  'enqueue-throughput',
  'processing-throughput',
  'latency-distribution',
  'concurrency-scaling',
  'delayed-job-accuracy',
  'memory-footprint',
] as const;

type ScenarioName = (typeof SCENARIOS)[number];

function parseArgs(): {
  scenarios: ScenarioName[];
  opts: ScenarioOptions;
  save: boolean;
  repeat: number;
  scenarioCooldownMs: number;
  envFile?: string;
} {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const save = args.includes('--save');

  const scenarioArg = args.find((_, i) => args[i - 1] === '--scenario');
  const iterArg = args.find((_, i) => args[i - 1] === '--iterations');
  const warmupArg = args.find((_, i) => args[i - 1] === '--warmup');
  const envFileArg = args.find((_, i) => args[i - 1] === '--env-file');
  const repeatArg = args.find((_, i) => args[i - 1] === '--repeat');
  const cooldownArg = args.find((_, i) => args[i - 1] === '--scenario-cooldown-ms');

  let scenarios: ScenarioName[];

  if (all) {
    scenarios = [...SCENARIOS];
  } else if (scenarioArg != null) {
    if (!(SCENARIOS as readonly string[]).includes(scenarioArg)) {
      console.error(`Unknown scenario: "${scenarioArg}"\nAvailable: ${SCENARIOS.join(', ')}`);
      process.exit(1);
    }
    scenarios = [scenarioArg as ScenarioName];
  } else {
    console.error(
      'No scenario specified. Use --all or --scenario <name>.\nAvailable:\n' +
        SCENARIOS.map((s) => `  ${s}`).join('\n'),
    );
    process.exit(1);
  }

  const opts: ScenarioOptions = {
    ...(iterArg != null ? { iterations: parseInt(iterArg, 10) } : {}),
    ...(warmupArg != null ? { warmupIterations: parseInt(warmupArg, 10) } : {}),
  };

  const parsePositiveInt = (value: string | undefined): number | undefined => {
    if (value == null) return undefined;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed;
  };

  const cooldownFromArg = parsePositiveInt(cooldownArg);
  const cooldownFromEnv = parsePositiveInt(process.env['VASTO_BENCH_SCENARIO_COOLDOWN_MS']);
  const scenarioCooldownMs =
    cooldownFromArg ??
    cooldownFromEnv ??
    (all && scenarios.length > 1 ? 500 : 0);

  return {
    scenarios,
    opts,
    save,
    repeat:
      repeatArg != null && Number.isFinite(parseInt(repeatArg, 10)) && parseInt(repeatArg, 10) > 0
        ? parseInt(repeatArg, 10)
        : 1,
    scenarioCooldownMs,
    ...(envFileArg != null ? { envFile: envFileArg } : {}),
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function stableSerialize(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    ordered[key] = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower]!;
  const weight = rank - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

function aggregateScenarioReports(reports: ScenarioReport[], repeat: number): ScenarioReport {
  if (reports.length === 0) {
    throw new Error('Cannot aggregate empty report set');
  }

  if (reports.length === 1) {
    return reports[0]!;
  }

  type Bucket = {
    template: ScenarioReport['results'][number];
    values: {
      ops: number[];
      meanMs: number[];
      memoryMb: number[];
      schedulerDriftMs: number[];
      latencyP50: number[];
      latencyP95: number[];
      latencyP99: number[];
      latencyMax: number[];
    };
  };

  const buckets = new Map<string, Bucket>();

  for (const report of reports) {
    for (const result of report.results) {
      const key = `${result.library}|${stableSerialize(result.meta)}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          template: result,
          values: {
            ops: [],
            meanMs: [],
            memoryMb: [],
            schedulerDriftMs: [],
            latencyP50: [],
            latencyP95: [],
            latencyP99: [],
            latencyMax: [],
          },
        });
      }

      const bucket = buckets.get(key)!;
      if (typeof result.ops === 'number') bucket.values.ops.push(result.ops);
      if (typeof result.meanMs === 'number') bucket.values.meanMs.push(result.meanMs);
      if (typeof result.memoryMb === 'number') bucket.values.memoryMb.push(result.memoryMb);
      if (typeof result.schedulerDriftMs === 'number') bucket.values.schedulerDriftMs.push(result.schedulerDriftMs);
      if (result.latency) {
        bucket.values.latencyP50.push(result.latency.p50);
        bucket.values.latencyP95.push(result.latency.p95);
        bucket.values.latencyP99.push(result.latency.p99);
        bucket.values.latencyMax.push(result.latency.max);
      }
    }
  }

  const aggregatedResults = Array.from(buckets.values()).map(({ template, values }) => {
    const sorted = {
      ops: [...values.ops].sort((a, b) => a - b),
      meanMs: [...values.meanMs].sort((a, b) => a - b),
      memoryMb: [...values.memoryMb].sort((a, b) => a - b),
      schedulerDriftMs: [...values.schedulerDriftMs].sort((a, b) => a - b),
      latencyP50: [...values.latencyP50].sort((a, b) => a - b),
      latencyP95: [...values.latencyP95].sort((a, b) => a - b),
      latencyP99: [...values.latencyP99].sort((a, b) => a - b),
      latencyMax: [...values.latencyMax].sort((a, b) => a - b),
    };

    return {
      ...template,
      ...(sorted.ops.length > 0 ? { ops: Math.round(percentile(sorted.ops, 50)) } : {}),
      ...(sorted.meanMs.length > 0 ? { meanMs: Number(percentile(sorted.meanMs, 50).toFixed(1)) } : {}),
      ...(sorted.memoryMb.length > 0 ? { memoryMb: Number(percentile(sorted.memoryMb, 50).toFixed(1)) } : {}),
      ...(sorted.schedulerDriftMs.length > 0 ? { schedulerDriftMs: Number(percentile(sorted.schedulerDriftMs, 50).toFixed(1)) } : {}),
      ...(sorted.latencyP50.length > 0
        ? {
            latency: {
              p50: Number(percentile(sorted.latencyP50, 50).toFixed(1)),
              p95: Number(percentile(sorted.latencyP95, 50).toFixed(1)),
              p99: Number(percentile(sorted.latencyP99, 50).toFixed(1)),
              max: Number(percentile(sorted.latencyMax, 50).toFixed(1)),
            },
          }
        : {}),
      meta: {
        ...(template.meta ?? {}),
        aggregate: 'median',
        repeats: repeat,
        p95: {
          ...(sorted.ops.length > 0 ? { ops: Math.round(percentile(sorted.ops, 95)) } : {}),
          ...(sorted.meanMs.length > 0 ? { meanMs: Number(percentile(sorted.meanMs, 95).toFixed(1)) } : {}),
          ...(sorted.memoryMb.length > 0 ? { memoryMb: Number(percentile(sorted.memoryMb, 95).toFixed(1)) } : {}),
          ...(sorted.schedulerDriftMs.length > 0
            ? { schedulerDriftMs: Number(percentile(sorted.schedulerDriftMs, 95).toFixed(1)) }
            : {}),
          ...(sorted.latencyP50.length > 0
            ? {
                latency: {
                  p50: Number(percentile(sorted.latencyP50, 95).toFixed(1)),
                  p95: Number(percentile(sorted.latencyP95, 95).toFixed(1)),
                  p99: Number(percentile(sorted.latencyP99, 95).toFixed(1)),
                  max: Number(percentile(sorted.latencyMax, 95).toFixed(1)),
                },
              }
            : {}),
        },
      },
    };
  });

  const first = reports[0]!;
  return {
    scenario: first.scenario,
    runAt: new Date().toISOString(),
    nodeVersion: first.nodeVersion,
    platform: first.platform,
    results: aggregatedResults,
  };
}

function loadEnvironment(envFile?: string): void {
  if (envFile) {
    const resolvedEnvPath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(resolvedEnvPath)) {
      console.error(`Env file not found: ${resolvedEnvPath}`);
      process.exit(1);
    }
    dotenv.config({ path: resolvedEnvPath, override: true });
    return;
  }

  const defaultEnvPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath, override: true });
  }
}

async function main(): Promise<void> {
  const { scenarios, opts, save, repeat, scenarioCooldownMs, envFile } = parseArgs();
  loadEnvironment(envFile);

  console.log('='.repeat(60));
  console.log('  Vasto Benchmark Suite');
  console.log('='.repeat(60));
  console.log(`  Scenarios : ${scenarios.join(', ')}`);
  if (repeat > 1) {
    console.log(`  Repeat    : ${repeat} (median + p95 aggregation)`);
  }
  if (scenarioCooldownMs > 0) {
    console.log(`  Cooldown  : ${scenarioCooldownMs}ms between scenarios`);
  }
  console.log(`  REDIS_URL : ${process.env['REDIS_URL'] ?? 'not set — Redis-backed scenarios skipped'}`);
  console.log(`  POSTGRES  : ${process.env['POSTGRES_URL'] ?? 'not set — Postgres-backed scenarios skipped'}`);
  console.log('='.repeat(60));

  const allResults: Array<{ scenario: string; status: 'ok' | 'error'; report?: ScenarioReport; error?: string }> = [];

  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
    const name = scenarios[scenarioIndex]!;
    try {
      const mod = await import(`./scenarios/${name}.js`);
      const scenarioModule = mod as { run: (opts: ScenarioOptions) => Promise<ScenarioReport> };
      const runs: ScenarioReport[] = [];

      for (let runIndex = 0; runIndex < repeat; runIndex++) {
        if (repeat > 1) {
          console.log(`\n[repeat ${runIndex + 1}/${repeat}] scenario=${name}`);
        }
        runs.push(await scenarioModule.run(opts));
      }

      const report = aggregateScenarioReports(runs, repeat);
      allResults.push({ scenario: name, status: 'ok', report });
    } catch (err) {
      const formattedError = formatError(err);
      console.error(`\n[ERROR] Scenario "${name}" failed:\n${formattedError}`);
      allResults.push({ scenario: name, status: 'error', error: formattedError });
    }

    if (scenarioCooldownMs > 0 && scenarioIndex < scenarios.length - 1) {
      await sleep(scenarioCooldownMs);
    }
  }

  if (save) {
    const repoRoot = path.resolve(process.cwd(), '..', '..');
    const workspacePackageVersion = (pkgDirName: string): string => {
      try {
        const pkgJsonPath = path.join(repoRoot, 'packages', pkgDirName, 'package.json');
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as { version?: string };
        return parsed.version ?? 'unknown';
      } catch {
        return 'unknown';
      }
    };

    const packageVersion = (pkg: string): string => {
      try {
        const pkgJson = require(`${pkg}/package.json`) as { version?: string };
        return pkgJson.version ?? 'unknown';
      } catch {
        return 'not-installed';
      }
    };

    const payload = {
      generatedAt: new Date().toISOString(),
      runOptions: opts,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        cpuCores: os.cpus().length,
        totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
        redisConfigured: Boolean(process.env['REDIS_URL']),
        postgresConfigured: Boolean(process.env['POSTGRES_URL']),
      },
      dependencyVersions: {
        '@vasto/core': workspacePackageVersion('core'),
        '@vasto/redis-store': workspacePackageVersion('redis-store'),
        '@vasto/postgres-store': workspacePackageVersion('postgres-store'),
        bullmq: packageVersion('bullmq'),
        'bee-queue': packageVersion('bee-queue'),
        'pg-boss': packageVersion('pg-boss'),
        ioredis: packageVersion('ioredis'),
        pg: packageVersion('pg'),
      },
      scenarios: allResults,
    };

    const resultsDir = path.join(process.cwd(), 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const outPath = path.join(resultsDir, `run-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeChartArtifacts(outPath, payload);
    console.log(`\nResults saved to: ${outPath}`);
    console.log(`Chart artifacts saved to: ${outPath.replace(/\.json$/, '.csv')} and ${outPath.replace(/\.json$/, '.charts.md')}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
