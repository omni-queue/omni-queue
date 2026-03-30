/* eslint-disable @typescript-eslint/no-explicit-any */

import { Job } from '../contracts/job';
import { StoredJob } from '../types';

export class Queue {
  constructor(
    private queues: any,
    private storageAdapters: Record<string, any>
  ) {}

  async dispatch(job: Job) {
    const queueName = job.queue();
    const config = this.queues[queueName];

    const storage = this.storageAdapters[config.connection];

    const storedJob: StoredJob = {
      id: crypto.randomUUID(),

      name: job.jobName,

      payload: job.payload,

      queue: queueName,

      attempts: 0,

      state: 'queued',

      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.enqueue(storedJob);
  }
}
