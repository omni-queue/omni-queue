import type { SupervisorMode } from './supervisor';

export function resolveSupervisorMode(
  value: string | undefined,
  defaultMode: Exclude<SupervisorMode, 'all'> = 'hybrid'
): Exclude<SupervisorMode, 'all'> {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'api' || normalized === 'worker' || normalized === 'hybrid') {
    return normalized;
  }

  if (normalized === 'all') {
    return 'hybrid';
  }

  return defaultMode;
}