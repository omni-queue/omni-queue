import { describe, expect, it } from 'vitest';
import { BatchManager } from '../src/libs/batch-manager';
import type { StoredJob } from '../src/types';

function makeJob(id: string, batchId?: string): StoredJob {
  const now = Date.now();
  return {
    id,
    name: 'test-job',
    payload: {},
    queue: 'default',
    state: 'leased',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...(batchId !== undefined ? { batchId } : {}),
  };
}

function makeEntry(id: string) {
  return { id, name: 'test-job', queue: 'default', payload: {} };
}

describe('BatchManager', () => {
  it('listBatches returns all registered batches with sort/map executed', () => {
    const mgr = new BatchManager();
    mgr.registerBatch('b1', 'First', [makeEntry('j1')]);
    mgr.registerBatch('b2', 'Second', [makeEntry('j2')]);

    const list = mgr.listBatches();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.id)).toContain('b1');
    expect(list.map((b) => b.id)).toContain('b2');
  });

  it('listBatches sorts newest-first when createdAt differs', async () => {
    const mgr = new BatchManager();
    mgr.registerBatch('b1', 'First', [makeEntry('j1')]);
    await new Promise((r) => setTimeout(r, 5));
    mgr.registerBatch('b2', 'Second', [makeEntry('j2')]);

    const list = mgr.listBatches();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('b2');
    expect(list[1]!.id).toBe('b1');
  });

  it('getBatch returns undefined for unknown id', () => {
    const mgr = new BatchManager();
    expect(mgr.getBatch('missing')).toBeUndefined();
  });

  it('markJobFailed records error details and marks batch as failed', () => {
    const mgr = new BatchManager();
    const batch = mgr.registerBatch('b1', 'My Batch', [makeEntry('j1')]);

    mgr.markJobFailed(makeJob('j1', batch.id), new Error('something went wrong'));

    const updated = mgr.getBatch(batch.id);
    expect(updated?.failedJobs).toBe(1);
    expect(updated?.pendingJobs).toBe(0);
    expect(updated?.status).toBe('failed');
    expect(updated?.finishedAt).toBeTypeOf('number');
    const item = updated?.jobs[0]!;
    expect(item.state).toBe('failed');
    expect(item.error).toBe('something went wrong');
    expect(item.failedAt).toBeTypeOf('number');
  });

  it('markJobFailed is a no-op when batchId is absent', () => {
    const mgr = new BatchManager();
    // job without a batchId → lookupBatch returns undefined → no-op
    expect(() => mgr.markJobFailed(makeJob('j1'), new Error('x'))).not.toThrow();
  });

  it('markJobRetried resets a failed job back to pending', () => {
    const mgr = new BatchManager();
    const batch = mgr.registerBatch('b1', 'Retry Batch', [makeEntry('j1'), makeEntry('j2')]);

    mgr.markJobFailed(makeJob('j1', batch.id), new Error('oops'));
    mgr.markJobRetried(batch.id, 'j1');

    const updated = mgr.getBatch(batch.id);
    expect(updated?.failedJobs).toBe(0);
    expect(updated?.pendingJobs).toBe(2);
    expect(updated?.status).toBe('pending');
    expect(updated?.finishedAt).toBeUndefined();

    const item = updated?.jobs[0]!;
    expect(item.state).toBe('pending');
    expect(item.failedAt).toBeUndefined();
    expect(item.error).toBeUndefined();
    expect(item.result).toBeUndefined();
    expect(item.attempts).toBe(0);
  });

  it('markJobRetried is a no-op for unknown batch', () => {
    const mgr = new BatchManager();
    expect(() => mgr.markJobRetried('no-batch', 'no-job')).not.toThrow();
  });

  it('markJobRetried is a no-op for unknown jobId within real batch', () => {
    const mgr = new BatchManager();
    const batch = mgr.registerBatch('b1', 'Test', [makeEntry('j1')]);
    expect(() => mgr.markJobRetried(batch.id, 'nonexistent-job')).not.toThrow();
  });

  it('recompute sets finishedAt when all jobs complete', () => {
    const mgr = new BatchManager();
    const batch = mgr.registerBatch('b1', 'Complete Batch', [makeEntry('j1'), makeEntry('j2')]);

    mgr.markJobCompleted(makeJob('j1', batch.id), 'result-1');
    mgr.markJobCompleted(makeJob('j2', batch.id), 'result-2');

    const updated = mgr.getBatch(batch.id);
    expect(updated?.completedJobs).toBe(2);
    expect(updated?.pendingJobs).toBe(0);
    expect(updated?.status).toBe('completed');
    expect(updated?.finishedAt).toBeTypeOf('number');
  });

  it('deletes finishedAt when markJobRetried makes a batch active again', () => {
    const mgr = new BatchManager();
    const batch = mgr.registerBatch('b1', 'Mixed', [makeEntry('j1'), makeEntry('j2')]);

    // Complete one, fail one → batch finishes (mixed)
    mgr.markJobCompleted(makeJob('j1', batch.id));
    mgr.markJobFailed(makeJob('j2', batch.id), new Error('fail'));

    const finishedBatch = mgr.getBatch(batch.id);
    expect(finishedBatch?.finishedAt).toBeTypeOf('number');

    // Retry the failed job → back to pending
    mgr.markJobRetried(batch.id, 'j2');
    const retriedBatch = mgr.getBatch(batch.id);
    expect(retriedBatch?.pendingJobs).toBe(1);
    expect(retriedBatch?.finishedAt).toBeUndefined();
  });
});
