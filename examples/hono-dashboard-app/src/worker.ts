import path from 'node:path';
import { FileQueueStorage, Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@vasto/core';

class HonoEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'hono-email';
  override jobName = HonoEmailJob.jobName;
  override queue() { return 'emails'; }
  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'hono', to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');

  const registry = new JobRegistry();
  registry.register(HonoEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
  });

  await supervisor.start('worker');
  console.log('Hono worker started for queue: emails');
  console.log(`Queue data dir: ${QUEUE_DATA_DIR}`);

  const shutdown = async () => {
    await supervisor.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
