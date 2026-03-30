/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueueConfig } from '../interfaces/queue-config';
import { QueueStorage } from '../interfaces/queue-storage';
import { WorkerConfig } from '../interfaces/worker-config';
import { StoredJob } from '../types';
import { sleep } from '../utils';
import { JobManager } from './worker-runtime';

export class Worker1 {
  private active = 0;

  constructor(
    private storage: QueueStorage,
    private runtime: JobManager,
    private options: {
      concurrency: number;
      batchSize: number;
      backpressureThreshold: number;
    }
  ) {}

  async start() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.backpressure();

      const jobs = await this.storage.dequeue({
        batchSize: this.options.batchSize,
        leaseMs: 30000,
      });

      for (const job of jobs) {
        if (this.active >= this.options.concurrency) break;

        this.active++;
        this.process(job).finally(() => this.active--);
      }

      if (!jobs.length) {
        await sleep(100);
      }
    }
  }

  async process(job: StoredJob) {
    try {
      await this.runtime.execute(job);
    } catch (err) {
      // runtime already handles ack/fail
    }
  }

  async backpressure() {
    const depth = await this.storage.getQueueDepth('default');

    if (depth > this.options.backpressureThreshold) {
      await sleep(500);
    }
  }
}

export class Worker {
  private running = false;

  constructor(
    private runtime: JobManager,
    private storageAdapters: Record<string, any>,
    private workerConfig: WorkerConfig,
    private queues: Record<string, QueueConfig>
  ) {}

  async start() {
    this.running = true;

    const concurrency = this.workerConfig.concurrency || 1;

    for (let i = 0; i < concurrency; i++) {
      this.loop();
    }
  }

  async loop() {
    while (this.running) {
      for (const queueName of this.workerConfig.queues) {
        const queueConfig = this.queues[queueName];
        if (!queueConfig) continue;
        const storage = this.storageAdapters[queueConfig.connection];

        const jobs = await storage.dequeue({
          queue: queueName,
          batchSize: 1,
          leaseMs: queueConfig.visibilityTimeout || 30000,
        });

        for (const job of jobs) {
          await this.runtime.execute(job);
        }
      }

      await sleep(100);
    }
  }

  stop() {
    this.running = false;
  }
}
