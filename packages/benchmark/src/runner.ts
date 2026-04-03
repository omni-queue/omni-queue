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
  envFile?: string;
} {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const save = args.includes('--save');

  const scenarioArg = args.find((_, i) => args[i - 1] === '--scenario');
  const iterArg = args.find((_, i) => args[i - 1] === '--iterations');
  const warmupArg = args.find((_, i) => args[i - 1] === '--warmup');
  const envFileArg = args.find((_, i) => args[i - 1] === '--env-file');

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

  return {
    scenarios,
    opts,
    save,
    ...(envFileArg != null ? { envFile: envFileArg } : {}),
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
  const { scenarios, opts, save, envFile } = parseArgs();
  loadEnvironment(envFile);

  console.log('='.repeat(60));
  console.log('  Vasto Benchmark Suite');
  console.log('='.repeat(60));
  console.log(`  Scenarios : ${scenarios.join(', ')}`);
  console.log(`  REDIS_URL : ${process.env['REDIS_URL'] ?? 'not set — Redis scenarios skipped'}`);
  console.log(`  POSTGRES  : ${process.env['POSTGRES_URL'] ?? 'not set — pg-boss skipped'}`);
  console.log('='.repeat(60));

  const allResults: Array<{ scenario: string; status: 'ok' | 'error'; report?: ScenarioReport; error?: string }> = [];

  for (const name of scenarios) {
    try {
      const mod = await import(`./scenarios/${name}.js`);
      const report = await (mod as { run: (opts: ScenarioOptions) => Promise<ScenarioReport> }).run(opts);
      allResults.push({ scenario: name, status: 'ok', report });
    } catch (err) {
      const formattedError = formatError(err);
      console.error(`\n[ERROR] Scenario "${name}" failed:\n${formattedError}`);
      allResults.push({ scenario: name, status: 'error', error: formattedError });
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
