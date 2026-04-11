import http from 'node:http';
import type {
  DashboardAuthContext,
  DashboardAuthDecision,
  DashboardAuthHandler,
  DashboardAuthOptions,
  DashboardLoginMode,
  DashboardLoginRequest,
  DashboardRole,
  DashboardSessionCredentials,
  DashboardSessionValidator,
} from '@vasto-queue/core';

type DashboardPermission = 'read' | 'operate' | 'admin';

const ROLE_LEVEL: Record<DashboardRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function normalizeDecision(decision: DashboardAuthDecision): DashboardAuthContext | null {
  if (decision === true) {
    return { role: 'admin' };
  }

  if (!decision) {
    return null;
  }

  return {
    ...decision,
    ...(decision.role ? {} : { role: 'admin' }),
  };
}

function permissionToLevel(permission: DashboardPermission): number {
  return permission === 'read' ? 1 : permission === 'operate' ? 2 : 3;
}

export function resolveDashboardLoginMode(auth: DashboardAuthOptions): DashboardLoginMode | null {
  if (auth.type === 'none') {
    return null;
  }

  if (auth.type === 'basic') {
    return 'password';
  }

  return auth.loginMode ?? 'token';
}

export function resolveDashboardSessionValidator(
  auth: DashboardAuthOptions
): DashboardSessionValidator | null {
  if (auth.type === 'none') {
    return null;
  }

  return auth.sessionValidator ?? auth.authValidator ?? auth.validator ?? null;
}

export function resolveDashboardAuthHandler(auth: DashboardAuthOptions): DashboardAuthHandler | null {
  if (auth.type === 'none') {
    return null;
  }

  return auth.authHandler;
}

export function resolveDashboardChallenge(auth: DashboardAuthOptions): string {
  const realm = auth.type === 'none' ? 'vasto-dashboard' : (auth.realm ?? 'vasto-dashboard');
  return `Bearer realm="${realm}"`;
}

export function extractDashboardBearerToken(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }

  const requestUrl = request.url;
  if (!requestUrl) {
    return null;
  }

  try {
    const parsed = new URL(requestUrl, 'http://localhost');
    const token = parsed.searchParams.get('access_token') ?? parsed.searchParams.get('token');
    if (!token) {
      return null;
    }

    const trimmed = token.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export async function authenticateDashboardSession(
  credentials: DashboardSessionCredentials,
  auth: DashboardAuthOptions
): Promise<DashboardAuthContext | null> {
  if (auth.type === 'none') {
    return { role: 'admin' };
  }

  const validator = resolveDashboardSessionValidator(auth);
  if (!validator) {
    return null;
  }

  return normalizeDecision(await validator(credentials));
}

export async function authenticateDashboardLogin(
  request: DashboardLoginRequest,
  auth: DashboardAuthOptions
) {
  if (auth.type === 'none') {
    return null;
  }

  const authHandler = resolveDashboardAuthHandler(auth);
  if (!authHandler) {
    return null;
  }

  return authHandler(request);
}

export async function authenticateDashboardRequest(
  request: http.IncomingMessage,
  auth: DashboardAuthOptions
): Promise<DashboardAuthContext | null> {
  if (auth.type === 'none') {
    return { role: 'admin' };
  }

  const token = extractDashboardBearerToken(request);
  if (!token) {
    return null;
  }

  return authenticateDashboardSession({ token, request }, auth);
}

export function hasDashboardPermissionForContext(
  authContext: DashboardAuthContext,
  permission: DashboardPermission
): boolean {
  const role = authContext.role ?? 'admin';
  const requiredLevel = permissionToLevel(permission);
  if ((ROLE_LEVEL[role] ?? 0) < requiredLevel) {
    return false;
  }

  if (authContext.scopes == null || authContext.scopes.length === 0) {
    return true;
  }

  const scopeLevel = authContext.scopes.reduce<number>((level, scope) => {
    if (scope === 'dashboard:admin') return Math.max(level, 3);
    if (scope === 'dashboard:operate') return Math.max(level, 2);
    if (scope === 'dashboard:read') return Math.max(level, 1);
    return level;
  }, 0);

  return scopeLevel >= requiredLevel;
}
