import type { DashboardAuthOptions } from '@omni-queue/core';
import type { DashboardApiOptions } from '../types';
import { normalizeBase } from '../utils/http';

export interface ResolvedDashboardConfig {
  base: string;
  legacyBase: string | undefined;
  auth: DashboardAuthOptions;
  streamIntervalMs: number;
  uiDir: string | undefined;
  uiBase: string;
  protectUiWithAuth: boolean;
}

export function resolveDashboardConfig(options: DashboardApiOptions): ResolvedDashboardConfig {
  const base = normalizeBase(options.endpoint ?? options.apiBase, '/api/dashboard');
  return {
    base,
    legacyBase: base === '/dashboard' ? undefined : '/dashboard',
    auth: options.auth ?? options.supervisor.getDashboardOptions()?.auth ?? ({ type: 'none' } satisfies DashboardAuthOptions),
    streamIntervalMs: options.streamIntervalMs ?? options.supervisor.getDashboardOptions()?.streamIntervalMs ?? 2000,
    uiDir: options.uiDir,
    uiBase: normalizeBase(options.uiBase, '/dashboard'),
    protectUiWithAuth: options.protectUiWithAuth !== false,
  };
}

export function resolveDashboardWsPaths(config: ResolvedDashboardConfig): string[] {
  const paths = [`${config.base}/ws`];
  if (config.legacyBase) {
    paths.push(`${config.legacyBase}/ws`);
  }
  return paths;
}
