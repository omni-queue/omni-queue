import type { ArchiveRetentionPolicy, CompletedJobRecord, JobArchiveQuery, Supervisor } from '@omni-queue/core';

export type ArchiveQueryInput = {
  queueName?: string;
  jobName?: string;
  search?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
};

export async function queryArchive(supervisor: Supervisor, input: ArchiveQueryInput): Promise<CompletedJobRecord[]> {
  const query: JobArchiveQuery = {
    ...(input.queueName ? { queueName: input.queueName } : {}),
    ...(input.jobName ? { jobName: input.jobName } : {}),
    ...(input.search ? { search: input.search } : {}),
    ...(input.fromTs != null ? { fromTs: input.fromTs } : {}),
    ...(input.toTs != null ? { toTs: input.toTs } : {}),
    ...(input.limit != null ? { limit: input.limit } : {}),
    ...(input.offset != null ? { offset: input.offset } : {}),
  };

  return supervisor.queryJobArchive(query);
}

export function updateArchiveRetention(supervisor: Supervisor, policy: ArchiveRetentionPolicy): void {
  supervisor.setArchiveRetentionPolicy(policy);
}
