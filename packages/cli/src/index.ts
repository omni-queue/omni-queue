import { runQueue } from './queue';

const args = process.argv.slice(2);

async function main() {
  await runQueue(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
