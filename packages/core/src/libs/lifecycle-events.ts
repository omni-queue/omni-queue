import { CompletedJobRecord, StoredJob } from '../types';

export type LifecycleEventType =
  | 'queue.paused'
  | 'queue.resumed'
  | 'queue.drained'
  | 'queue.cleaned'
  | 'queue.obliterated'
  | 'queue.backpressure'
  | 'queue.backpressure.cleared'
  | 'queue.circuit.changed'
  | 'worker.started'
  | 'worker.stopped'
  | 'job.enqueued'
  | 'job.started'
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'job.deadlettered'
  | 'job.promoted'
  | 'schedule.created';

export interface QueueLifecycleEvent {
  id: string;
  type: LifecycleEventType;
  timestamp: number;
  queueName?: string;
  workerName?: string;
  jobId?: string;
  jobName?: string;
  attempt?: number;
  permanentFailure?: boolean;
  progress?: number;
  removed?: number;
  scheduleId?: string;
  schedulePattern?: string;
  result?: unknown;
  error?: string;
  circuitState?: 'closed' | 'open' | 'half-open';
  queueDepth?: number;
  threshold?: number;
}

export type LifecycleEventInput =
  Omit<QueueLifecycleEvent, 'id' | 'timestamp'> &
    Partial<Pick<QueueLifecycleEvent, 'id' | 'timestamp'>>;

export type LifecycleEventListener = (event: QueueLifecycleEvent) => void;

function deriveJobMetadata(
  input: LifecycleEventInput
): Partial<Pick<QueueLifecycleEvent, 'queueName' | 'jobId' | 'jobName'>> {
  const withStoredJob = input as LifecycleEventInput & { job?: StoredJob | CompletedJobRecord };
  const job = withStoredJob.job;

  const queueName = input.queueName ?? job?.queue;
  const jobId = input.jobId ?? job?.id;
  const jobName = input.jobName ?? job?.name;

  return {
    ...(queueName !== undefined ? { queueName } : {}),
    ...(jobId !== undefined ? { jobId } : {}),
    ...(jobName !== undefined ? { jobName } : {}),
  };
}

export class LifecycleEventBus {
  private listeners = new Set<LifecycleEventListener>();
  private history: QueueLifecycleEvent[] = [];

  constructor(private readonly maxHistory: number = 500) {}

  emit(input: LifecycleEventInput): QueueLifecycleEvent {
    const jobMetadata = deriveJobMetadata(input);
    const event: QueueLifecycleEvent = {
      id: input.id ?? crypto.randomUUID(),
      timestamp: input.timestamp ?? Date.now(),
      type: input.type,
      ...jobMetadata,
      ...(input.workerName !== undefined ? { workerName: input.workerName } : {}),
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      ...(input.permanentFailure !== undefined
        ? { permanentFailure: input.permanentFailure }
        : {}),
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
      ...(input.removed !== undefined ? { removed: input.removed } : {}),
      ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
      ...(input.schedulePattern !== undefined ? { schedulePattern: input.schedulePattern } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.circuitState !== undefined ? { circuitState: input.circuitState } : {}),
      ...(input.queueDepth !== undefined ? { queueDepth: input.queueDepth } : {}),
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    };

    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    for (const listener of this.listeners) {
      listener(event);
    }

    return event;
  }

  subscribe(listener: LifecycleEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getRecent(limit = 100): QueueLifecycleEvent[] {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    return this.history.slice(-boundedLimit);
  }
}
