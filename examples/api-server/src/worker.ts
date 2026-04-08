/**
 * Queue Worker — polls the file-based queue and processes jobs.
 *
 * Run this in one terminal:         npm run worker
 * Run the API server in another:    npm run server
 *
 * Both processes share the same queue via the filesystem (./queue-data/).
 * Add more worker processes for horizontal scaling:
 *   PORT=3001 npm run server &
 *   npm run worker &
 *   npm run worker &   # second worker — they safely share the same queue dir
 */

import {
  Supervisor,
  JobRegistry,
  defineQueues,
  defineWorkers,
} from '@vasto-queue/core';
import { FileQueueStorage } from './storage/file-queue-storage.js';
import { SendEmailJob } from './jobs/index.js';

async function main() {
  const dataDir = process.env.QUEUE_DATA_DIR ?? './queue-data';

  // ── Register all known job classes ─────────────────────────────────────────
  const registry = new JobRegistry();
  registry.registerAll([SendEmailJob]);

  // ── Queue + worker definitions ─────────────────────────────────────────────
  const queues = defineQueues({
    'api-jobs': {
      name: 'api-jobs',
      connection: 'disk',
      concurrency: 4,
      batchSize: 10,
    },
  });

  const workers = defineWorkers({
    apiRunner: {
      queues: ['api-jobs'],
      concurrency: 4,
      isolation: 'inline',
    },
  });

  // ── Shared file-based storage ───────────────────────────────────────────────
  // Points to the same directory the server writes to.
  const storageAdapters = {
    disk: new FileQueueStorage(dataDir),
  };

  const supervisor = new Supervisor(queues, workers, registry, storageAdapters);

  console.log(`[worker] Queue worker starting (pid ${process.pid})`);
  console.log(`[worker] Queue data directory: ${dataDir}`);
  console.log(`[worker] Watching queues: api-jobs`);
  console.log(`[worker] Press Ctrl+C to stop.\n`);

  // supervisor.start() fires off the polling loops and returns immediately.
  // The process stays alive because the workers are in their own async loops.
  await supervisor.start();

  const shutdown = () => {
    console.log('\n[worker] Shutting down supervisor...');
    supervisor.stop();
    // Give in-flight jobs a moment to finish
    setTimeout(() => process.exit(0), 2000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker] Fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
