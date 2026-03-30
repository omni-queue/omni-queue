import type { DashboardAuthOptions, DashboardOptions, Supervisor } from '@omni-queue/core';

export interface DashboardApiOptions {
  supervisor: Supervisor;
  endpoint?: string;
  apiBase?: string;
  auth?: DashboardAuthOptions;
  streamIntervalMs?: number;
}

export type { DashboardOptions };
