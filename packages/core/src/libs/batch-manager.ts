import { BatchJobRecord, BatchRecord, StoredJob } from '../types';

function cloneJob(job: BatchJobRecord): BatchJobRecord {
  return {
    ...job,
    ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    ...(job.failedAt !== undefined ? { failedAt: job.failedAt } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
  };
}

function cloneBatch(batch: BatchRecord): BatchRecord {
  return {
    ...batch,
    ...(batch.finishedAt !== undefined ? { finishedAt: batch.finishedAt } : {}),
    jobs: batch.jobs.map(cloneJob),
  };
}

export class BatchManager {
  private readonly batches = new Map<string, BatchRecord>();

  registerBatch(batchId: string, name: string, jobs: Array<Pick<BatchJobRecord, 'id' | 'name' | 'queue' | 'payload'>>): BatchRecord {
    const createdAt = Date.now();
    let record: BatchRecord = {
      id: batchId,
      name,
      totalJobs: jobs.length,
      pendingJobs: jobs.length,
      completedJobs: 0,
      failedJobs: 0,
      progress: 0,
      status: 'pending',
      createdAt,
      jobs: jobs.map((job) => ({
        ...job,
        state: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      })),
    };

    const batch = this.batches.get(batchId);
    
    if (!batch) {
      this.batches.set(batchId, record);
    } else {
      batch.totalJobs += jobs.length;
      batch.jobs.push(...record.jobs);
      this.recompute(batch);

      record = batch; // Return the updated batch record
    }

    return cloneBatch(record);
  }

  listBatches(): BatchRecord[] {
    return Array.from(this.batches.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(cloneBatch);
  }

  getBatch(batchId: string): BatchRecord | undefined {
    const batch = this.batches.get(batchId);
    return batch ? cloneBatch(batch) : undefined;
  }

  markJobCompleted(job: StoredJob, result?: unknown): void {
    const batch = this.lookupBatch(job.batchId, job.id);
    if (!batch) return;

    const item = batch.jobs.find((entry) => entry.id === job.id);
    if (!item) return;

    item.state = 'completed';
    item.attempts = job.attempts;
    item.updatedAt = Date.now();
    item.completedAt = item.updatedAt;
    delete item.failedAt;
    delete item.error;
    if (result !== undefined) {
      item.result = result;
    }

    this.recompute(batch);
  }

  markJobFailed(job: StoredJob, error: Error): void {
    const batch = this.lookupBatch(job.batchId, job.id);
    if (!batch) return;

    const item = batch.jobs.find((entry) => entry.id === job.id);
    if (!item) return;

    item.state = 'failed';
    item.attempts = job.attempts + 1;
    item.updatedAt = Date.now();
    item.failedAt = item.updatedAt;
    item.error = error.message;

    this.recompute(batch);
  }

  markJobRetried(batchId: string, jobId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;

    const item = batch.jobs.find((entry) => entry.id === jobId);
    if (!item) return;

    item.state = 'pending';
    item.updatedAt = Date.now();
    item.attempts = 0;
    delete item.failedAt;
    delete item.error;
    delete item.result;

    this.recompute(batch);
  }

  private lookupBatch(batchId: string | undefined, jobId: string): BatchRecord | undefined {
    if (!batchId) return undefined;
    const batch = this.batches.get(batchId);
    if (!batch) return undefined;
    return batch.jobs.some((entry) => entry.id === jobId) ? batch : undefined;
  }

  private recompute(batch: BatchRecord): void {
    batch.completedJobs = batch.jobs.filter((job) => job.state === 'completed').length;
    batch.failedJobs = batch.jobs.filter((job) => job.state === 'failed').length;
    batch.pendingJobs = batch.totalJobs - batch.completedJobs - batch.failedJobs;
    batch.progress = batch.totalJobs === 0 ? 100 : Math.round(((batch.completedJobs + batch.failedJobs) / batch.totalJobs) * 100);
    batch.status = batch.pendingJobs > 0 ? 'pending' : batch.failedJobs > 0 ? 'failed' : 'completed';
    if (batch.pendingJobs === 0) {
      batch.finishedAt = Date.now();
    } else {
      delete batch.finishedAt;
    }
  }
}