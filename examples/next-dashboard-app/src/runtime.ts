import path from 'node:path';
import { FileQueueStorage, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@omni-queue/core';
import { NextEmailJob } from './jobs';

const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');

const registry = new JobRegistry();
registry.register(NextEmailJob);

export const supervisor = new Supervisor({
  queues: defineQueues({
    emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 },
  }),
  workers: defineWorkers({}),
  registry,
  storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
});

let started = false;

export async function ensureSupervisorStarted() {
  if (!started) {
    await supervisor.start('api');
    started = true;
  }

  return supervisor;
}
