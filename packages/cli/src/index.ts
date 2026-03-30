import path from 'node:path';
import { runOmni } from './gen';
import { runQueue } from './queue';

const args = process.argv.slice(2);
const binName = path.basename(process.argv[1] ?? 'queue');

async function main() {
  if (binName === 'omni') {
    await runOmni(args);
    return;
  }

  await runQueue(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
