import type { BatchRecord, Supervisor } from '@vasto-queue/core';

function paginate<T>(items: T[], limit?: number, offset?: number): T[] {
  const start = Number.isFinite(offset) ? (offset as number) : 0;
  const end = Number.isFinite(limit) ? start + (limit as number) : undefined;
  return items.slice(start, end);
}

export async function listDashboardBatches(
  supervisor: Supervisor,
  options: { limit?: number; offset?: number } = {}
): Promise<BatchRecord[]> {
  return paginate(supervisor.getBatches(), options.limit, options.offset);
}

export async function getDashboardBatch(supervisor: Supervisor, batchId: string): Promise<BatchRecord | null> {
  return supervisor.getBatch(batchId) ?? null;
}