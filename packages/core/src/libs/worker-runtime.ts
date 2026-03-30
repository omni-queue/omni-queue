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

type FlowRuntimeNode = {
  id: string;
  job: any;
  dependsOn: Set<string>;
  children: Set<string>;
  status: 'pending' | 'queued' | 'completed' | 'failed' | 'blocked';
  jobId?: string;
  error?: string;
};

type FlowRuntime = {
  id: string;
  atomicFailure: boolean;
  nodes: Map<string, FlowRuntimeNode>;
  dagNodes: Map<string, JobNode>;
};

type DagPluginLike = {
  registerNode: (node: JobNode) => void;
};

type PersistedRepeatableSchedulePayload = {
  type: 'repeatable-schedule';
  definition: RepeatableScheduleDefinition;
};

type ManagedScheduleTask = {
  handle: ScheduledJobHandle;
  durable: boolean;
  storage?: QueueStorage;
};

const INTERNAL_REPEATABLE_QUEUE = '__omni_internal_repeatables';
const INTERNAL_REPEATABLE_JOB = '__omni_repeatable_schedule__';
const INTERNAL_REPEATABLE_PAYLOAD_TYPE = 'repeatable-schedule';
const REPEATABLE_PAGE_LIMIT = 200;
const DEDUPE_QUERY_LIMIT = 1000;

export class JobManager {
  private executors: Map<string, PooledExecutor> = new Map();
  private scheduledTasks: Map<string, ManagedScheduleTask> = new Map();
  private batchManager?: BatchManager;
  private flows = new Map<string, FlowRuntime>();
  private flowNodeByJobId = new Map<string, { flowId: string; nodeId: string }>();

  constructor(
    private queues: Record<string, QueueConfig>,
    private workers: Record<string, WorkerConfig>,
    private registry: JobRegistry,
    private storageAdapters: Record<string, QueueStorage>,
    private globalPlugins: Plugin[] = [],
    private lifecycleEvents?: LifecycleEventBus
  ) {
    for (const [queueName, cfg] of Object.entries(queues)) {
      this.executors.set(queueName, new PooledExecutor(cfg.concurrency || 5));
    }
  }

  resolveQueueConfig(queueName: string) {
    const config = this.queues[queueName];
    if (!config) throw new Error(`Queue not defined: ${queueName}`);
    return config;
  }

  resolveWorkerConfig(queueName: string): WorkerConfig | undefined {
    return Object.values(this.workers).find((w: any) => w.queues.includes(queueName));
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

  setBatchManager(batchManager: BatchManager): void {
    this.batchManager = batchManager;
  }

  async dispatchBatch(name: string, jobs: any[]): Promise<string> {
    if (!this.batchManager) {
      throw new Error('Batch manager is not configured');
    }

    const batchId = crypto.randomUUID();
    const plannedJobs = jobs.map((job, index) => ({
      id: crypto.randomUUID(),
      name: job.jobName,
      queue: job.queue(),
      payload: job.payload,
      batchIndex: index,
    }));

    this.batchManager.registerBatch(batchId, name, plannedJobs);

    for (const plannedJob of plannedJobs) {
      const job = jobs[plannedJob.batchIndex];
      await this.dispatchInternal(job, {
        jobId: plannedJob.id,
        batchId,
        batchName: name,
        batchIndex: plannedJob.batchIndex,
      });
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
    for (const root of roots) {
      await this.dispatchFlowNode(runtime, root);
    }

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
        await this.persistRepeatableSchedule(storage, definition);
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
      await this.persistRepeatableSchedule(storage, definition);
    }
    return this.startCronSchedule(definition, storage, durable);
  }

  async recoverRepeatableSchedules(): Promise<number> {
    const recoveredDefinitions = new Map<string, { definition: RepeatableScheduleDefinition; storage: QueueStorage }>();

    for (const queueConfig of Object.values(this.queues)) {
      const storage = this.getStorage(queueConfig);
      const definitions = await this.listPersistedRepeatableSchedules(storage);
      for (const definition of definitions) {
        if (!this.queues[definition.queue]) {
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
      delayUntil = Date.now() + options.delayMs;
    }

    // execute queue-level + runtime-level onEnqueue plugins
    const allPlugins = [...(queueConfig.plugins || []), ...this.globalPlugins];
    for (const plugin of allPlugins) {
      if (plugin.onEnqueue) await plugin.onEnqueue(job);
    }

    // Emit onJobDelayed hook if job is delayed
    if (delayUntil !== undefined) {
      const delayMs = delayUntil - Date.now();
      for (const plugin of allPlugins) {
        if (plugin.onJobDelayed) await plugin.onJobDelayed(job, Math.max(0, delayMs));
      }
      this.lifecycleEvents?.emit({
        type: 'schedule.created',
        queueName,
        jobName: job.jobName,
        schedulePattern: `delay:${Math.max(0, delayMs)}ms`,
      });
    }

    const storedJob: StoredJob = {
      id: options?.jobId || crypto.randomUUID(),
      name: job.jobName,
      payload: job.payload,
      queue: queueName,
      attempts: 0,
      state: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      for (const plugin of allPlugins) {
        if (plugin.onJobPrioritized) await plugin.onJobPrioritized(storedJob);
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
    const intervalMs = definition.intervalMs;
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
          void this.removePersistedRepeatableSchedule(storage, definition.id);
        }
      },
    };

    this.scheduledTasks.set(definition.id, { handle, durable, ...(durable ? { storage } : {}) });
    return handle;
  }

  private startCronSchedule(
    definition: RepeatableScheduleDefinition,
    storage: QueueStorage,
    durable: boolean
  ): ScheduledJobHandle {
    const pattern = definition.pattern;
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
          void this.removePersistedRepeatableSchedule(storage, definition.id);
        }
      },
    };

    this.scheduledTasks.set(definition.id, { handle, durable, ...(durable ? { storage } : {}) });
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

  private async persistRepeatableSchedule(
    storage: QueueStorage,
    definition: RepeatableScheduleDefinition
  ): Promise<void> {
    const now = Date.now();
    await storage.enqueue({
      id: this.repeatableStorageJobId(definition.id),
      name: INTERNAL_REPEATABLE_JOB,
      payload: {
        type: INTERNAL_REPEATABLE_PAYLOAD_TYPE,
        definition: {
          ...definition,
          updatedAt: now,
        },
      } as PersistedRepeatableSchedulePayload,
      queue: INTERNAL_REPEATABLE_QUEUE,
      attempts: 0,
      state: 'queued',
      createdAt: definition.createdAt,
      updatedAt: now,
      idempotencyKey: `repeatable:${definition.id}`,
    });
  }

  private async removePersistedRepeatableSchedule(storage: QueueStorage, scheduleId: string): Promise<void> {
    await storage.moveToDeadLetter({
      id: this.repeatableStorageJobId(scheduleId),
      name: INTERNAL_REPEATABLE_JOB,
      payload: { type: INTERNAL_REPEATABLE_PAYLOAD_TYPE },
      queue: INTERNAL_REPEATABLE_QUEUE,
      attempts: 0,
      state: 'failed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  private async listPersistedRepeatableSchedules(storage: QueueStorage): Promise<RepeatableScheduleDefinition[]> {
    const definitions: RepeatableScheduleDefinition[] = [];
    let offset = 0;

    while (true) {
      const records = await storage.getReadyJobs({
        queueName: INTERNAL_REPEATABLE_QUEUE,
        limit: REPEATABLE_PAGE_LIMIT,
        offset,
      });

      if (records.length === 0) {
        break;
      }

      for (const record of records) {
        if (record.name !== INTERNAL_REPEATABLE_JOB) {
          continue;
        }

        const payload = record.payload as Partial<PersistedRepeatableSchedulePayload> | undefined;
        if (payload?.type !== INTERNAL_REPEATABLE_PAYLOAD_TYPE || !payload.definition) {
          continue;
        }

        const definition = payload.definition;
        if (!definition.id || !definition.queue || !definition.jobName) {
          continue;
        }

        definitions.push(definition);
      }

      if (records.length < REPEATABLE_PAGE_LIMIT) {
        break;
      }

      offset += REPEATABLE_PAGE_LIMIT;
    }

    return definitions;
  }

  private repeatableStorageJobId(scheduleId: string): string {
    return `repeatable:${scheduleId}`;
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

    const failedMatch = failedJobs.find(
      (item) => item.idempotencyKey === idempotencyKey && (item.updatedAt ?? item.createdAt) >= cutoff
    );
    if (failedMatch) {
      return failedMatch.id;
    }

    return null;
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
    const allPlugins = [...(queueConfig.plugins || []), ...this.globalPlugins];
    let attempt = ctx.job.attempts || 0;
    const maxAttempts =
      queueConfig.maxAttempts ?? ctx.instance.retries?.() ?? queueConfig.retry?.attempts ?? 3;

    if (!executor) throw new Error(`Executor not defined: ${ctx.job.queue}`);

    return executor.submit(async () => {
      while (attempt < maxAttempts) {
        const leaseMs = queueConfig.visibilityTimeout || 30000;
        const executionTimeoutMs = this.resolveExecutionTimeoutMs(queueConfig, workerConfig);
        const timeoutStrategy = queueConfig.timeoutStrategy ?? 'retry';

        const heartbeat = setInterval(() => {
          storage.extendLease(ctx.job.id, leaseMs);
        }, leaseMs / 2);

        try {
          this.lifecycleEvents?.emit({
            type: 'job.started',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt: attempt + 1,
          });

          // run onProcessStart hooks
          for (const plugin of allPlugins) {
            if (plugin.onProcessStart) await plugin.onProcessStart(ctx.job);
          }

          const isolationType = this.resolveIsolationType(ctx.instance, workerConfig);

          if (isolationType !== 'inline' && !workerConfig.workerModule) {
            throw new Error(
              `workerModule is required for '${isolationType}' isolation on worker handling queue '${ctx.job.queue}'`
            );
          }

          const isolationOptions: {
            type: 'thread' | 'process' | 'inline';
            workerModule: string;
            timeoutMs: number;
            timeoutSignal?: NodeJS.Signals;
            poolSize?: number;
            registryModule?: string;
            pluginsModule?: string;
          } = {
            type: isolationType,
            workerModule: workerConfig.workerModule ?? '',
            timeoutMs: executionTimeoutMs,
          };

          if (queueConfig.timeoutSignal) {
            isolationOptions.timeoutSignal = queueConfig.timeoutSignal;
          }

          if (workerConfig.poolSize != null) {
            isolationOptions.poolSize = workerConfig.poolSize;
          }

          if (workerConfig.registryModule) {
            isolationOptions.registryModule = workerConfig.registryModule;
          }

          if (workerConfig.pluginsModule) {
            isolationOptions.pluginsModule = workerConfig.pluginsModule;
          }

          let result: unknown;
          if (isolationType === 'inline') {
            ctx.instance.reportProgress = async (pct: number) => {
              await storage.setJobProgress(ctx.job.id, pct);
              for (const plugin of allPlugins) {
                if (plugin.onProgress) await plugin.onProgress(ctx.job.id, ctx.job.queue, pct);
              }
              this.lifecycleEvents?.emit({
                type: 'job.progress',
                queueName: ctx.job.queue,
                jobId: ctx.job.id,
                jobName: ctx.job.name,
                progress: pct,
              });
            };

            result = await this.withTimeout(ctx.instance.handle(ctx.job.payload), executionTimeoutMs);
          } else {
            result = await runWithIsolation(
              isolationOptions,
              {
                jobName: ctx.job.name,
                payload: ctx.job.payload,
                job: ctx.job,
              },
              this.registry
            );
          }

          clearInterval(heartbeat);

          if (typeof (storage as QueueStorage & { addCompletedJob?: unknown }).addCompletedJob === 'function') {
            await storage.addCompletedJob(ctx.job, result);
          }
          this.batchManager?.markJobCompleted(ctx.job, result);
          await this.onJobSucceeded(ctx.job);
          await storage.ack(ctx.job.id);

          this.lifecycleEvents?.emit({
            type: 'job.completed',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt: attempt + 1,
            result,
          });

          // run onProcessEnd hooks
          for (const plugin of allPlugins) {
            if (plugin.onProcessEnd) await plugin.onProcessEnd(ctx.job, result);
          }

          return result;
        } catch (err) {
          clearInterval(heartbeat);

          attempt++;

          await storage.updateAttempts(ctx.job.id, attempt);

          // run onFail hooks
          for (const plugin of allPlugins) {
            if (plugin.onFail) await plugin.onFail(ctx.job, err as Error);
          }

          this.lifecycleEvents?.emit({
            type: 'job.failed',
            queueName: ctx.job.queue,
            jobId: ctx.job.id,
            jobName: ctx.job.name,
            attempt,
            permanentFailure: false,
            error: err instanceof Error ? err.message : String(err),
          });

          if (timeoutStrategy === 'fail' && this.isTimeoutError(err)) {
            this.batchManager?.markJobFailed(ctx.job, err as Error);
            for (const plugin of allPlugins) {
              if (plugin.onFailedPermanently) {
                await plugin.onFailedPermanently(ctx.job, err as Error);
              }
            }
            const permanentFailureMode = await this.applyPoisonFailurePolicy(
              ctx.job,
              queueConfig,
              storage,
              attempt
            );
            if (permanentFailureMode === 'deadlettered') {
              this.lifecycleEvents?.emit({
                type: 'job.deadlettered',
                queueName: ctx.job.queue,
                jobId: ctx.job.id,
                jobName: ctx.job.name,
                attempt,
                permanentFailure: true,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            await this.onJobFailed(ctx.job, err as Error);
            throw err;
          }

          if (attempt >= maxAttempts) {
            this.batchManager?.markJobFailed(ctx.job, err as Error);
            for (const plugin of allPlugins) {
              if (plugin.onFailedPermanently) {
                await plugin.onFailedPermanently(ctx.job, err as Error);
              }
            }
            const permanentFailureMode = await this.applyPoisonFailurePolicy(
              ctx.job,
              queueConfig,
              storage,
              attempt
            );
            if (permanentFailureMode === 'deadlettered') {
              this.lifecycleEvents?.emit({
                type: 'job.deadlettered',
                queueName: ctx.job.queue,
                jobId: ctx.job.id,
                jobName: ctx.job.name,
                attempt,
                permanentFailure: true,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            await this.onJobFailed(ctx.job, err as Error);
            throw err;
          }

          const backoff =
            ctx.instance.backoff?.(attempt) ?? this.resolveBackoff(queueConfig, attempt);

          await sleep(backoff);
        }
      }

      throw new Error('Execution exited unexpectedly without result');
    }, priorityScore(ctx.job.priority));
  }

  async executeWithRetry(
    ctx: ExecutionContext,
    queueConfig: QueueConfig,
    workerConfig: WorkerConfig,
    storage: QueueStorage
  ) {
    let attempt = ctx.job.attempts || 0;
    const allPlugins = [...(queueConfig.plugins || []), ...this.globalPlugins];

    const maxAttempts =
      queueConfig.maxAttempts ?? ctx.instance.retries?.() ?? queueConfig.retry?.attempts ?? 3;

    while (attempt < maxAttempts) {
      const leaseMs = queueConfig.visibilityTimeout || 30000;
      const executionTimeoutMs = this.resolveExecutionTimeoutMs(queueConfig, workerConfig);
      const timeoutStrategy = queueConfig.timeoutStrategy ?? 'retry';

      const heartbeat = setInterval(() => {
        storage.extendLease(ctx.job.id, leaseMs);
      }, leaseMs / 2);

      try {
        const isolationType = this.resolveIsolationType(ctx.instance, workerConfig);

        if (isolationType !== 'inline' && !workerConfig.workerModule) {
          throw new Error(
            `workerModule is required for '${isolationType}' isolation on worker handling queue '${ctx.job.queue}'`
          );
        }

        const isolationOptions: {
          type: 'thread' | 'process' | 'inline';
          workerModule: string;
          timeoutMs: number;
          timeoutSignal?: NodeJS.Signals;
          poolSize?: number;
          registryModule?: string;
          pluginsModule?: string;
        } = {
          type: isolationType,
          workerModule: workerConfig.workerModule ?? '',
          timeoutMs: executionTimeoutMs,
        };

        if (queueConfig.timeoutSignal) {
          isolationOptions.timeoutSignal = queueConfig.timeoutSignal;
        }

        if (workerConfig.poolSize != null) {
          isolationOptions.poolSize = workerConfig.poolSize;
        }

        if (workerConfig.registryModule) {
          isolationOptions.registryModule = workerConfig.registryModule;
        }

        if (workerConfig.pluginsModule) {
          isolationOptions.pluginsModule = workerConfig.pluginsModule;
        }

        let result: unknown;
        if (isolationType === 'inline') {
          ctx.instance.reportProgress = async (pct: number) => {
            await storage.setJobProgress(ctx.job.id, pct);
          };
          result = await this.withTimeout(ctx.instance.handle(ctx.job.payload), executionTimeoutMs);
        } else {
          result = await runWithIsolation(
            isolationOptions,
            {
              jobName: ctx.job.name,
              payload: ctx.job.payload,
              job: ctx.job,
            },
            this.registry
          );
        }

        clearInterval(heartbeat);

        if (typeof (storage as QueueStorage & { addCompletedJob?: unknown }).addCompletedJob === 'function') {
          await storage.addCompletedJob(ctx.job, result);
        }
        this.batchManager?.markJobCompleted(ctx.job, result);
        await this.onJobSucceeded(ctx.job);
        await storage.ack(ctx.job.id);

        return result;
      } catch (err) {
        clearInterval(heartbeat);

        attempt++;

        await storage.updateAttempts(ctx.job.id, attempt);

        if (timeoutStrategy === 'fail' && this.isTimeoutError(err)) {
          this.batchManager?.markJobFailed(ctx.job, err as Error);
          for (const plugin of allPlugins) {
            if (plugin.onFailedPermanently) {
              await plugin.onFailedPermanently(ctx.job, err as Error);
            }
          }
          await this.applyPoisonFailurePolicy(ctx.job, queueConfig, storage, attempt);
          await this.onJobFailed(ctx.job, err as Error);
          throw err;
        }

        if (attempt >= maxAttempts) {
          this.batchManager?.markJobFailed(ctx.job, err as Error);
          for (const plugin of allPlugins) {
            if (plugin.onFailedPermanently) {
              await plugin.onFailedPermanently(ctx.job, err as Error);
            }
          }
          await this.applyPoisonFailurePolicy(ctx.job, queueConfig, storage, attempt);
          await this.onJobFailed(ctx.job, err as Error);
          throw err;
        }

        const backoff =
          ctx.instance.backoff?.(attempt) ?? this.resolveBackoff(queueConfig, attempt);

        await sleep(backoff);
      }
    }

    throw new Error('Execution exited unexpectedly without result');
  }

  resolveBackoff(queueConfig: any, attempt: number) {
    const strategy = queueConfig.retry?.backoff;

    if (strategy === 'exponential') {
      return Math.pow(2, attempt) * 1000;
    }

    if (typeof strategy === 'number') {
      return strategy;
    }

    return 1000;
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

  private resolveExecutionTimeoutMs(queueConfig: QueueConfig, workerConfig: WorkerConfig): number {
    if (queueConfig.executionTimeoutMs && queueConfig.executionTimeoutMs > 0) {
      return queueConfig.executionTimeoutMs;
    }

    if (workerConfig.timeout && workerConfig.timeout > 0) {
      return workerConfig.timeout;
    }

    return 30000;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.name === 'JobTimeoutError' ||
      /timeout/i.test(error.message)
    );
  }

  private async applyPoisonFailurePolicy(
    job: StoredJob,
    queueConfig: QueueConfig,
    storage: QueueStorage,
    failureCount: number
  ): Promise<'deadlettered' | 'snoozed'> {
    const policy = queueConfig.reliability?.poisonPolicy;
    const now = Date.now();

    if (!policy || failureCount < Math.max(1, policy.maxFailures)) {
      await storage.moveToDeadLetter({
        ...job,
        state: 'failed',
        updatedAt: now,
      });
      return 'deadlettered';
    }

    if (policy.template === 'auto-snooze') {
      const snoozeMs = Math.max(1_000, policy.snoozeMs ?? 60_000);
      await storage.ack(job.id);
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
        await this.dispatchFlowNode(flow, childNode);
      }
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
