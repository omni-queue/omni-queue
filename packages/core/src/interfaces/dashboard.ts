export type DashboardAuthType = 'none' | 'basic' | 'bearer';

export type DashboardRole = 'viewer' | 'operator' | 'admin';
export type DashboardScope = 'dashboard:read' | 'dashboard:operate' | 'dashboard:admin';

export interface DashboardAuthContext {
  role?: DashboardRole;
  scopes?: DashboardScope[];
  tenantId?: string;
  allowedQueues?: string[];
  tokenId?: string;
}

export type DashboardAuthDecision = boolean | DashboardAuthContext;

export interface DashboardApiToken {
  id: string;
  token: string;
  role: DashboardRole;
  scopes?: DashboardScope[];
  tenantId?: string;
  allowedQueues?: string[];
  active?: boolean;
  expiresAt?: number;
}

export interface DashboardBasicCredentials {
  username: string;
  password: string;
  request?: unknown;
}

export interface DashboardBearerCredentials {
  token: string;
  request?: unknown;
}

export interface DashboardNoAuthOptions {
  type: 'none';
}

export interface DashboardBasicAuthOptions {
  type: 'basic';
  realm?: string;
  validator: (credentials: DashboardBasicCredentials) => DashboardAuthDecision | Promise<DashboardAuthDecision>;
}

export interface DashboardBearerAuthOptions {
  type: 'bearer';
  realm?: string;
  validator: (credentials: DashboardBearerCredentials) => DashboardAuthDecision | Promise<DashboardAuthDecision>;
}

export type DashboardAuthOptions =
  | DashboardNoAuthOptions
  | DashboardBasicAuthOptions
  | DashboardBearerAuthOptions;

export interface DashboardOptions {
  enabled?: boolean;
  endpoint?: string;
  auth?: DashboardAuthOptions;
  streamIntervalMs?: number;
  silencedJobs?: string[];
}
