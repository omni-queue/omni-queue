import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileQueueStorage } from '../src/libs/file-queue-storage';
import type { StoredJob } from '../src/types';

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: crypto.randomUUID(),
    name: 'TestJob',
    payload: { x: 1 },
    queue: 'test',
    attempts: 0,
    state: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

let dataDir: string;
let storage: FileQueueStorage;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqs-test-'));
  storage = new FileQueueStorage(dataDir);
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('FileQueueStorage — enqueue / dequeue', () => {
  it('enqueues a job and dequeues it', async () => {
    const job = makeJob();
    await storage.enqueue(job);

    const dequeued = await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0]!.id).toBe(job.id);
    expect(dequeued[0]!.state).toBe('leased');
  });

  it('respects batchSize', async () => {
    await storage.enqueue(makeJob());
    await storage.enqueue(makeJob());
    await storage.enqueue(makeJob());

    const dequeued = await storage.dequeue({ queue: 'test', batchSize: 2, leaseMs: 5000 });
    expect(dequeued).toHaveLength(2);
  });

  it('filters by queue name', async () => {
    await storage.enqueue(makeJob({ queue: 'alpha' }));
    await storage.enqueue(makeJob({ queue: 'beta' }));

    const dequeued = await storage.dequeue({ queue: 'alpha', batchSize: 10, leaseMs: 5000 });
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0]!.queue).toBe('alpha');
  });

  it('does not dequeue delayed jobs', async () => {
    const delayed = makeJob({ delayUntil: Date.now() + 60_000 });
    await storage.enqueue(delayed);

    const dequeued = await storage.dequeue({ queue: 'test', batchSize: 5, leaseMs: 5000 });
    expect(dequeued).toHaveLength(0);
  });

  it('reclaims expired leases', async () => {
    const job = makeJob();
    await storage.enqueue(job);

    // Lease a job with a 1ms expiry (already expired by the time we call dequeue again)
    const first = await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 1 });
    expect(first).toHaveLength(1);

    // Wait long enough for the lease to expire
    await new Promise((r) => setTimeout(r, 10));

    const reclaimed = await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.id).toBe(job.id);
  });
});

describe('FileQueueStorage — ack / fail / moveToDeadLetter', () => {
  it('ack removes job from leased directory', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    await storage.ack(job.id);

    const leasedDir = path.join(dataDir, 'leased');
    expect(fs.readdirSync(leasedDir).filter((f) => f === `${job.id}.json`)).toHaveLength(0);
  });

  it('fail marks job as failed in leased directory', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    await storage.fail(job.id, new Error('boom'));

    const leasedPath = path.join(dataDir, 'leased', `${job.id}.json`);
    const stored = JSON.parse(fs.readFileSync(leasedPath, 'utf8')) as StoredJob;
    expect(stored.state).toBe('failed');
  });

  it('moveToDeadLetter moves leased job to dead directory', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    await storage.moveToDeadLetter(job);

    const deadPath = path.join(dataDir, 'dead', `${job.id}.json`);
    expect(fs.existsSync(deadPath)).toBe(true);
    const leasedPath = path.join(dataDir, 'leased', `${job.id}.json`);
    expect(fs.existsSync(leasedPath)).toBe(false);
  });

  it('moveToDeadLetter also handles queued-state jobs (never leased)', async () => {
    const job = makeJob();
    await storage.enqueue(job);

    await storage.moveToDeadLetter(job);

    const deadPath = path.join(dataDir, 'dead', `${job.id}.json`);
    expect(fs.existsSync(deadPath)).toBe(true);
    const queuedPath = path.join(dataDir, 'queued', `${job.id}.json`);
    expect(fs.existsSync(queuedPath)).toBe(false);
  });
});

describe('FileQueueStorage — depth / counts', () => {
  it('getQueueDepth counts only jobs for the given queue', async () => {
    await storage.enqueue(makeJob({ queue: 'q1' }));
    await storage.enqueue(makeJob({ queue: 'q1' }));
    await storage.enqueue(makeJob({ queue: 'q2' }));

    expect(await storage.getQueueDepth('q1')).toBe(2);
    expect(await storage.getQueueDepth('q2')).toBe(1);
    expect(await storage.getQueueDepth('q3')).toBe(0);
  });

  it('getDeadLetterJobs reflects moved jobs', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.moveToDeadLetter(job);

    const dead = await storage.getDeadLetterJobs({ queueName: 'test' });
    expect(dead).toHaveLength(1);
    expect(dead[0]!.id).toBe(job.id);
  });

  it('queryDeferredJobs reflects deferred jobs', async () => {
    const now = Date.now();
    await storage.enqueue(makeJob({ delayUntil: now + 60_000 }));
    await storage.enqueue(makeJob({ delayUntil: now + 120_000 }));
    await storage.enqueue(makeJob()); // not deferred

    const deferred = await storage.queryDeferredJobs({ queueName: 'test' });
    expect(deferred).toHaveLength(2);
  });
});

describe('FileQueueStorage — deferred jobs', () => {
  it('getDelayedJobs returns jobs whose delayUntil is in the past', async () => {
    const past = makeJob({ delayUntil: Date.now() - 1000 });
    const future = makeJob({ delayUntil: Date.now() + 60_000 });
    await storage.enqueue(past);
    await storage.enqueue(future);

    const due = await storage.getDelayedJobs('test', Date.now());
    const ids = due.map((j) => j.id);
    expect(ids).toContain(past.id);
    expect(ids).not.toContain(future.id);
  });

  it('enqueue with delayUntil / queryDeferredJobs round-trips', async () => {
    const job = makeJob({ delayUntil: Date.now() + 60_000 });
    await storage.enqueue(job);

    const deferred = await storage.queryDeferredJobs({ queueName: 'test' });
    expect(deferred.some((j) => j.id === job.id)).toBe(true);
  });

  it('moveJobToQueue promotes a deferred job', async () => {
    const job = makeJob({ delayUntil: Date.now() + 60_000 });
    await storage.enqueue(job);

    await storage.moveJobToQueue('test', job.id, 'active');

    const ready = await storage.getReadyJobs({ queueName: 'test' });
    expect(ready.some((j) => j.id === job.id)).toBe(true);
  });

  it('queryDeferredJobs filters by status=pending', async () => {
    const now = Date.now();
    await storage.enqueue(makeJob({ delayUntil: now + 60_000 }));
    await storage.enqueue(makeJob({ delayUntil: now - 1000 })); // already promotable

    const pending = await storage.queryDeferredJobs({ queueName: 'test', status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.delayUntil).toBeGreaterThan(now);
  });
});

describe('FileQueueStorage — completed jobs', () => {
  it('addCompletedJob / getCompletedJobs round-trips', async () => {
    const job = makeJob();
    await storage.addCompletedJob(job, { ok: true });

    const records = await storage.getCompletedJobs({ queueName: 'test' });
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe(job.id);
    expect(records[0]!.result).toEqual({ ok: true });
    expect(records[0]!.state).toBe('completed');
  });

  it('getCompletedJobs filters by queue', async () => {
    await storage.addCompletedJob(makeJob({ queue: 'a' }));
    await storage.addCompletedJob(makeJob({ queue: 'b' }));

    const records = await storage.getCompletedJobs({ queueName: 'a' });
    expect(records).toHaveLength(1);
    expect(records[0]!.queue).toBe('a');
  });
});

describe('FileQueueStorage — dead-letter retry', () => {
  it('retryDeadLetterJob res the job', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.moveToDeadLetter(job);

    const ok = await storage.retryDeadLetterJob('test', job.id);
    expect(ok).toBe(true);

    const ready = await storage.getReadyJobs({ queueName: 'test' });
    expect(ready).toHaveLength(1);
    expect(ready[0]!.attempts).toBe(0);
  });

  it('retryDeadLetterJob returns false if not found', async () => {
    const ok = await storage.retryDeadLetterJob('test', 'no-such-id');
    expect(ok).toBe(false);
  });

  it('retryDeadLetterJob returns false if already retried', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.moveToDeadLetter(job);

    await storage.retryDeadLetterJob('test', job.id);
    const secondOk = await storage.retryDeadLetterJob('test', job.id);
    expect(secondOk).toBe(false);
  });
});

describe('FileQueueStorage — dead-letter query', () => {
  it('getDeadLetterJobs returns failed jobs with pagination', async () => {
    const a = makeJob();
    const b = makeJob();
    await storage.enqueue(a);
    await storage.enqueue(b);
    await storage.moveToDeadLetter(a);
    await storage.moveToDeadLetter(b);

    const page1 = await storage.getDeadLetterJobs({ queueName: 'test', limit: 1, offset: 0 });
    expect(page1).toHaveLength(1);

    const all = await storage.getDeadLetterJobs({ queueName: 'test' });
    expect(all).toHaveLength(2);
  });
});

describe('FileQueueStorage — active jobs query', () => {
  it('getActiveJobs returns leased jobs', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    const active = await storage.getActiveJobs({ queueName: 'test' });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(job.id);
  });
});

describe('FileQueueStorage — progress and lease extension', () => {
  it('setJobProgress updates the leased job', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    await storage.setJobProgress(job.id, 75);

    const active = await storage.getActiveJobs({ queueName: 'test' });
    expect(active[0]!.progress).toBe(75);
  });

  it('extendLease updates _leaseExpiry', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 1 });

    await new Promise((r) => setTimeout(r, 10));
    await storage.extendLease(job.id, 30_000);

    // After extension the job should no longer be reclaimable immediately
    const reclaimed = await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });
    expect(reclaimed.some((j) => j.id === job.id)).toBe(false);
  });
});

describe('FileQueueStorage — updateAttempts', () => {
  it('persists updated attempt count', async () => {
    const job = makeJob();
    await storage.enqueue(job);
    await storage.dequeue({ queue: 'test', batchSize: 1, leaseMs: 5000 });

    await storage.updateAttempts(job.id, 3);

    const active = await storage.getActiveJobs({ queueName: 'test' });
    expect(active[0]!.attempts).toBe(3);
  });
});

describe('FileQueueStorage — listJson catch path', () => {
  it('returns 0 depth when queued directory is removed after construction', async () => {
    // Enqueue a job first so the queued dir exists, then remove it
    // to trigger the listJson catch block which returns []
    await storage.enqueue(makeJob());
    fs.rmSync(path.join(dataDir, 'queued'), { recursive: true, force: true });

    const depth = await storage.getQueueDepth('test');
    expect(depth).toBe(0);
  });
});
