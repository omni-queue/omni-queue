#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { writeChartArtifacts } from './chart-artifacts.js';

function parseInputPath(): string {
  const args = process.argv.slice(2);
  const input = args.find((_, index) => args[index - 1] === '--input');
  if (!input) {
    console.error('Missing --input <results.json>');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), input);
  if (!fs.existsSync(resolved)) {
    console.error(`Input file not found: ${resolved}`);
    process.exit(1);
  }

  return resolved;
}

const inputPath = parseInputPath();
const raw = fs.readFileSync(inputPath, 'utf8');
const parsed = JSON.parse(raw) as Parameters<typeof writeChartArtifacts>[1];
writeChartArtifacts(inputPath, parsed);

console.log(`Generated ${inputPath.replace(/\.json$/, '.csv')} and ${inputPath.replace(/\.json$/, '.charts.md')}`);