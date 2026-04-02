import type { RepeatableScheduleDefinition, ScheduledJobHandle } from '../../types';
import type { QueueStorage } from '../../interfaces/queue-storage';
import type { JobNode } from '../job-node';

export type ResolvedRetryDecision = {
  action: 'retry' | 'fail' | 'deadletter';
  maxAttempts: number;
  backoffMs?: number;
};

export type FlowRuntimeNode = {
  id: string;
  job: any;
  dependsOn: Set<string>;
  children: Set<string>;
  status: 'pending' | 'queued' | 'completed' | 'failed' | 'blocked';
  jobId?: string;
  error?: string;
};

export type FlowRuntime = {
  id: string;
  atomicFailure: boolean;
  nodes: Map<string, FlowRuntimeNode>;
  dagNodes: Map<string, JobNode>;
};

export type DagPluginLike = {
  registerNode: (node: JobNode) => void;
};

export type PersistedRepeatableSchedulePayload = {
  type: 'repeatable-schedule';
  definition: RepeatableScheduleDefinition;
};

export type ManagedScheduleTask = {
  handle: ScheduledJobHandle;
  definition: RepeatableScheduleDefinition;
  durable: boolean;
  storage?: QueueStorage;
};

export const INTERNAL_REPEATABLE_QUEUE = '__omni_internal_repeatables';
export const INTERNAL_REPEATABLE_JOB = '__omni_repeatable_schedule__';
export const INTERNAL_REPEATABLE_PAYLOAD_TYPE = 'repeatable-schedule';
export const REPEATABLE_PAGE_LIMIT = 200;
export const DEDUPE_QUERY_LIMIT = 1000;
