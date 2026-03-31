import type { DashboardAuthOptions, DashboardOptions, Supervisor } from '@omni-queue/core';

export interface DashboardApiOptions {
  supervisor: Supervisor;
  endpoint?: string;
  apiBase?: string;
  auth?: DashboardAuthOptions;
  streamIntervalMs?: number;
  uiDir?: string;
  uiBase?: string;
  protectUiWithAuth?: boolean;
}

export interface DashboardWebSocketController {
  close: () => void;
}

export type { DashboardOptions };
