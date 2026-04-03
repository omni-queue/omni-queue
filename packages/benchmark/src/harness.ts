import os from 'node:os';
import process from 'node:process';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from './types.js';

export const DEFAULT_OPTIONS: Required<ScenarioOptions> = {
  warmupIterations: 3,
  iterations: 10,
  concurrency: 5,
  redisUrl: process.env['REDIS_URL'] ?? '',
  postgresUrl: process.env['POSTGRES_URL'] ?? '',
};

/**
 * Measures the wall-clock time (ms) for an async function.
 */
export async function measure(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/**
 * Runs warmup rounds (results discarded) then measured rounds.
 * Returns array of durations in ms.
 */
export async function runRounds(
  fn: () => Promise<void>,
  opts: Required<ScenarioOptions>,
): Promise<number[]> {
  for (let i = 0; i < opts.warmupIterations; i++) {
    await fn();
  }
  const durations: number[] = [];
  for (let i = 0; i < opts.iterations; i++) {
    durations.push(await measure(fn));
  }
  return durations;
}

/**
 * Calculates basic percentile stats from a sorted duration array.
 */
export function percentiles(durations: number[]): ScenarioResult['latency'] {
  const sorted = [...durations].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor((p / 100) * sorted.length)] ?? 0;
  return {
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted.length > 0 ? (sorted[sorted.length - 1] as number) : 0,
  };
}

export function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function toOps(jobCount: number, durationMs: number): number {
  return Math.round((jobCount / durationMs) * 1000);
}

export function rssInMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

export function buildReport(scenario: string, results: ScenarioResult[]): ScenarioReport {
  return {
    scenario,
    runAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()} (${os.cpus()[0]?.model ?? 'unknown'})`,
    results,
  };
}

/**
 * Prints a formatted markdown table to stdout.
 */
export function printReport(report: ScenarioReport): void {
  console.log(`\n## ${report.scenario}`);
  console.log(`Run at: ${report.runAt}`);
  console.log(`Node: ${report.nodeVersion} | Platform: ${report.platform}\n`);

  const hasOps = report.results.some((r) => r.ops !== undefined);
  const hasLatency = report.results.some((r) => r.latency !== undefined);
  const hasMemory = report.results.some((r) => r.memoryMb !== undefined);
  const hasDrift = report.results.some((r) => r.schedulerDriftMs !== undefined);

  if (hasOps) {
    console.log('| Library | ops/sec | mean ms |');
    console.log('|---------|--------:|--------:|');
    for (const r of report.results) {
      console.log(`| ${r.library} | ${r.ops ?? '-'} | ${r.meanMs?.toFixed(1) ?? '-'} |`);
    }
    console.log('');
  }

  if (hasLatency) {
    console.log('| Library | p50 ms | p95 ms | p99 ms | max ms |');
    console.log('|---------|-------:|-------:|-------:|-------:|');
    for (const r of report.results) {
      const l = r.latency;
      console.log(
        `| ${r.library} | ${l?.p50.toFixed(1) ?? '-'} | ${l?.p95.toFixed(1) ?? '-'} | ${l?.p99.toFixed(1) ?? '-'} | ${l?.max.toFixed(1) ?? '-'} |`,
      );
    }
    console.log('');
  }

  if (hasMemory) {
    console.log('| Library | RSS MB |');
    console.log('|---------|-------:|');
    for (const r of report.results) {
      console.log(`| ${r.library} | ${r.memoryMb ?? '-'} |`);
    }
    console.log('');
  }

  if (hasDrift) {
    console.log('| Library | scheduler drift ms (mean) |');
    console.log('|---------|-------------------------:|');
    for (const r of report.results) {
      console.log(`| ${r.library} | ${r.schedulerDriftMs?.toFixed(1) ?? '-'} |`);
    }
    console.log('');
  }
}
