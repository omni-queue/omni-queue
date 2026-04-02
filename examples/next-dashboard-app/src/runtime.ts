import path from 'node:path';
import {
  FileQueueStorage,
  JobRegistry,
  resolveSupervisorMode,
  Supervisor,
  type SupervisorMode,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';
import { NextEmailJob } from './jobs';

const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');
export const supervisorMode: SupervisorMode = resolveSupervisorMode(process.env.SUPERVISOR_MODE);
const recoverRepeatables = process.env.RECOVER_REPEATABLES === 'true';

const registry = new JobRegistry();
registry.register(NextEmailJob);

export const supervisor = new Supervisor({
  queues: defineQueues({
    emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 },
  }),
  workers:
    supervisorMode === 'hybrid' || supervisorMode === 'worker'
      ? defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } })
      : defineWorkers({}),
  registry,
  storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
  repeatables: {
    recoverOnStart: recoverRepeatables,
  },
});

let started = false;

export async function ensureSupervisorStarted() {
  if (!started) {
    await supervisor.start(supervisorMode);
    console.log(`Repeatable recovery on start: ${recoverRepeatables ? 'enabled' : 'disabled'}`);
    if (supervisorMode === 'api') {
      console.warn('API mode does not process jobs. Run `npm run worker` or set SUPERVISOR_MODE=hybrid.');
    }
    started = true;
  }

  return supervisor;
}
