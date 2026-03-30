import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { RetryDecisionContext } from '../src/interfaces/retry-policy';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    (this as Error & { code?: string }).code = 'VALIDATION_FAILED';
  }
}

class JobPolicyDeadletterJob extends Job<{ id: string }> {
  static jobName = 'job-policy-deadletter-job';
  override jobName = JobPolicyDeadletterJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override retryPolicy(_error: Error, _context: RetryDecisionContext) {
    return { action: 'deadletter' as const };
  }

  override async handle(): Promise<void> {
    throw new ValidationError('payload is invalid');
  }
}

class QueuePolicyRetryJob extends Job<{ failUntil: number }> {
  static jobName = 'queue-policy-retry-job';
  override jobName = QueuePolicyRetryJob.jobName;
  private attemptsSeen = 0;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { failUntil: number }): Promise<string> {
    this.attemptsSeen += 1;

    if (this.attemptsSeen <= payload.failUntil) {
      const error = new Error('temporary network issue');
      error.name = 'NetworkError';
      (error as Error & { code?: string }).code = 'ECONNRESET';
      throw error;
    }

    return 'recovered';
  }
}

class LegacyRetryJob extends Job<{ succeedOn: number }> {
  static jobName = 'legacy-retry-job';
  override jobName = LegacyRetryJob.jobName;
  private attemptsSeen = 0;

  override queue(): string {
    return 'default';
  }

  override retries(): number {
    return 2;
  }

  override backoff(): number {
    return 0;
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { succeedOn: number }): Promise<string> {
    this.attemptsSeen += 1;

    if (this.attemptsSeen < payload.succeedOn) {
      throw new Error('legacy transient failure');
    }

    return 'legacy-ok';
  }
}

function createRuntime(
  jobs: Array<new (...args: any[]) => Job<any>>,
  queueOverrides: Partial<QueueConfig> = {},
  workerOverrides: Partial<WorkerConfig> = {}
) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();

  for (const job of jobs) {
    registry.register(job);
  }

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 5,
      maxAttempts: 5,
      ...queueOverrides,
    },
  };

  const workers: Record<string, WorkerConfig> = {
    worker: {
      queues: ['default'],
      concurrency: 1,
      isolation: 'inline',
      ...workerOverrides,
    },
  };

  const manager = new JobManager(queues, workers, registry, { memory: storage });
  return { storage, manager };
}

describe('retry policy behavior', () => {
  it('supports job-level deadletter decisions for specific errors', async () => {
    const { storage, manager } = createRuntime([JobPolicyDeadletterJob]);

    await manager.dispatch(new JobPolicyDeadletterJob({ id: 'x' }), { jobId: 'retry-policy-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).rejects.toThrow('payload is invalid');

    const dlq = await storage.getDeadLetterJobs({ queueName: 'default', limit: 10, offset: 0 });
    expect(dlq.map((job) => job.id)).toContain('retry-policy-1');
  });

  it('supports queue-level retry rules by error code', async () => {
    const { storage, manager } = createRuntime([QueuePolicyRetryJob], {
      maxAttempts: 1,
      retry: {
        attempts: 1,
        maxAttempts: 1,
        backoff: 'fixed',
        delay: 0,
        policy: [
          {
            when: { code: 'ECONNRESET' },
            action: 'retry',
            maxAttempts: 3,
            backoffMs: 0,
          },
        ],
      },
    });

    await manager.dispatch(new QueuePolicyRetryJob({ failUntil: 2 }), { jobId: 'retry-policy-2' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).resolves.toBe('recovered');

    const dlq = await storage.getDeadLetterJobs({ queueName: 'default', limit: 10, offset: 0 });
    expect(dlq).toHaveLength(0);
  });

  it('preserves legacy retries() and backoff() behavior when no retry policy exists', async () => {
    const { storage, manager } = createRuntime([LegacyRetryJob], {
      maxAttempts: 2,
    });

    await manager.dispatch(new LegacyRetryJob({ succeedOn: 2 }), { jobId: 'retry-policy-3' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).resolves.toBe('legacy-ok');
  });
});
