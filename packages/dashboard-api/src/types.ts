import type { DashboardAuthOptions, DashboardOptions, Supervisor } from '@omni-queue/core';

export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
}

export interface APIAdapterOptions {
  supervisor: Supervisor;
  host?: string;
  port?: number;
  apiBase?: string;
  uiBase?: string;
  uiDir?: string;
  auth?: DashboardAuthOptions;
  cors?: boolean | CorsOptions;
  streamIntervalMs?: number;
  signals?: boolean;
}

export interface DashboardApiOptions {
  supervisor: Supervisor;
  endpoint?: string;
  apiBase?: string;
  auth?: DashboardAuthOptions;
  streamIntervalMs?: number;
}

export interface StandaloneDashboardServerOptions extends DashboardApiOptions {
  host?: string;
  port?: number;
  cors?: boolean | CorsOptions;
  uiDir?: string;
  uiBase?: string;
  signals?: boolean;
}

export interface ConnectLikeNext {
  (): void;
}

export type { DashboardOptions };
