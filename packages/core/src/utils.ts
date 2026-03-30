import { JobPriority } from './types';

export function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Numeric sort weight for job priority.
 * Lower = higher urgency (processed first).
 * critical=0, high=1, normal=2, low=3
 */
export const PRIORITY_SCORES: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function priorityScore(priority?: JobPriority): number {
  return PRIORITY_SCORES[priority ?? 'normal'] ?? 2;
}
