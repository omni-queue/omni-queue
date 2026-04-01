/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueueConfig } from '../interfaces/queue-config';
import {
  ArchiveRetentionPolicy,
  CompletedJobsQuery,
  DeadLetterQuery,
  DeferredJobsQuery,
  JobArchiveQuery,
  QueueCleanOptions,
  QueueAdminJobStatus,
  QueueStorage,
} from '../interfaces/queue-storage';
import { CompletedJobRecord, FlowNodeInput, FlowState, StoredJob } from '../types';
import { WorkerConfig } from '../interfaces/worker-config';
import { sleep } from '../utils';
import { ResilientWorker } from './resilient-worker';
import { JobManager } from './worker-runtime';
import { JobRegistry } from './registry';
import { Plugin } from '../interfaces/plugin';
import { ScheduledJobPromoter } from './scheduled-job-promoter';
import { DashboardOptions } from '../interfaces/dashboard';
import { BatchManager } from './batch-manager';
import { LifecycleEventBus, QueueLifecycleEvent } from './lifecycle-events';

export interface QueueReliabilityStatus {
  queueName: string;
  backpressureActive: boolean;
  circuitState: 'closed' | 'open' | 'half-open';
  updatedAt: number;
}

export interface SupervisorOptions {
  queues: Record<string, QueueConfig>;
  workers: Record<string, WorkerConfig>;
  registry: JobRegistry;
  storageAdapters: Record<string, QueueStorage>;
  globalPlugins?: Plugin[];
  dashboard?: DashboardOptions;
}

export type SupervisorMode = 'api' | 'worker';

export class Supervisor {
  private workers: Map<string, any[]> = new Map();
  private running = false;
  private mode: SupervisorMode = 'worker';
  public jobManager: JobManager;
  private batchManager: BatchManager;
  private promoter?: ScheduledJobPromoter;
  private dashboardOptions: DashboardOptions | undefined;
  private desiredWorkerScaling = new Map<string, number>();
  private pausedQueues = new Set<string>();
  private lifecycleEvents = new LifecycleEventBus();
  private reliabilityStatus = new Map<string, QueueReliabilityStatus>();

  constructor(
    queuesOrOptions: Record<string, QueueConfig> | SupervisorOptions,
    workerDefs?: Record<string, WorkerConfig>,
    registry?: JobRegistry,
    storageAdapters?: Record<string, QueueStorage>,
    globalPlugins?: Plugin[]
  ) {
    let queues: Record<string, QueueConfig>;
    let finalWorkers: Record<string, WorkerConfig>;
    let finalRegistry: JobRegistry;
    let finalStorageAdapters: Record<string, QueueStorage>;
    let finalGlobalPlugins: Plugin[] = [];
    let finalDashboard: DashboardOptions | undefined;

    // Handle both positional and object-based parameters
    if (this.isOptions(queuesOrOptions)) {
      queues = queuesOrOptions.queues;
      finalWorkers = queuesOrOptions.workers;
      finalRegistry = queuesOrOptions.registry;
      finalStorageAdapters = queuesOrOptions.storageAdapters;
      finalGlobalPlugins = queuesOrOptions.globalPlugins || [];
      finalDashboard = queuesOrOptions.dashboard;
    } else {
      if (!workerDefs || !registry || !storageAdapters) {
        throw new Error(
          'When using positional parameters, queues, workers, registry, and storageAdapters are required'
        );
      }
      queues = queuesOrOptions;
      finalWorkers = workerDefs;
      finalRegistry = registry;
      finalStorageAdapters = storageAdapters;
      finalGlobalPlugins = globalPlugins || [];
      finalDashboard = undefined;
    }

    // Initialize JobManager internally
    this.jobManager = new JobManager(
      queues,
      finalWorkers,
      finalRegistry,
      finalStorageAdapters,
      finalGlobalPlugins,
      this.lifecycleEvents
    );
    this.batchManager = new BatchManager();
    this.jobManager.setBatchManager(this.batchManager);

    // Store for reference
    this.queues = queues;
    this.workerDefs = finalWorkers;
    this.storageAdapters = finalStorageAdapters;
    this.dashboardOptions = finalDashboard;

    for (const [workerName, workerDef] of Object.entries(finalWorkers)) {
      this.desiredWorkerScaling.set(workerName, workerDef.concurrency || 1);
    }

    this.lifecycleEvents.subscribe((event) => {
      this.updateReliabilityState(event);
    });
  }

  private queues: Record<string, QueueConfig>;
  private workerDefs: Record<string, WorkerConfig>;
  private storageAdapters: Record<string, QueueStorage>;

  private isOptions(obj: any): obj is SupervisorOptions {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'queues' in obj &&
      'workers' in obj &&
      'registry' in obj &&
      'storageAdapters' in obj
    );
  }

  async start(mode: SupervisorMode = 'worker') {
    this.mode = mode;
    this.running = true;

    await this.jobManager.recoverRepeatableSchedules();

    // Start scheduled job promoter (Phase 1.1)
    const defaultStorageKey = Object.keys(this.storageAdapters)[0];
    if (defaultStorageKey && this.storageAdapters[defaultStorageKey]) {
      this.promoter = new ScheduledJobPromoter(
        this.storageAdapters[defaultStorageKey]!,
        this.queues,
        1000,
        [], // Global plugins would be passed here
        this.lifecycleEvents
      );
      this.promoter.start();
    }

    if (this.mode === 'worker') {
      for (const [name, config] of Object.entries(this.workerDefs)) {
        this.workers.set(name, []);
        this.scaleWorker(name, config);
      }

      this.monitor();
    }
  }

  async monitor() {
    while (this.running) {
      for (const [name, config] of Object.entries(this.workerDefs)) {
        const depth = await this.getQueueDepth(config.queues);

        const target = this.calculateConcurrency(depth, config, name);

        this.scaleTo(name, config, target);
      }

      await sleep(2000);
    }
  }

  async getQueueDepth(queueNames: string[]) {
    let total = 0;

    for (const q of queueNames) {
      const config = this.queues[q];
      if (!config) {
        continue;
      }

      const storage = this.storageAdapters[config.connection];
      if (!storage) {
        continue;
      }

      total += await storage.getQueueDepth(q);
    }

    return total;
  }

  /**
   * Report job progress (0–100) from outside the job handler (e.g. HTTP routes).
   * Persists to storage and emits `onProgress` plugin hooks.
   */
  async setJobProgress(jobId: string, queueName: string, progress: number): Promise<void> {
    return this.jobManager.setProgress(jobId, queueName, progress);
  }

  async queryDeferredJobs(query: DeferredJobsQuery = {}): Promise<StoredJob[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: StoredJob[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) {
        continue;
      }

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) {
        continue;
      }

      const jobs = await storage.queryDeferredJobs({
        queueName,
        ...(query.status !== undefined ? { status: query.status } : {}),
      });

      merged.push(...jobs);
    }

    merged.sort((a, b) => {
      const aTime = a.delayUntil ?? a.createdAt;
      const bTime = b.delayUntil ?? b.createdAt;
      if (aTime === bTime) {
        return a.id.localeCompare(b.id);
      }
      return aTime - bTime;
    });

    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  async getDLQ(query: DeadLetterQuery = {}): Promise<StoredJob[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: StoredJob[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) continue;

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) continue;

      const jobs = await storage.getDeadLetterJobs({ queueName });
      merged.push(...jobs);
    }

    merged.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  async getCompletedJobs(query: CompletedJobsQuery = {}): Promise<CompletedJobRecord[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: CompletedJobRecord[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) continue;

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) continue;

      if (typeof (storage as QueueStorage & { getCompletedJobs?: unknown }).getCompletedJobs !== 'function') {
        continue;
      }

      const jobs = await storage.getCompletedJobs({ queueName });
      merged.push(...jobs);
    }

    merged.sort((a, b) => b.completedAt - a.completedAt);
    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  async queryJobArchive(query: JobArchiveQuery = {}): Promise<CompletedJobRecord[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: CompletedJobRecord[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) continue;

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) continue;

      const queryArchive = (storage as QueueStorage & { queryJobArchive?: unknown }).queryJobArchive;
      if (typeof queryArchive === 'function') {
        const jobs = await queryArchive.call(storage, { ...query, queueName });
        merged.push(...jobs);
        continue;
      }

      if (typeof (storage as QueueStorage & { getCompletedJobs?: unknown }).getCompletedJobs === 'function') {
        const jobs = await storage.getCompletedJobs({ queueName });
        const filtered = jobs.filter((job) => this.matchesArchiveFilter(job, query));
        merged.push(...filtered);
      }
    }

    merged.sort((a, b) => b.completedAt - a.completedAt);
    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  setArchiveRetentionPolicy(policy: ArchiveRetentionPolicy): void {
    for (const storage of Object.values(this.storageAdapters)) {
      const setPolicy = (storage as QueueStorage & { setArchiveRetentionPolicy?: unknown }).setArchiveRetentionPolicy;
      if (typeof setPolicy === 'function') {
        setPolicy.call(storage, policy);
      }
    }
  }

  pauseQueue(queueName: string): boolean {
    if (!this.queues[queueName]) {
      return false;
    }

    this.pausedQueues.add(queueName);
    this.lifecycleEvents.emit({
      type: 'queue.paused',
      queueName,
    });
    return true;
  }

  resumeQueue(queueName: string): boolean {
    if (!this.queues[queueName]) {
      return false;
    }

    this.pausedQueues.delete(queueName);
    this.lifecycleEvents.emit({
      type: 'queue.resumed',
      queueName,
    });
    return true;
  }

  subscribeLifecycleEvents(listener: (event: QueueLifecycleEvent) => void): () => void {
    return this.lifecycleEvents.subscribe(listener);
  }

  getRecentLifecycleEvents(limit = 100): QueueLifecycleEvent[] {
    return this.lifecycleEvents.getRecent(limit);
  }

  isQueuePaused(queueName: string): boolean {
    return this.pausedQueues.has(queueName);
  }

  getPausedQueues(): string[] {
    return [...this.pausedQueues.values()];
  }

  async drainQueue(
    queueName: string,
    options: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      pauseFirst?: boolean;
    } = {}
  ): Promise<boolean> {
    if (!this.queues[queueName]) {
      return false;
    }

    const pauseFirst = options.pauseFirst !== false;
    if (pauseFirst) {
      this.pauseQueue(queueName);
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const active = await this.getActiveJobs({ queueName, limit: 1 });
      if (active.length === 0) {
        this.lifecycleEvents.emit({
          type: 'queue.drained',
          queueName,
        });
        return true;
      }

      await sleep(pollIntervalMs);
    }

    return false;
  }

  async getQueueStatus(queueName: string): Promise<{
    queueName: string;
    paused: boolean;
    depth: number;
    ready: number;
    active: number;
    deferred: number;
    failed: number;
  } | null> {
    if (!this.queues[queueName]) {
      return null;
    }

    const [depth, ready, active, deferred, failed] = await Promise.all([
      this.getQueueDepth([queueName]),
      this.getReadyJobs({ queueName }).then((jobs) => jobs.length),
      this.getActiveJobs({ queueName }).then((jobs) => jobs.length),
      this.queryDeferredJobs({ queueName, status: 'pending' }).then((jobs) => jobs.length),
      this.getDLQ({ queueName }).then((jobs) => jobs.length),
    ]);

    return {
      queueName,
      paused: this.isQueuePaused(queueName),
      depth,
      ready,
      active,
      deferred,
      failed,
    };
  }

  async retryDLQ(queueName: string, jobId: string): Promise<boolean> {
    const queueConfig = this.queues[queueName];
    if (!queueConfig) return false;

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) return false;

    return storage.retryDeadLetterJob(queueName, jobId);
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    const queueConfig = this.queues[queueName];
    if (!queueConfig) return false;

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) return false;

    if (typeof storage.promoteJob === 'function') {
      const promoted = await storage.promoteJob(queueName, jobId);
      if (promoted) {
        this.lifecycleEvents.emit({
          type: 'job.promoted',
          queueName,
          jobId,
        });
      }
      return promoted;
    }

    const pending = await storage.queryDeferredJobs({ queueName, status: 'pending', limit: 5000 });
    if (!pending.some((job) => job.id === jobId)) {
      return false;
    }

    await storage.moveJobToQueue(queueName, jobId, 'active');
    this.lifecycleEvents.emit({
      type: 'job.promoted',
      queueName,
      jobId,
    });
    return true;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const queueConfig = this.queues[queueName];
    if (!queueConfig) return false;

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) return false;

    if (typeof storage.removeJob === 'function') {
      return storage.removeJob(queueName, jobId);
    }

    const candidates = await Promise.all([
      storage.getReadyJobs({ queueName, limit: 5000 }),
      storage.getActiveJobs({ queueName, limit: 5000 }),
      storage.queryDeferredJobs({ queueName, limit: 5000 }),
    ]);

    if (candidates.some((list) => list.some((job) => job.id === jobId))) {
      await storage.ack(jobId);
      return true;
    }

    return false;
  }

  async cleanJobs(queueName: string, options: QueueCleanOptions = {}): Promise<number> {
    const queueConfig = this.queues[queueName];
    if (!queueConfig) return 0;

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) return 0;

    if (typeof storage.cleanJobs === 'function') {
      const removed = await storage.cleanJobs(queueName, options);
      this.lifecycleEvents.emit({
        type: 'queue.cleaned',
        queueName,
        removed,
      });
      return removed;
    }

    const limit = options.limit ?? 1000;
    const graceMs = options.graceMs ?? 0;
    const cutoff = Date.now() - Math.max(0, graceMs);
    const status = options.status ?? 'all';

    const statuses: QueueAdminJobStatus[] =
      status === 'all' ? ['ready', 'active', 'deferred', 'failed', 'completed'] : [status];

    let removed = 0;

    for (const currentStatus of statuses) {
      if (removed >= limit) break;

      if (currentStatus === 'failed' || currentStatus === 'completed') {
        continue;
      }

      const remaining = limit - removed;
      const jobs =
        currentStatus === 'ready'
          ? await storage.getReadyJobs({ queueName, limit: remaining })
          : currentStatus === 'active'
            ? await storage.getActiveJobs({ queueName, limit: remaining })
            : await storage.queryDeferredJobs({ queueName, limit: remaining });

      for (const job of jobs) {
        if (removed >= limit) break;
        const when = job.updatedAt ?? job.createdAt;
        if (when > cutoff) continue;

        const ok = await this.removeJob(queueName, job.id);
        if (ok) removed += 1;
      }
    }

    this.lifecycleEvents.emit({
      type: 'queue.cleaned',
      queueName,
      removed,
    });
    return removed;
  }

  async obliterateQueue(queueName: string): Promise<number> {
    const queueConfig = this.queues[queueName];
    if (!queueConfig) return 0;

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) return 0;

    if (typeof storage.obliterateQueue === 'function') {
      const removed = await storage.obliterateQueue(queueName);
      this.lifecycleEvents.emit({
        type: 'queue.obliterated',
        queueName,
        removed,
      });
      return removed;
    }

    const removed = await this.cleanJobs(queueName, {
      status: 'all',
      graceMs: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    this.lifecycleEvents.emit({
      type: 'queue.obliterated',
      queueName,
      removed,
    });
    return removed;
  }

  getBatches() {
    return this.batchManager.listBatches();
  }

  async dispatchFlow(nodes: FlowNodeInput[], options?: { flowId?: string; atomicFailure?: boolean }): Promise<FlowState> {
    return this.jobManager.dispatchFlow(nodes, options);
  }

  getFlow(flowId: string): FlowState | undefined {
    return this.jobManager.getFlow(flowId);
  }

  listFlows(): FlowState[] {
    return this.jobManager.listFlows();
  }

  getBatch(batchId: string) {
    return this.batchManager.getBatch(batchId);
  }

  async retryFailedBatchJobs(batchId: string): Promise<number> {
    const batch = this.batchManager.getBatch(batchId);
    if (!batch) return 0;

    let retried = 0;

    for (const job of batch.jobs.filter((item) => item.state === 'failed')) {
      const ok = await this.retryDLQ(job.queue, job.id);
      if (ok) {
        this.batchManager.markJobRetried(batchId, job.id);
        retried += 1;
      }
    }

    return retried;
  }

  async getReadyJobs(query: { queueName?: string; limit?: number; offset?: number } = {}): Promise<StoredJob[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: StoredJob[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) continue;

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) continue;

      if (typeof (storage as QueueStorage & { getReadyJobs?: unknown }).getReadyJobs !== 'function') {
        continue;
      }

      const jobs = await storage.getReadyJobs({ queueName });
      merged.push(...jobs);
    }

    merged.sort((a, b) => {
      const aTime = a.delayUntil ?? a.createdAt;
      const bTime = b.delayUntil ?? b.createdAt;
      if (aTime === bTime) {
        return a.id.localeCompare(b.id);
      }
      return aTime - bTime;
    });

    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  async getActiveJobs(query: { queueName?: string; limit?: number; offset?: number } = {}): Promise<StoredJob[]> {
    const queueNames = query.queueName ? [query.queueName] : Object.keys(this.queues);
    const merged: StoredJob[] = [];

    for (const queueName of queueNames) {
      const queueConfig = this.queues[queueName];
      if (!queueConfig) continue;

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) continue;

      if (typeof (storage as QueueStorage & { getActiveJobs?: unknown }).getActiveJobs !== 'function') {
        continue;
      }

      const jobs = await storage.getActiveJobs({ queueName });
      merged.push(...jobs);
    }

    merged.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const offset = query.offset ?? 0;
    const end = query.limit != null ? offset + query.limit : undefined;
    return merged.slice(offset, end);
  }

  setWorkerScaling(workerName: string, concurrency: number): void {
    const workerDef = this.workerDefs[workerName];
    if (!workerDef || !Number.isFinite(concurrency) || concurrency <= 0) {
      return;
    }

    const rounded = Math.floor(concurrency);
    this.desiredWorkerScaling.set(workerName, rounded);

    if (this.running && this.mode === 'worker') {
      this.scaleTo(workerName, workerDef, rounded);
    }
  }

  getWorkerDefinitions(): Record<string, WorkerConfig> {
    return this.workerDefs;
  }

  getQueueNames(): string[] {
    return Object.keys(this.queues);
  }

  getQueueConfig(queueName: string): QueueConfig | undefined {
    return this.queues[queueName];
  }

  getReliabilitySnapshot(): {
    openCircuits: number;
    halfOpenCircuits: number;
    backpressuredQueues: number;
    queues: QueueReliabilityStatus[];
  } {
    const queues = Array.from(this.reliabilityStatus.values())
      .sort((left, right) => left.queueName.localeCompare(right.queueName));

    return {
      openCircuits: queues.filter((queue) => queue.circuitState === 'open').length,
      halfOpenCircuits: queues.filter((queue) => queue.circuitState === 'half-open').length,
      backpressuredQueues: queues.filter((queue) => queue.backpressureActive).length,
      queues,
    };
  }

  private matchesArchiveFilter(job: CompletedJobRecord, query: JobArchiveQuery): boolean {
    if (query.jobName && job.name !== query.jobName) return false;
    if (query.fromTs != null && job.completedAt < query.fromTs) return false;
    if (query.toTs != null && job.completedAt > query.toTs) return false;

    if (query.search) {
      const haystack = [job.id, job.name, job.queue, this.safeJson(job.payload), this.safeJson(job.result)]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query.search.toLowerCase())) {
        return false;
      }
    }

    return true;
  }

  private safeJson(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  getDashboardOptions(): DashboardOptions | undefined {
    return this.dashboardOptions;
  }

  getDesiredWorkerScaling(): Record<string, number> {
    return Object.fromEntries(this.desiredWorkerScaling);
  }

  calculateConcurrency(depth: number, config: any, workerName?: string) {
    if (workerName) {
      const forced = this.desiredWorkerScaling.get(workerName);
      if (forced && forced > 0) {
        return forced;
      }
    }

    const base = config.concurrency || 1;

    if (depth > 1000) return base * 5;
    if (depth > 100) return base * 3;
    if (depth > 10) return base * 2;

    return base;
  }

  scaleTo(name: string, config: any, target: number) {
    const current = this.workers.get(name);

    if (!current) {
      return;
    }

    if (current.length < target) {
      const toAdd = target - current.length;

      for (let i = 0; i < toAdd; i++) {
        this.spawnWorker(name, config);
      }
    }

    if (current.length > target) {
      const toRemove = current.length - target;

      for (let i = 0; i < toRemove; i++) {
        const worker = current.pop();
        worker.stop();
        this.lifecycleEvents.emit({
          type: 'worker.stopped',
          workerName: name,
        });
      }
    }
  }

  spawnWorker(name: string, config: any) {
    const worker = new ResilientWorker(
      name,
      config,
      this.jobManager,
      this.storageAdapters,
      this.queues,
      (queueName) => !this.pausedQueues.has(queueName),
      (event) => {
        this.lifecycleEvents.emit(event);
      }
    );

    this.workers.get(name)?.push(worker);

    worker.start();
    this.lifecycleEvents.emit({
      type: 'worker.started',
      workerName: name,
    });
  }

  scaleWorker(name: string, config: any) {
    const initial = config.concurrency || 1;

    for (let i = 0; i < initial; i++) {
      this.spawnWorker(name, config);
    }
  }

  stop() {
    this.running = false;
    this.mode = 'worker';
    
    // Stop scheduled job promoter
    this.promoter?.stop();
    this.jobManager.stopSchedules();

    for (const workers of this.workers.values()) {
      for (const w of workers) {
        w.stop();
        this.lifecycleEvents.emit({
          type: 'worker.stopped',
        });
      }
    }

    this.workers.clear();
  }

  private updateReliabilityState(event: QueueLifecycleEvent): void {
    const queueName = event.queueName;
    if (!queueName) {
      return;
    }

    const current = this.reliabilityStatus.get(queueName) ?? {
      queueName,
      backpressureActive: false,
      circuitState: 'closed' as const,
      updatedAt: event.timestamp,
    };

    if (event.type === 'queue.backpressure') {
      current.backpressureActive = true;
      current.updatedAt = event.timestamp;
      this.reliabilityStatus.set(queueName, current);
      return;
    }

    if (event.type === 'queue.backpressure.cleared') {
      current.backpressureActive = false;
      current.updatedAt = event.timestamp;
      this.reliabilityStatus.set(queueName, current);
      return;
    }

    if (event.type === 'queue.circuit.changed' && event.circuitState) {
      current.circuitState = event.circuitState;
      current.updatedAt = event.timestamp;
      this.reliabilityStatus.set(queueName, current);
    }
  }
}
