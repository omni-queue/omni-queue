import path from 'node:path';
import { FileQueueStorage, Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@omni-queue/core';

class FastifyEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'fastify-email';
  override jobName = FastifyEmailJob.jobName;
  override queue() { return 'emails'; }
  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'fastify', to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');
  const recoverRepeatables = process.env.RECOVER_REPEATABLES === 'true';

  const registry = new JobRegistry();
  registry.register(FastifyEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
    repeatables: {
      recoverOnStart: recoverRepeatables,
    },
  });

  await supervisor.start('worker');
  console.log('Fastify worker started for queue: emails');
  console.log(`Repeatable recovery on start: ${recoverRepeatables ? 'enabled' : 'disabled'}`);
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
