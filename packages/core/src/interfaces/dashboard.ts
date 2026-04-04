export type DashboardAuthType = 'none' | 'basic' | 'bearer';
export type DashboardLoginMode = 'password' | 'token' | 'custom';

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

export interface DashboardSessionCredentials {
  token: string;
  request?: unknown;
}

export interface DashboardPasswordLoginRequest {
  mode: 'password' | 'custom';
  username: string;
  password: string;
  request?: unknown;
}

export interface DashboardTokenLoginRequest {
  mode: 'token';
  token: string;
  request?: unknown;
}

export type DashboardLoginRequest = DashboardPasswordLoginRequest | DashboardTokenLoginRequest;

export interface DashboardAuthSession {
  token: string;
  expiresAt?: number;
  authContext?: DashboardAuthContext;
}

export type DashboardAuthHandler = (
  request: DashboardLoginRequest
) => DashboardAuthSession | null | Promise<DashboardAuthSession | null>;

export type DashboardSessionValidator = (
  credentials: DashboardSessionCredentials
) => DashboardAuthDecision | Promise<DashboardAuthDecision>;

export type DashboardLogoutHandler = (
  credentials: DashboardSessionCredentials
) => void | Promise<void>;

export interface DashboardNoAuthOptions {
  type: 'none';
}

export interface DashboardBasicAuthOptions {
  type: 'basic';
  realm?: string;
  authHandler: DashboardAuthHandler;
  validator?: DashboardSessionValidator;
  sessionValidator?: DashboardSessionValidator;
  authValidator?: DashboardSessionValidator;
  logoutHandler?: DashboardLogoutHandler;
}

export interface DashboardBearerAuthOptions {
  type: 'bearer';
  realm?: string;
  loginMode?: 'token' | 'custom';
  authHandler: DashboardAuthHandler;
  validator?: DashboardSessionValidator;
  sessionValidator?: DashboardSessionValidator;
  authValidator?: DashboardSessionValidator;
  logoutHandler?: DashboardLogoutHandler;
}

export type DashboardAuthOptions =
  | DashboardNoAuthOptions
  | DashboardBasicAuthOptions
  | DashboardBearerAuthOptions;

export interface DashboardOptions {
  streamIntervalMs?: number;
  silencedJobs?: string[];
}
