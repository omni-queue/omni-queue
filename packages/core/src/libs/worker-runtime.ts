/* eslint-disable @typescript-eslint/no-explicit-any */
import cron from 'node-cron';
import { JobRegistry } from './registry';
import { runWithIsolation } from './isolation';
import {
  ExecutionContext,
  FlowNodeInput,
  FlowNodeState,
  FlowState,
  IsolationType,
  RepeatableScheduleDefinition,
  StoredJob,
  DispatchOptions,
  ScheduleOptions,
  ScheduledJobHandle,
} from '../types';
import { QueueConfig } from '../interfaces/queue-config';
import { WorkerConfig } from '../interfaces/worker-config';
import { QueueStorage } from '../interfaces/queue-storage';
import { priorityScore, sleep } from '../utils';
import { PooledExecutor } from './pooled-executor';
import { Plugin } from '../interfaces/plugin';
import { BatchManager } from './batch-manager';
import { JobNode } from './job-node';
import { LifecycleEventBus } from './lifecycle-events';
import {
  DEDUPE_QUERY_LIMIT,
  type DagPluginLike,
  type FlowRuntime,
  type FlowRuntimeNode,
  type ManagedScheduleTask,
} from './worker-runtime/internal-types';
import {
  isTimeoutError,
  resolveConfiguredMaxAttempts,
  resolveExecutionTimeoutMs,
  resolveRetryBackoff,
  resolveRetryDecision,
  toErrorDetails,
  toExecutionError,
} from './worker-runtime/retry-helpers';
import {
  findFailedIdempotencyMatch,
  listPersistedRepeatableSchedules,
  persistRepeatableSchedule,
  removePersistedRepeatableSchedule,
} from './worker-runtime/repeatable-storage';

export class JobManager {
  private static readonly BATCH_DISPATCH_CHUNK_SIZE = 64;
  private static readonly DEFAULT_BULK_DISPATCH_CHUNK_SIZE = 256;

  private bulkDispatchChunkSize: number;

  private executors: Map<string, PooledExecutor> = new Map();
  private workerConfigsByQueue: Map<string, WorkerConfig> = new Map();
  private scheduledTasks: Map<string, ManagedScheduleTask> = new Map();
  private batchManager?: BatchManager;
  private flows = new Map<string, FlowRuntime>();
  private flowNodeByJobId = new Map<string, { flowId: string; nodeId: string }>();

  constructor(
    private queues: Record<string, QueueConfig>,
    workers: Record<string, WorkerConfig>,
    private registry: JobRegistry,
    private storageAdapters: Record<string, QueueStorage>,
    private globalPlugins: Plugin[] = [],
    private lifecycleEvents?: LifecycleEventBus,
    runtimeOptions?: { bulkDispatchChunkSize?: number }
  ) {
    this.bulkDispatchChunkSize =
      typeof runtimeOptions?.bulkDispatchChunkSize === 'number' && Number.isFinite(runtimeOptions.bulkDispatchChunkSize)
        ? Math.max(1, Math.floor(runtimeOptions.bulkDispatchChunkSize))
        : JobManager.DEFAULT_BULK_DISPATCH_CHUNK_SIZE;

    for (const [queueName, cfg] of Object.entries(queues)) {
      this.executors.set(queueName, new PooledExecutor(cfg.concurrency || 5));
    }

    for (const workerConfig of Object.values(workers)) {
      for (const queueName of workerConfig.queues) {
        if (!this.workerConfigsByQueue.has(queueName)) {
          this.workerConfigsByQueue.set(queueName, workerConfig);
        }
      }
    }
  }

  resolveQueueConfig(queueName: string) {
    const config = this.queues[queueName];
    if (!config) throw new Error(`Queue not defined: ${queueName}`);
    return config;
  }

  resolveWorkerConfig(queueName: string): WorkerConfig | undefined {
    return this.workerConfigsByQueue.get(queueName);
  }

  getStorage(queueConfig: any): QueueStorage {
    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) throw new Error(`Storage adapter not found: ${queueConfig.connection}`);
    return storage;
  }

  // dispatch job to storage
  async dispatch(job: any, options?: DispatchOptions) {
    return this.dispatchInternal(job, options);
  }

  async dispatchMany(jobs: any[]): Promise<string[]> {
    if (!jobs?.length) return [];

    const ids: string[] = [];
    const chunkSize = this.bulkDispatchChunkSize;
    const continueOnError = true;

    const queueContexts = new Map<string, {
      storage: QueueStorage;
      enqueueHooks: Array<{ onEnqueue: (job: any) => Promise<void> }>;
    }>();
    const queueNames: string[] = new Array(jobs.length);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const queueName = job.queue();
      queueNames[i] = queueName;
      if (queueContexts.has(queueName)) continue;

      const queueConfig = this.resolveQueueConfig(queueName);
      const storage = this.getStorage(queueConfig);

      const queuePlugins = queueConfig.plugins || [];
      const allPlugins = queuePlugins.length === 0
        ? this.globalPlugins
        : this.globalPlugins.length === 0
          ? queuePlugins
          : [...queuePlugins, ...this.globalPlugins];

      const enqueueHooks = allPlugins.filter(
        (plugin): plugin is { onEnqueue: (job: any) => Promise<void> } =>
          typeof plugin.onEnqueue === 'function'
      );

      queueContexts.set(queueName, { storage, enqueueHooks });
    }

    const effectiveChunkSize = Math.min(jobs.length, chunkSize);
    const numChunks = Math.ceil(jobs.length / effectiveChunkSize);

    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const start = chunkIndex * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, jobs.length);

      const jobsByStorage = new Map<QueueStorage, StoredJob[]>();
      const hookPromises: Promise<void>[] = [];
      const now = Date.now();
      const shouldEmitLifecycle = this.lifecycleEvents != null;

      for (let i = start; i < end; i++) {
        const job = jobs[i];
        const queueName = queueNames[i]!;
        const context = queueContexts.get(queueName)!;

        if (context.enqueueHooks.length > 0) {
          for (const plugin of context.enqueueHooks) {
            hookPromises.push(plugin.onEnqueue(job));
          }
        }

        const storedJob: StoredJob = {
          id: crypto.randomUUID(),
          name: job.jobName,
          payload: job.payload,
          queue: queueName,
          attempts: 0,
          state: 'queued',
          createdAt: now,
          updatedAt: now,
        };

        const queueTag = `queue:${queueName}`;
        const jobTag = `job:${job.jobName}`;
        const extraTags = typeof job.tags === 'function' ? job.tags() : undefined;
        if (extraTags != null && extraTags.length > 0) {
          storedJob.tags = Array.from(new Set([queueTag, jobTag, ...extraTags]));
        } else {
          storedJob.tags = [queueTag, jobTag];
        }

        // Group by storage
        let bucket = jobsByStorage.get(context.storage);
        if (!bucket) {
          bucket = [];
          jobsByStorage.set(context.storage, bucket);
        }

        bucket.push(storedJob);
      }

      // Run all onEnqueue hooks in parallel
      if (hookPromises.length > 0) {
        try {
          await Promise.all(hookPromises);
        } catch (err) {
          if (!continueOnError) throw err;
          console.error('Some onEnqueue hooks failed:', err);
        }
      }

      // Enqueue per storage
      for (const [storage, storedJobs] of jobsByStorage) {
        if (storedJobs.length === 0) continue;

        try {
          if (typeof storage.enqueueBatch === 'function') {
            await storage.enqueueBatch(storedJobs);
          } else {
            // Simple fallback — all concurrent (no limiter)
            await Promise.all(storedJobs.map((sj) => storage.enqueue(sj)));
          }
        } catch (err) {
          if (!continueOnError) throw err;
          console.error(`Failed to enqueue to storage:`, err);
        }

        // Record IDs and emit events
        for (const storedJob of storedJobs) {
          ids.push(storedJob.id);
          if (shouldEmitLifecycle) {
            this.lifecycleEvents?.emit({
              type: 'job.enqueued',
              queueName: storedJob.queue,
              jobId: storedJob.id,
              jobName: storedJob.name,
            });
          }
        }
      }
    }

    return ids;
  }

  setBatchManager(batchManager: BatchManager): void {
    this.batchManager = batchManager;
  }

  async dispatchBatch(name: string, jobs: any[]): Promise<string> {
    if (!this.batchManager) {
      throw new Error('Batch manager is not configured');
    }

    if (!jobs?.length) {
      const batchId = crypto.randomUUID();
      this.batchManager.registerBatch(batchId, name, []);
      return batchId;
    }

    const batchId = crypto.randomUUID();
    const chunkSize = JobManager.BATCH_DISPATCH_CHUNK_SIZE;
    const continueOnError = true;

    for (let start = 0; start < jobs.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, jobs.length);
      const dispatchPromises: Promise<string>[] = [];
      const chunkPlannedJobs: Array<{
        id: string;
        name: string;
        queue: string;
        payload: unknown;
      }> = [];

      for (let i = start; i < end; i++) {
        const job = jobs[i];

        const jobId = crypto.randomUUID();

        // Prepare minimal metadata for this single job
        const plannedJob = {
          id: jobId,
          name: job.jobName,
          queue: job.queue(),
          payload: job.payload,
        };

        chunkPlannedJobs.push(plannedJob);

        // Dispatch immediately
        dispatchPromises.push(
          this.dispatchInternal(job, {
            jobId,
            batchId,
            batchName: name,
            batchIndex: i,
          }).catch((err) => {
            if (!continueOnError) throw err;
            console.error(`Failed to dispatch job ${i} in batch ${batchId}:`, err);
            return '';
          })
        );
      }

      await Promise.all(dispatchPromises);

      this.batchManager.registerBatch(batchId, name, chunkPlannedJobs);
    }

    return batchId;
  }

  async dispatchFlow(
    nodes: FlowNodeInput[],
    options?: { flowId?: string; atomicFailure?: boolean }
  ): Promise<FlowState> {
    const flowId = options?.flowId ?? crypto.randomUUID();
    const atomicFailure = options?.atomicFailure !== false;

    const runtimeNodes = new Map<string, FlowRuntimeNode>();

    for (const node of nodes) {
      if (runtimeNodes.has(node.id)) {
        throw new Error(`Duplicate flow node id: ${node.id}`);
      }

      runtimeNodes.set(node.id, {
        id: node.id,
        job: node.job,
        dependsOn: new Set(node.dependsOn ?? []),
        children: new Set<string>(),
        status: 'pending',
      });
    }

    for (const node of runtimeNodes.values()) {
      for (const dependencyId of node.dependsOn) {
        const dependency = runtimeNodes.get(dependencyId);
        if (!dependency) {
          throw new Error(`Flow node '${node.id}' depends on unknown node '${dependencyId}'`);
        }
        dependency.children.add(node.id);
      }
    }

    const runtime: FlowRuntime = {
      id: flowId,
      atomicFailure,
      nodes: runtimeNodes,
      dagNodes: new Map<string, JobNode>(),
    };

    this.flows.set(flowId, runtime);

    const roots = [...runtimeNodes.values()].filter((node) => node.dependsOn.size === 0);
    await Promise.all(roots.map((root) => this.dispatchFlowNode(runtime, root)));

    return this.getFlow(flowId) as FlowState;
  }

  getFlow(flowId: string): FlowState | undefined {
    const runtime = this.flows.get(flowId);
    if (!runtime) {
      return undefined;
    }

    const nodes: FlowNodeState[] = [...runtime.nodes.values()].map((node) => ({
      id: node.id,
      jobName: node.job.jobName,
      queue: node.job.queue(),
      status: node.status,
      dependsOn: [...node.dependsOn],
      children: [...node.children],
      ...(node.jobId ? { jobId: node.jobId } : {}),
      ...(node.error ? { error: node.error } : {}),
    }));

    return {
      id: runtime.id,
      atomicFailure: runtime.atomicFailure,
      nodes,
    };
  }

  listFlows(): FlowState[] {
    return [...this.flows.keys()]
      .map((flowId) => this.getFlow(flowId))
      .filter((flow): flow is FlowState => Boolean(flow));
  }

  async schedule(job: any, options: ScheduleOptions): Promise<ScheduledJobHandle> {
    const configuredOptions = [options.pattern, options.intervalMs, options.runAt].filter(
      (value) => value !== undefined
    );

    if (configuredOptions.length !== 1) {
      throw new Error('Exactly one scheduling mode must be provided: pattern, intervalMs, or runAt');
    }

    const queueName = job.queue();
    const queueConfig = this.resolveQueueConfig(queueName);
    const storage = this.getStorage(queueConfig);
    const allPlugins = [...(queueConfig.plugins || []), ...this.globalPlugins];
    const scheduleId = crypto.randomUUID();

    const emitScheduleCreated = async (pattern: string) => {
      for (const plugin of allPlugins) {
        if (plugin.onScheduleCreated) {
          await plugin.onScheduleCreated(job.jobName, pattern);
        }
      }
    };

    if (options.runAt !== undefined) {
      await emitScheduleCreated(`at:${options.runAt}`);
      this.lifecycleEvents?.emit({
        type: 'schedule.created',
        queueName,
        jobName: job.jobName,
        scheduleId,
        schedulePattern: `at:${options.runAt}`,
        scheduleAt: options.runAt,
      });
      await this.dispatchInternal(
        job,
        { delayUntil: options.runAt },
        { lastScheduledAt: options.runAt }
      );

      return {
        id: scheduleId,
        stop() {
          // one-time schedules are materialized as delayed jobs immediately
        },
      };
    }

    const durable = options.durable !== false;
    const definition: RepeatableScheduleDefinition = {
      id: scheduleId,
      queue: queueName,
      jobName: job.jobName,
      payload: job.payload,
      ...(options.pattern !== undefined ? { pattern: options.pattern } : {}),
      ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (options.intervalMs !== undefined) {
      await emitScheduleCreated(`every:${options.intervalMs}ms`);
      this.lifecycleEvents?.emit({
        type: 'schedule.created',
        queueName,
        jobName: job.jobName,
        scheduleId,
        schedulePattern: `every:${options.intervalMs}ms`,
      });
      if (durable) {
        await persistRepeatableSchedule(storage, definition);
      }
      return this.startIntervalSchedule(definition, storage, durable);
    }

    const cronPattern = options.pattern;
    if (!cronPattern) {
      throw new Error('Cron pattern is required for pattern-based scheduling');
    }

    await emitScheduleCreated(cronPattern);
    this.lifecycleEvents?.emit({
      type: 'schedule.created',
      queueName,
      jobName: job.jobName,
      scheduleId,
      schedulePattern: cronPattern,
    });
    if (durable) {
      await persistRepeatableSchedule(storage, definition);
    }
    return this.startCronSchedule(definition, storage, durable);
  }

  async recoverRepeatableSchedules(): Promise<number> {
    const recoveredDefinitions = new Map<string, { definition: RepeatableScheduleDefinition; storage: QueueStorage }>();
    const prunedDefinitions = new Set<string>();

    for (const queueConfig of Object.values(this.queues)) {
      const storage = this.getStorage(queueConfig);
      const definitions = await listPersistedRepeatableSchedules(storage);
      for (const definition of definitions) {
        if (!this.queues[definition.queue] || !this.registry.has(definition.jobName)) {
          if (!prunedDefinitions.has(definition.id)) {
            prunedDefinitions.add(definition.id);
            await removePersistedRepeatableSchedule(storage, definition.id);
          }
          continue;
        }

        if (!recoveredDefinitions.has(definition.id)) {
          recoveredDefinitions.set(definition.id, { definition, storage });
        }
      }
    }

    for (const [scheduleId, recovered] of recoveredDefinitions) {
      if (this.scheduledTasks.has(scheduleId)) {
        continue;
      }

      if (recovered.definition.intervalMs !== undefined) {
        this.startIntervalSchedule(recovered.definition, recovered.storage, true);
        continue;
      }

      if (recovered.definition.pattern !== undefined) {
        this.startCronSchedule(recovered.definition, recovered.storage, true);
      }
    }

    return recoveredDefinitions.size;
  }

  async listRepeatableSchedules(): Promise<RepeatableScheduleDefinition[]> {
    const definitions = new Map<string, RepeatableScheduleDefinition>();

    for (const task of this.scheduledTasks.values()) {
      definitions.set(task.definition.id, task.definition);
    }

    const inspectedStorage = new Set<QueueStorage>();
    for (const queueConfig of Object.values(this.queues)) {
      const storage = this.getStorage(queueConfig);
      if (inspectedStorage.has(storage)) {
        continue;
      }

      inspectedStorage.add(storage);
      const persisted = await listPersistedRepeatableSchedules(storage);
      for (const definition of persisted) {
        definitions.set(definition.id, definition);
      }
    }

    return [...definitions.values()].sort((left, right) => {
      if (left.updatedAt === right.updatedAt) {
        return left.id.localeCompare(right.id);
      }

      return right.updatedAt - left.updatedAt;
    });
  }

  async removeRepeatableSchedule(scheduleId: string): Promise<boolean> {
    let removed = false;
    const task = this.scheduledTasks.get(scheduleId);

    if (task) {
      task.handle.stop();
      removed = true;
    }

    const inspectedStorage = new Set<QueueStorage>();
    for (const queueConfig of Object.values(this.queues)) {
      const storage = this.getStorage(queueConfig);
      if (inspectedStorage.has(storage)) {
        continue;
      }

      inspectedStorage.add(storage);
      const persisted = await listPersistedRepeatableSchedules(storage);
      if (persisted.some((definition) => definition.id === scheduleId)) {
        await removePersistedRepeatableSchedule(storage, scheduleId);
        removed = true;
      }
    }

    return removed;
  }

  async clearRepeatableSchedules(): Promise<number> {
    const definitions = await this.listRepeatableSchedules();
    let removed = 0;

    for (const definition of definitions) {
      const didRemove = await this.removeRepeatableSchedule(definition.id);
      if (didRemove) {
        removed += 1;
      }
    }

    return removed;
  }

  stopSchedules(): void {
    for (const task of this.scheduledTasks.values()) {
      task.handle.stop();
    }
    this.scheduledTasks.clear();
  }

  /**
   * Report job progress (0–100). Persists to storage and emits `onProgress` plugin hooks.
   * Can be called externally (e.g. from HTTP routes) for any leased job.
   */
  async setProgress(jobId: string, queueName: string, progress: number): Promise<void> {
    const queueConfig = this.resolveQueueConfig(queueName);
    const storage = this.getStorage(queueConfig);
    await storage.setJobProgress(jobId, progress);
    const allPlugins = [...(queueConfig.plugins || []), ...this.globalPlugins];
    for (const plugin of allPlugins) {
      if (plugin.onProgress) await plugin.onProgress(jobId, queueName, progress);
    }
    this.lifecycleEvents?.emit({
      type: 'job.progress',
      queueName,
      jobId,
      progress,
    });
  }

  private async dispatchInternal(
    job: any,
    options?: DispatchOptions,
    scheduleMetadata?: Pick<StoredJob, 'scheduledCron' | 'lastScheduledAt' | 'repeatScheduleId' | 'repeatIntervalMs'>
  ): Promise<string> {
    const queueName = job.queue();
    const queueConfig = this.resolveQueueConfig(queueName);
    const storage = this.getStorage(queueConfig);
    const queuePlugins = queueConfig.plugins || [];
    const allPlugins =
      queuePlugins.length === 0
        ? this.globalPlugins
        : this.globalPlugins.length === 0
          ? queuePlugins
          : [...queuePlugins, ...this.globalPlugins];
    const enqueueHooks = allPlugins.filter((plugin) => typeof plugin.onEnqueue === 'function');
    const delayedHooks = allPlugins.filter((plugin) => typeof plugin.onJobDelayed === 'function');
    const prioritizedHooks = allPlugins.filter((plugin) => typeof plugin.onJobPrioritized === 'function');
    const now = Date.now();

    const idempotencyKey = options?.idempotencyKey?.trim();
    const dedupeWindowMs = queueConfig.idempotency?.dedupeWindowMs;
    if (idempotencyKey && dedupeWindowMs != null && dedupeWindowMs > 0) {
      const duplicateJobId = await this.findDuplicateByIdempotencyKey(storage, {
        queueName,
        idempotencyKey,
        dedupeWindowMs,
        includeFailed: queueConfig.idempotency?.includeFailed === true,
      });

      if (duplicateJobId) {
        return duplicateJobId;
      }
    }

    // Determine delay timing
    let delayUntil: number | undefined;
    if (options?.delayUntil !== undefined) {
      delayUntil = options.delayUntil;
    } else if (options?.delayMs !== undefined) {
      delayUntil = now + options.delayMs;
    }

    // execute queue-level + runtime-level onEnqueue plugins
    for (const plugin of enqueueHooks) {
      await plugin.onEnqueue!(job);
    }

    // Emit onJobDelayed hook if job is delayed
    if (delayUntil !== undefined) {
      const delayMs = Math.max(0, delayUntil - now);
      for (const plugin of delayedHooks) {
        await plugin.onJobDelayed!(job, delayMs);
      }
      this.lifecycleEvents?.emit({
        type: 'schedule.created',
        queueName,
        jobName: job.jobName,
        schedulePattern: `delay:${delayMs}ms`,
        scheduleAt: delayUntil,
      });
    }

    const storedJob: StoredJob = {
      id: options?.jobId || crypto.randomUUID(),
      name: job.jobName,
      payload: job.payload,
      queue: queueName,
      attempts: 0,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    const jobTags = Array.from(new Set([`queue:${queueName}`, `job:${job.jobName}`, ...(typeof job.tags === 'function' ? job.tags() : [])]));
    if (jobTags.length > 0) {
      storedJob.tags = jobTags;
    }

    // Only add optional properties if they have values
    if (delayUntil !== undefined) {
      storedJob.delayUntil = delayUntil;
    }
    if (idempotencyKey) {
      storedJob.idempotencyKey = idempotencyKey;
    }
    if (options?.priority !== undefined) {
      storedJob.priority = options.priority;
    }
    if (options?.batchId !== undefined) {
      storedJob.batchId = options.batchId;
    }
    if (options?.batchName !== undefined) {
      storedJob.batchName = options.batchName;
    }
    if (options?.batchIndex !== undefined) {
      storedJob.batchIndex = options.batchIndex;
    }
    if (options?.workflowId !== undefined) {
      storedJob.workflowId = options.workflowId;
    }
    if (options?.workflowNodeId !== undefined) {
      storedJob.workflowNodeId = options.workflowNodeId;
    }
    if (scheduleMetadata?.scheduledCron !== undefined) {
      storedJob.scheduledCron = scheduleMetadata.scheduledCron;
    }
    if (scheduleMetadata?.lastScheduledAt !== undefined) {
      storedJob.lastScheduledAt = scheduleMetadata.lastScheduledAt;
    }
    if (scheduleMetadata?.repeatScheduleId !== undefined) {
      storedJob.repeatScheduleId = scheduleMetadata.repeatScheduleId;
    }
    if (scheduleMetadata?.repeatIntervalMs !== undefined) {
      storedJob.repeatIntervalMs = scheduleMetadata.repeatIntervalMs;
    }

    // Emit onJobPrioritized plugin hook
    if (storedJob.priority !== undefined) {
      for (const plugin of prioritizedHooks) {
        await plugin.onJobPrioritized!(storedJob);
      }
    }

    await storage.enqueue(storedJob);

    this.lifecycleEvents?.emit({
      type: 'job.enqueued',
      queueName,
      jobId: storedJob.id,
      jobName: storedJob.name,
    });

    return storedJob.id;
  }

  private startIntervalSchedule(
    definition: RepeatableScheduleDefinition,
    storage: QueueStorage,
    durable: boolean
  ): ScheduledJobHandle {
    const { intervalMs } = definition;
    if (intervalMs == null || intervalMs <= 0) {
      throw new Error(`Invalid intervalMs for repeatable schedule '${definition.id}'`);
    }

    const timer = setInterval(() => {
      void this.dispatchScheduledDefinition(definition, {
        lastScheduledAt: Date.now(),
        repeatScheduleId: definition.id,
        repeatIntervalMs: intervalMs,
      });
      this.lifecycleEvents?.emit({
        type: 'job.promoted',
        queueName: definition.queue,
        jobName: definition.jobName,
        scheduleId: definition.id,
      });
    }, intervalMs);

    const handle: ScheduledJobHandle = {
      id: definition.id,
      stop: () => {
        clearInterval(timer);
        this.scheduledTasks.delete(definition.id);
        if (durable) {
          void removePersistedRepeatableSchedule(storage, definition.id);
        }
      },
    };

    this.scheduledTasks.set(definition.id, {
      handle,
      definition,
      durable,
      ...(durable ? { storage } : {}),
    });
    return handle;
  }

  private startCronSchedule(
    definition: RepeatableScheduleDefinition,
    storage: QueueStorage,
    durable: boolean
  ): ScheduledJobHandle {
    const { pattern } = definition;
    if (!pattern) {
      throw new Error(`Missing cron pattern for repeatable schedule '${definition.id}'`);
    }

    const task = cron.schedule(
      pattern,
      () => {
        void this.dispatchScheduledDefinition(definition, {
          scheduledCron: pattern,
          lastScheduledAt: Date.now(),
          repeatScheduleId: definition.id,
        });
        this.lifecycleEvents?.emit({
          type: 'job.promoted',
          queueName: definition.queue,
          jobName: definition.jobName,
          scheduleId: definition.id,
        });
      },
      definition.timezone ? { timezone: definition.timezone } : undefined
    );

    const handle: ScheduledJobHandle = {
      id: definition.id,
      stop: () => {
        task.stop();
        if ('destroy' in task && typeof task.destroy === 'function') {
          task.destroy();
        }
        this.scheduledTasks.delete(definition.id);
        if (durable) {
          void removePersistedRepeatableSchedule(storage, definition.id);
        }
      },
    };

    this.scheduledTasks.set(definition.id, {
      handle,
      definition,
      durable,
      ...(durable ? { storage } : {}),
    });
    return handle;
  }

  private async dispatchScheduledDefinition(
    definition: RepeatableScheduleDefinition,
    scheduleMetadata: Pick<StoredJob, 'scheduledCron' | 'lastScheduledAt' | 'repeatScheduleId' | 'repeatIntervalMs'>
  ): Promise<void> {
    let ScheduledJobClass: any;

    try {
      ScheduledJobClass = this.registry.get(definition.jobName);
    } catch {
      return;
    }

    const instance = new ScheduledJobClass(definition.payload);
    await this.dispatchInternal(instance, undefined, scheduleMetadata);
  }

  private async findDuplicateByIdempotencyKey(
    storage: QueueStorage,
    options: {
      queueName: string;
      idempotencyKey: string;
      dedupeWindowMs: number;
      includeFailed: boolean;
    }
  ): Promise<string | null> {
    const { queueName, idempotencyKey, dedupeWindowMs, includeFailed } = options;
    const cutoff = Date.now() - dedupeWindowMs;

    const [readyJobs, activeJobs, pendingDeferredJobs, promotedDeferredJobs, completedJobs, failedJobs] = await Promise.all([
      storage.getReadyJobs({ queueName, limit: DEDUPE_QUERY_LIMIT, offset: 0 }),
      storage.getActiveJobs({ queueName, limit: DEDUPE_QUERY_LIMIT, offset: 0 }),
      storage.queryDeferredJobs({ queueName, status: 'pending', limit: DEDUPE_QUERY_LIMIT, offset: 0 }),
      storage.queryDeferredJobs({ queueName, status: 'promoted', limit: DEDUPE_QUERY_LIMIT, offset: 0 }),
      storage.getCompletedJobs({ queueName, limit: DEDUPE_QUERY_LIMIT, offset: 0 }),
      includeFailed
        ? storage.getDeadLetterJobs({ queueName, limit: DEDUPE_QUERY_LIMIT, offset: 0 })
        : Promise.resolve([] as StoredJob[]),
    ]);

    const queuedOrRunning = [...readyJobs, ...activeJobs, ...pendingDeferredJobs, ...promotedDeferredJobs];
    const inflightMatch = queuedOrRunning.find((item) => item.idempotencyKey === idempotencyKey);
    if (inflightMatch) {
      return inflightMatch.id;
    }

    const completedMatch = completedJobs.find(
      (item) => item.idempotencyKey === idempotencyKey && item.completedAt >= cutoff
    );
    if (completedMatch) {
      return completedMatch.id;
    }

    return findFailedIdempotencyMatch(failedJobs, idempotencyKey, cutoff);
  }

  // execute a stored job
  async execute(job: StoredJob) {
    const queueConfig = this.resolveQueueConfig(job.queue);
    const workerConfig = this.resolveWorkerConfig(job.queue);

    if (!workerConfig) throw new Error(`Worker configuration is missing: ${job.queue}`);

    const storage = this.getStorage(queueConfig);

    const JobClass = this.registry.get(job.name);
    if (!JobClass) throw new Error(`Job not registered: ${job.name}`);

    const instance = new JobClass(job.payload);

    // return await this.executeWithRetry({ instance, job }, queueConfig, workerConfig, storage);
    return await this.executeAll({ instance, job }, queueConfig, workerConfig, storage);
  }

  async executeAll(
    ctx: ExecutionContext,
    queueConfig: QueueConfig,
    workerConfig: WorkerConfig,
    storage: QueueStorage
  ) {
    const executor = this.executors.get(ctx.job.queue);
    const queuePlugins = queueConfig.plugins || [];
    const allPlugins =
      queuePlugins.length === 0
        ? this.globalPlugins
        : this.globalPlugins.length === 0
          ? queuePlugins
          : [...queuePlugins, ...this.globalPlugins];
    const processStartHooks = allPlugins.filter((plugin) => typeof plugin.onProcessStart === 'function');
    const processEndHooks = allPlugins.filter((plugin) => typeof plugin.onProcessEnd === 'function');
    const failHooks = allPlugins.filter((plugin) => typeof plugin.onFail === 'function');
    const progressHooks = allPlugins.filter((plugin) => typeof plugin.onProgress === 'function');
    const { lifecycleEvents } = this;
    const leaseMs = queueConfig.visibilityTimeout || 30000;
    const executionTimeoutMs = resolveExecutionTimeoutMs(queueConfig, workerConfig);
    const timeoutStrategy = queueConfig.timeoutStrategy ?? 'retry';
    const isolationType = this.resolveIsolationType(ctx.instance, workerConfig);
    const sandbox = this.resolveSandboxConfig(queueConfig, workerConfig);
    const addCompletedJob =
      typeof (storage as QueueStorage & { addCompletedJob?: unknown }).addCompletedJob === 'function'
        ? storage.addCompletedJob.bind(storage)
        : undefined;
    let attempt = ctx.job.attempts || 0;
    let previousBackoff = 0;
    const configuredMaxAttempts = resolveConfiguredMaxAttempts(queueConfig, ctx.instance);

    if (!executor) throw new Error(`Executor not defined: ${ctx.job.queue}`);

    if (isolationType !== 'inline' && !workerConfig.workerModule) {
      throw new Error(
        `workerModule is required for '${isolationType}' isolation on worker handling queue '${ctx.job.queue}'`
      );
    }

    if (sandbox && isolationType === 'inline') {
      throw new Error(
        `Sandbox policy requires non-inline isolation for queue '${ctx.job.queue}'. Use 'thread' or 'process'.`
      );
    }

    if (isolationType === 'inline') {
      ctx.instance.reportProgress = async (pct: number) => {
        await storage.setJobProgress(ctx.job.id, pct);
        for (const plugin of progressHooks) {
          await plugin.onProgress!(ctx.job.id, ctx.job.queue, pct);
        }
        lifecycleEvents?.emit({
          type: 'job.progress',
          queueName: ctx.job.queue,
          jobId: ctx.job.id,
          jobName: ctx.job.name,
          progress: pct,
        });
      };
    }

    const isolationOptions =
      isolationType === 'inline'
        ? undefined
        : {
          type: isolationType,
          workerModule: workerConfig.workerModule ?? '',
          timeoutMs: executionTimeoutMs,
          ...(sandbox ? { sandbox } : {}),
          ...(queueConfig.timeoutSignal ? { timeoutSignal: queueConfig.timeoutSignal } : {}),
          ...(workerConfig.poolSize != null ? { poolSize: workerConfig.poolSize } : {}),
          ...(workerConfig.registryModule ? { registryModule: workerConfig.registryModule } : {}),
          ...(workerConfig.pluginsModule ? { pluginsModule: workerConfig.pluginsModule } : {}),
        };

    const runJob =
      isolationType === 'inline'
        ? () => this.withTimeout(ctx.instance.handle(ctx.job.payload), executionTimeoutMs)
        : () => runWithIsolation(
          isolationOptions!,
          {
            jobName: ctx.job.name,
            payload: ctx.job.payload,
            job: ctx.job,
          },
          this.registry
        );

    return executor.submit(async () => {
      while (true) {
        const stopHeartbeat = this.createLeaseHeartbeat(storage, ctx.job.id, leaseMs, ctx.job.queue);

        try {
          lifecycleEvents?.emit({
            type: 'job.started',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt: attempt + 1,
          });

          // run onProcessStart hooks
          for (const plugin of processStartHooks) {
            await plugin.onProcessStart!(ctx.job);
          }
          const result = await runJob();

          stopHeartbeat();

          if (addCompletedJob) {
            await addCompletedJob(ctx.job, result);
          }
          this.batchManager?.markJobCompleted(ctx.job, result);
          await this.onJobSucceeded(ctx.job);
          await storage.ack(ctx.job.id, ctx.job.queue);

          lifecycleEvents?.emit({
            type: 'job.completed',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt: attempt + 1,
            result,
          });

          // run onProcessEnd hooks
          for (const plugin of processEndHooks) {
            await plugin.onProcessEnd!(ctx.job, result);
          }

          return result;
        } catch (err) {
          stopHeartbeat();

          attempt++;

          await storage.updateAttempts(ctx.job.id, attempt);

          // run onFail hooks
          for (const plugin of failHooks) {
            await plugin.onFail!(ctx.job, err as Error);
          }

          lifecycleEvents?.emit({
            type: 'job.failed',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt,
            permanentFailure: false,
            error: err instanceof Error ? err.message : String(err),
          });

          if (timeoutStrategy === 'fail' && isTimeoutError(err)) {
            await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err);
            throw err;
          }

          const retryDecision = resolveRetryDecision(
            ctx,
            queueConfig,
            err,
            attempt,
            configuredMaxAttempts
          );

          if (retryDecision.action === 'deadletter') {
            await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err, {
              forceDeadLetter: true,
            });
            throw err;
          }

          if (retryDecision.action === 'fail' || attempt >= retryDecision.maxAttempts) {
            await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err);
            throw err;
          }

          const backoff = resolveRetryBackoff(
            ctx,
            queueConfig,
            attempt,
            retryDecision,
            previousBackoff,
            this.resolveBackoff.bind(this)
          );
          previousBackoff = backoff;

          await sleep(backoff);
        }
      }

    }, priorityScore(ctx.job.priority));
  }

  async executeWithRetry(
    ctx: ExecutionContext,
    queueConfig: QueueConfig,
    workerConfig: WorkerConfig,
    storage: QueueStorage
  ) {
    let attempt = ctx.job.attempts || 0;
    let previousBackoff = 0;
    const queuePlugins = queueConfig.plugins || [];
    const allPlugins =
      queuePlugins.length === 0
        ? this.globalPlugins
        : this.globalPlugins.length === 0
          ? queuePlugins
          : [...queuePlugins, ...this.globalPlugins];
    const leaseMs = queueConfig.visibilityTimeout || 30000;
    const executionTimeoutMs = resolveExecutionTimeoutMs(queueConfig, workerConfig);
    const timeoutStrategy = queueConfig.timeoutStrategy ?? 'retry';
    const isolationType = this.resolveIsolationType(ctx.instance, workerConfig);
    const sandbox = this.resolveSandboxConfig(queueConfig, workerConfig);
    const addCompletedJob =
      typeof (storage as QueueStorage & { addCompletedJob?: unknown }).addCompletedJob === 'function'
        ? storage.addCompletedJob.bind(storage)
        : undefined;

    const configuredMaxAttempts = resolveConfiguredMaxAttempts(queueConfig, ctx.instance);

    if (isolationType !== 'inline' && !workerConfig.workerModule) {
      throw new Error(
        `workerModule is required for '${isolationType}' isolation on worker handling queue '${ctx.job.queue}'`
      );
    }

    if (sandbox && isolationType === 'inline') {
      throw new Error(
        `Sandbox policy requires non-inline isolation for queue '${ctx.job.queue}'. Use 'thread' or 'process'.`
      );
    }

    if (isolationType === 'inline') {
      ctx.instance.reportProgress = async (pct: number) => {
        await storage.setJobProgress(ctx.job.id, pct);
      };
    }

    const isolationOptions =
      isolationType === 'inline'
        ? undefined
        : {
          type: isolationType,
          workerModule: workerConfig.workerModule ?? '',
          timeoutMs: executionTimeoutMs,
          ...(sandbox ? { sandbox } : {}),
          ...(queueConfig.timeoutSignal ? { timeoutSignal: queueConfig.timeoutSignal } : {}),
          ...(workerConfig.poolSize != null ? { poolSize: workerConfig.poolSize } : {}),
          ...(workerConfig.registryModule ? { registryModule: workerConfig.registryModule } : {}),
          ...(workerConfig.pluginsModule ? { pluginsModule: workerConfig.pluginsModule } : {}),
        };

    const runJob =
      isolationType === 'inline'
        ? () => this.withTimeout(ctx.instance.handle(ctx.job.payload), executionTimeoutMs)
        : () => runWithIsolation(
          isolationOptions!,
          {
            jobName: ctx.job.name,
            payload: ctx.job.payload,
            job: ctx.job,
          },
          this.registry
        );

    while (true) {
      const stopHeartbeat = this.createLeaseHeartbeat(storage, ctx.job.id, leaseMs, ctx.job.queue);

      try {
        const result = await runJob();

        stopHeartbeat();

        if (addCompletedJob) {
          await addCompletedJob(ctx.job, result);
        }
        this.batchManager?.markJobCompleted(ctx.job, result);
        await this.onJobSucceeded(ctx.job);
        await storage.ack(ctx.job.id, ctx.job.queue);

        return result;
      } catch (err) {
        stopHeartbeat();

        attempt++;

        await storage.updateAttempts(ctx.job.id, attempt);

        if (timeoutStrategy === 'fail' && isTimeoutError(err)) {
          await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err);
          throw err;
        }

        const retryDecision = resolveRetryDecision(
          ctx,
          queueConfig,
          err,
          attempt,
          configuredMaxAttempts
        );

        if (retryDecision.action === 'deadletter') {
          await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err, {
            forceDeadLetter: true,
          });
          throw err;
        }

        if (retryDecision.action === 'fail' || attempt >= retryDecision.maxAttempts) {
          await this.handlePermanentFailure(ctx.job, queueConfig, storage, allPlugins, attempt, err);
          throw err;
        }

        const backoff = resolveRetryBackoff(
          ctx,
          queueConfig,
          attempt,
          retryDecision,
          previousBackoff,
          this.resolveBackoff.bind(this)
        );
        previousBackoff = backoff;

        await sleep(backoff);
      }
    }
  }

  resolveBackoff(queueConfig: QueueConfig, attempt: number, previousBackoff = 0): number {
    const { retry } = queueConfig;
    const strategyName = retry?.strategyName ?? retry?.backoff ?? 'fixed';
    const baseDelay = Math.max(0, retry?.delay ?? 1000);
    const maxDelay = Math.max(baseDelay, retry?.maxDelay ?? 30000);

    let backoff: number;
    switch (strategyName) {
      case 'exponential':
        backoff = baseDelay * Math.pow(2, attempt);
        break;
      case 'full-jitter': {
        const exponential = baseDelay * Math.pow(2, attempt);
        backoff = Math.random() * exponential;
        break;
      }
      case 'equal-jitter': {
        const exponential = baseDelay * Math.pow(2, attempt);
        backoff = exponential / 2 + Math.random() * (exponential / 2);
        break;
      }
      case 'decorrelated-jitter': {
        const prior = previousBackoff > 0 ? previousBackoff : baseDelay;
        backoff = Math.min(maxDelay, baseDelay + Math.random() * Math.max(baseDelay, prior * 3 - baseDelay));
        break;
      }
      case 'fixed':
      default:
        backoff = baseDelay;
        break;
    }

    const jitter = Math.min(1, Math.max(0, retry?.jitter ?? 0));
    if (jitter > 0 && strategyName !== 'full-jitter' && strategyName !== 'equal-jitter') {
      const randomOffset = backoff * jitter * Math.random();
      backoff -= randomOffset;
    }

    return Math.max(0, Math.floor(backoff));
  }

  resolveIsolationType(
    instance: { isolation?: () => IsolationType },
    workerConfig: WorkerConfig
  ): IsolationType {
    const prototype = Object.getPrototypeOf(instance) as {
      isolation?: () => IsolationType;
    };

    const hasIsolationOverride = Object.prototype.hasOwnProperty.call(prototype, 'isolation');
    if (hasIsolationOverride && typeof instance.isolation === 'function') {
      return instance.isolation();
    }

    if (workerConfig?.isolation) {
      return workerConfig.isolation;
    }

    if (typeof instance.isolation === 'function') {
      return instance.isolation();
    }

    return 'inline';
  }

  private resolveSandboxConfig(
    queueConfig: QueueConfig,
    workerConfig: WorkerConfig
  ): NonNullable<QueueConfig['sandbox']> | undefined {
    const policy = workerConfig.sandbox ?? queueConfig.sandbox;
    if (!policy?.enabled) {
      return undefined;
    }

    return policy;
  }

  private async handlePermanentFailure(
    job: StoredJob,
    queueConfig: QueueConfig,
    storage: QueueStorage,
    allPlugins: Plugin[],
    attempt: number,
    error: unknown,
    options?: { forceDeadLetter?: boolean }
  ): Promise<'deadlettered' | 'snoozed'> {
    const normalizedError = toExecutionError(error);
    const errorDetails = toErrorDetails(normalizedError);

    this.batchManager?.markJobFailed(job, normalizedError);
    for (const plugin of allPlugins) {
      if (plugin.onFailedPermanently) {
        await plugin.onFailedPermanently(job, normalizedError);
      }
    }

    let permanentFailureMode: 'deadlettered' | 'snoozed';
    if (options?.forceDeadLetter) {
      await storage.moveToDeadLetter({
        ...job,
        state: 'failed',
        errorDetails,
        updatedAt: Date.now(),
      });
      permanentFailureMode = 'deadlettered';
    } else {
      permanentFailureMode = await this.applyPoisonFailurePolicy(job, queueConfig, storage, attempt, errorDetails);
    }

    if (permanentFailureMode === 'deadlettered') {
      this.lifecycleEvents?.emit({
        type: 'job.deadlettered',
        queueName: job.queue,
        jobId: job.id,
        jobName: job.name,
        attempt,
        permanentFailure: true,
        error: normalizedError.message,
      });
    }

    await this.onJobFailed(job, normalizedError);
    return permanentFailureMode;
  }

  private async applyPoisonFailurePolicy(
    job: StoredJob,
    queueConfig: QueueConfig,
    storage: QueueStorage,
    failureCount: number,
    errorDetails: NonNullable<StoredJob['errorDetails']>
  ): Promise<'deadlettered' | 'snoozed'> {
    const policy = queueConfig.reliability?.poisonPolicy;
    const now = Date.now();

    if (!policy || failureCount < Math.max(1, policy.maxFailures)) {
      await storage.moveToDeadLetter({
        ...job,
        state: 'failed',
        errorDetails,
        updatedAt: now,
      });
      return 'deadlettered';
    }

    if (policy.template === 'auto-snooze') {
      const snoozeMs = Math.max(1_000, policy.snoozeMs ?? 60_000);
      await storage.ack(job.id, job.queue);
      await storage.enqueue({
        ...job,
        id: crypto.randomUUID(),
        state: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        delayUntil: now + snoozeMs,
        tags: Array.from(new Set([...(job.tags ?? []), 'poison:auto-snooze', `poison:source:${job.id}`])),
      });
      return 'snoozed';
    }

    const tags = [...(job.tags ?? []), `poison:${policy.template ?? 'quarantine'}`];
    if (policy.template === 'escalation' && policy.escalationTag) {
      tags.push(policy.escalationTag);
    }

    await storage.moveToDeadLetter({
      ...job,
      state: 'failed',
      updatedAt: now,
      errorDetails,
      tags: Array.from(new Set(tags)),
    });

    return 'deadlettered';
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Timeout after ${timeoutMs}ms`);
        error.name = 'JobTimeoutError';
        reject(error);
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private createLeaseHeartbeat(
    storage: QueueStorage,
    jobId: string,
    leaseMs: number,
    queueName?: string,
  ): () => void {
    const firstDelay = Math.max(1, Math.floor(leaseMs / 2));
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let repeatingTimer: ReturnType<typeof setInterval> | undefined;

    initialTimer = setTimeout(() => {
      void storage.extendLease(jobId, leaseMs, queueName);
      repeatingTimer = setInterval(() => {
        void storage.extendLease(jobId, leaseMs, queueName);
      }, firstDelay);
    }, firstDelay);

    return () => {
      if (initialTimer) {
        clearTimeout(initialTimer);
      }
      if (repeatingTimer) {
        clearInterval(repeatingTimer);
      }
    };
  }

  private async dispatchFlowNode(flow: FlowRuntime, node: FlowRuntimeNode): Promise<void> {
    if (node.status !== 'pending') {
      return;
    }

    const jobId = await this.dispatchInternal(node.job, {
      workflowId: flow.id,
      workflowNodeId: node.id,
    });

    node.jobId = jobId;
    node.status = 'queued';
    this.flowNodeByJobId.set(jobId, { flowId: flow.id, nodeId: node.id });

    this.registerDagNode(flow, node, jobId);
  }

  private registerDagNode(flow: FlowRuntime, node: FlowRuntimeNode, jobId: string): void {
    const dependencyNodes = [...node.dependsOn]
      .map((dependencyId) => flow.dagNodes.get(dependencyId))
      .filter((dependency): dependency is JobNode => Boolean(dependency));

    const jobRecord: StoredJob = {
      id: jobId,
      name: node.job.jobName,
      payload: node.job.payload,
      queue: node.job.queue(),
      attempts: 0,
      state: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const dagNode = new JobNode(jobRecord, dependencyNodes);
    flow.dagNodes.set(node.id, dagNode);

    const dagPlugins = this.getDagPlugins();
    for (const plugin of dagPlugins) {
      plugin.registerNode(dagNode);
    }
  }

  private async onJobSucceeded(job: StoredJob): Promise<void> {
    const flowId = job.workflowId;
    const nodeId = job.workflowNodeId;
    if (!flowId || !nodeId) {
      return;
    }

    const flow = this.flows.get(flowId);
    const node = flow?.nodes.get(nodeId);
    if (!flow || !node) {
      return;
    }

    node.status = 'completed';
    const dagNode = flow.dagNodes.get(nodeId);
    if (dagNode) {
      dagNode.completed = true;
    }

    const readyChildren: FlowRuntimeNode[] = [];

    for (const childId of node.children) {
      const childNode = flow.nodes.get(childId);
      if (!childNode || childNode.status !== 'pending') {
        continue;
      }

      const allDependenciesDone = [...childNode.dependsOn].every((dependencyId) => {
        const dependency = flow.nodes.get(dependencyId);
        return dependency?.status === 'completed';
      });

      if (allDependenciesDone) {
        readyChildren.push(childNode);
      }
    }

    if (readyChildren.length > 0) {
      await Promise.all(readyChildren.map((childNode) => this.dispatchFlowNode(flow, childNode)));
    }
  }

  private async onJobFailed(job: StoredJob, error: Error): Promise<void> {
    const flowId = job.workflowId;
    const nodeId = job.workflowNodeId;
    if (!flowId || !nodeId) {
      return;
    }

    const flow = this.flows.get(flowId);
    const node = flow?.nodes.get(nodeId);
    if (!flow || !node) {
      return;
    }

    node.status = 'failed';
    node.error = error.message;

    if (!flow.atomicFailure) {
      return;
    }

    const queue = [...node.children];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);

      const current = flow.nodes.get(currentId);
      if (!current) {
        continue;
      }

      if (current.status === 'pending') {
        current.status = 'blocked';
        current.error = `Blocked by failed dependency '${node.id}'`;
      }

      for (const childId of current.children) {
        queue.push(childId);
      }
    }
  }

  private getDagPlugins(): DagPluginLike[] {
    const dagPlugins: DagPluginLike[] = [];

    for (const plugin of this.globalPlugins) {
      const candidate = plugin as unknown as Partial<DagPluginLike>;
      if (typeof candidate.registerNode === 'function') {
        dagPlugins.push({ registerNode: candidate.registerNode.bind(plugin) });
      }
    }

    return dagPlugins;
  }
}
