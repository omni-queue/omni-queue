import type { RepeatableScheduleDefinition, StoredJob } from '../../types';
import type { QueueStorage } from '../../interfaces/queue-storage';
import {
  INTERNAL_REPEATABLE_JOB,
  INTERNAL_REPEATABLE_PAYLOAD_TYPE,
  INTERNAL_REPEATABLE_QUEUE,
  REPEATABLE_PAGE_LIMIT,
  type PersistedRepeatableSchedulePayload,
} from './internal-types';

export function repeatableStorageJobId(scheduleId: string): string {
  return `repeatable:${scheduleId}`;
}

export async function persistRepeatableSchedule(
  storage: QueueStorage,
  definition: RepeatableScheduleDefinition
): Promise<void> {
  const now = Date.now();
  await storage.enqueue({
    id: repeatableStorageJobId(definition.id),
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

export async function removePersistedRepeatableSchedule(storage: QueueStorage, scheduleId: string): Promise<void> {
  await storage.moveToDeadLetter({
    id: repeatableStorageJobId(scheduleId),
    name: INTERNAL_REPEATABLE_JOB,
    payload: { type: INTERNAL_REPEATABLE_PAYLOAD_TYPE },
    queue: INTERNAL_REPEATABLE_QUEUE,
    attempts: 0,
    state: 'failed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function listPersistedRepeatableSchedules(storage: QueueStorage): Promise<RepeatableScheduleDefinition[]> {
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

export function findFailedIdempotencyMatch(
  failedJobs: StoredJob[],
  idempotencyKey: string,
  cutoff: number
): string | null {
  const failedMatch = failedJobs.find(
    (item) => item.idempotencyKey === idempotencyKey && (item.updatedAt ?? item.createdAt) >= cutoff
  );

  return failedMatch?.id ?? null;
}
