import http from 'node:http';
import { Buffer } from 'node:buffer';
import type {
  DashboardAuthContext,
  DashboardAuthDecision,
  DashboardAuthOptions,
  DashboardBasicCredentials,
  DashboardBearerCredentials,
  DashboardRole,
} from '@omni-queue/core';

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

export async function authenticateDashboardRequest(
  request: http.IncomingMessage,
  auth: DashboardAuthOptions
): Promise<DashboardAuthContext | null> {
  if (auth.type === 'none') {
    return { role: 'admin' };
  }

  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  if (auth.type === 'bearer') {
    if (!header.startsWith('Bearer ')) {
      return null;
    }

    const credentials: DashboardBearerCredentials = {
      token: header.slice(7).trim(),
      request,
    };

    return normalizeDecision(await auth.validator(credentials));
  }

  if (!header.startsWith('Basic ')) {
    return null;
  }

  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const credentials: DashboardBasicCredentials = {
    username: separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded,
    password: separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '',
    request,
  };

  return normalizeDecision(await auth.validator(credentials));
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
