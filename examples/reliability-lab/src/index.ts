import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
  type RetryDecision,
  type RetryDecisionContext,
} from '@vasto-queue/core';

class FlakyInvoiceJob extends Job<{ invoiceId: string }> {
  static jobName = 'flaky-invoice';
  override jobName = FlakyInvoiceJob.jobName;

  override queue() {
    return 'critical';
  }

  override retries() {
    return 2;
  }

  override backoff(attempt: number) {
    return 200 * (attempt + 1);
  }

  override retryPolicy(error: Error, context: RetryDecisionContext): RetryDecision | undefined {
    if (error.message.includes('VALIDATION')) {
      return { action: 'deadletter' };
    }

    if (context.attempt >= 2) {
      return { action: 'fail' };
    }

    return undefined;
  }

  override async handle(payload: { invoiceId: string }) {
    await this.reportProgress(30);
    await this.reportProgress(70);

    if (payload.invoiceId.endsWith('bad')) {
      throw new Error('VALIDATION: malformed invoice payload');
    }

    throw new Error('TRANSIENT_GATEWAY_ERROR');
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.register(FlakyInvoiceJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      critical: {
        name: 'critical',
        connection: 'memory',
        concurrency: 2,
        batchSize: 5,
        rateLimit: {
          capacity: 10,
          refillRate: 10,
          perConsumer: { capacity: 5, refillRate: 5 },
        },
        reliability: {
          backpressure: {
            depthThreshold: 20,
            resumeThreshold: 10,
            mode: 'delay',
          },
          circuitBreaker: {
            failureThreshold: 2,
            cooldownMs: 2_000,
            halfOpenMaxInFlight: 1,
            tripOnTimeout: true,
          },
        },
      },
    }),
    workers: defineWorkers({
      main: { queues: ['critical'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
    if (event.type.startsWith('job.') || event.type.startsWith('queue.') || event.type.startsWith('reliability.')) {
      console.log('[event]', event.type, event.queueName ?? 'n/a', event.jobId ?? '');
    }
  });

  await supervisor.start();

  // Retryable failures; eventually fail/dead-letter based on policies.
  await supervisor.jobManager.dispatch(new FlakyInvoiceJob({ invoiceId: 'inv-001' }), { priority: 'high' });
  await supervisor.jobManager.dispatch(new FlakyInvoiceJob({ invoiceId: 'inv-002-bad' }), { priority: 'critical' });

  await new Promise((resolve) => setTimeout(resolve, 2_000));

  // Ops controls
  supervisor.pauseQueue('critical');
  await supervisor.drainQueue('critical', { timeoutMs: 3_000, pauseFirst: true });
  supervisor.resumeQueue('critical');

  const dlq = await supervisor.getDLQ({ queueName: 'critical', limit: 10 });
  console.log('dlq jobs:', dlq.map((job) => ({ id: job.id, attempts: job.attempts, tags: job.tags ?? [] })));

  if (dlq[0]) {
    const retried = await supervisor.retryDLQ('critical', dlq[0].id);
    console.log('retried first dlq job:', retried);
  }

  const reliability = supervisor.getReliabilitySnapshot();
  console.log('reliability snapshot:', JSON.stringify(reliability, null, 2));

  unsubscribe();
  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
