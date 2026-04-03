import fs from 'node:fs';

type SavedScenarioResult = {
  library: string;
  scenario: string;
  iterations: number;
  ops?: number;
  latency?: { p50: number; p95: number; p99: number; max: number };
  meanMs?: number;
  memoryMb?: number;
  schedulerDriftMs?: number;
  meta?: Record<string, unknown>;
};

type SavedScenarioReport = {
  scenario: string;
  runAt: string;
  nodeVersion: string;
  platform: string;
  results: SavedScenarioResult[];
};

type SavedPayload = {
  scenarios: Array<{
    scenario: string;
    status: 'ok' | 'error';
    report?: SavedScenarioReport;
    error?: string;
  }>;
};

function flattenRows(payload: SavedPayload): string[] {
  const rows = ['scenario,library,metric,value,unit,meta'];

  for (const entry of payload.scenarios) {
    if (entry.status !== 'ok' || !entry.report) {
      continue;
    }

    for (const result of entry.report.results) {
      const meta = JSON.stringify(result.meta ?? {}).replaceAll('"', '""');
      if (result.ops !== undefined) {
        rows.push(`${entry.scenario},${result.library},ops,${result.ops},ops/sec,"${meta}"`);
      }
      if (result.meanMs !== undefined) {
        rows.push(`${entry.scenario},${result.library},meanMs,${result.meanMs},ms,"${meta}"`);
      }
      if (result.memoryMb !== undefined) {
        rows.push(`${entry.scenario},${result.library},memoryMb,${result.memoryMb},MB,"${meta}"`);
      }
      if (result.schedulerDriftMs !== undefined) {
        rows.push(`${entry.scenario},${result.library},schedulerDriftMs,${result.schedulerDriftMs},ms,"${meta}"`);
      }
      if (result.latency) {
        rows.push(`${entry.scenario},${result.library},latencyP50,${result.latency.p50},ms,"${meta}"`);
        rows.push(`${entry.scenario},${result.library},latencyP95,${result.latency.p95},ms,"${meta}"`);
        rows.push(`${entry.scenario},${result.library},latencyP99,${result.latency.p99},ms,"${meta}"`);
        rows.push(`${entry.scenario},${result.library},latencyMax,${result.latency.max},ms,"${meta}"`);
      }
    }
  }

  return rows;
}

function quoteLabels(labels: string[]): string {
  return `[${labels.map((label) => `"${label}"`).join(', ')}]`;
}

function maxOrOne(values: number[]): number {
  const max = values.reduce((acc, value) => Math.max(acc, value), 0);
  return max > 0 ? max : 1;
}

function renderBarChart(title: string, yAxis: string, pairs: Array<{ label: string; value: number }>): string {
  const labels = pairs.map((pair) => pair.label);
  const values = pairs.map((pair) => Math.max(0, Number(pair.value.toFixed(2))));
  return [
    `### ${title}`,
    '```mermaid',
    'xychart-beta',
    `    title "${title}"`,
    `    x-axis ${quoteLabels(labels)}`,
    `    y-axis "${yAxis}" 0 --> ${Math.ceil(maxOrOne(values) * 1.1)}`,
    `    bar [${values.join(', ')}]`,
    '```',
    '',
  ].join('\n');
}

function renderConcurrencyChart(report: SavedScenarioReport): string {
  const allLevels = Array.from(
    new Set(
      report.results
        .map((result) => Number(result.meta?.['concurrency']))
        .filter((value) => Number.isFinite(value)),
    ),
  ).sort((a, b) => a - b);
  const libraries = Array.from(new Set(report.results.map((result) => result.library)));
  const max = maxOrOne(report.results.map((result) => result.ops ?? 0));

  const lines = [
    '### concurrency-scaling',
    '```mermaid',
    'xychart-beta',
    '    title "concurrency-scaling"',
    `    x-axis ${quoteLabels(allLevels.map(String))}`,
    `    y-axis "ops/sec" 0 --> ${Math.ceil(max * 1.1)}`,
  ];

  for (const library of libraries) {
    const values = allLevels.map((level) => {
      const match = report.results.find((result) => result.library === library && Number(result.meta?.['concurrency']) === level);
      return Math.max(0, Number((match?.ops ?? 0).toFixed(2)));
    });
    lines.push(`    line [${values.join(', ')}]`);
  }

  lines.push('```', '');
  return lines.join('\n');
}

function renderLatencyCharts(report: SavedScenarioReport): string {
  const percentileKeys = [
    { key: 'p50', title: 'latency p50' },
    { key: 'p95', title: 'latency p95' },
    { key: 'p99', title: 'latency p99' },
    { key: 'max', title: 'latency max' },
  ] as const;

  return percentileKeys
    .map(({ key, title }) =>
      renderBarChart(
        title,
        'ms',
        report.results.map((result) => ({ label: result.library, value: result.latency?.[key] ?? 0 })),
      ),
    )
    .join('');
}

function renderCharts(payload: SavedPayload): string {
  const sections = ['# Benchmark Charts', ''];

  for (const entry of payload.scenarios) {
    if (entry.status !== 'ok' || !entry.report) {
      continue;
    }

    if (entry.report.scenario === 'concurrency-scaling') {
      sections.push(renderConcurrencyChart(entry.report));
      continue;
    }

    if (entry.report.scenario === 'latency-distribution') {
      sections.push(renderLatencyCharts(entry.report));
      continue;
    }

    if (entry.report.scenario === 'delayed-job-accuracy') {
      sections.push(
        renderBarChart(
          'delayed-job-accuracy',
          'ms',
          entry.report.results.map((result) => ({ label: result.library, value: result.schedulerDriftMs ?? 0 })),
        ),
      );
      continue;
    }

    if (entry.report.scenario === 'memory-footprint') {
      sections.push(
        renderBarChart(
          'memory-footprint',
          'MB',
          entry.report.results.map((result) => ({ label: result.library, value: result.memoryMb ?? 0 })),
        ),
      );
      continue;
    }

    sections.push(
      renderBarChart(
        entry.report.scenario,
        'ops/sec',
        entry.report.results.map((result) => ({ label: result.library, value: result.ops ?? 0 })),
      ),
    );
  }

  return sections.join('\n');
}

export function writeChartArtifacts(jsonPath: string, payload: SavedPayload): void {
  const csvPath = jsonPath.replace(/\.json$/, '.csv');
  const chartsPath = jsonPath.replace(/\.json$/, '.charts.md');

  fs.writeFileSync(csvPath, flattenRows(payload).join('\n'));
  fs.writeFileSync(chartsPath, renderCharts(payload));
}
