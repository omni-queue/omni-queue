import http from 'node:http';
import { Buffer } from 'node:buffer';
import type {
  DashboardAuthContext,
  DashboardAuthDecision,
  DashboardAuthOptions,
  DashboardBasicCredentials,
  DashboardBearerCredentials,
  DashboardRole,
  DashboardScope,
} from '@omni-queue/core';
import type { Request, Response } from 'express';

type DashboardPermission = 'read' | 'operate' | 'admin';

const ROLE_LEVEL: Record<DashboardRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

const SCOPE_BY_PERMISSION: Record<DashboardPermission, DashboardScope> = {
  read: 'dashboard:read',
  operate: 'dashboard:operate',
  admin: 'dashboard:admin',
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

function resolveAuthContext(req: Request): DashboardAuthContext {
  return (resLocalAuth(req) ?? { role: 'admin' }) as DashboardAuthContext;
}

function resLocalAuth(req: Request): DashboardAuthContext | undefined {
  return (req.res?.locals as { dashboardAuth?: DashboardAuthContext } | undefined)?.dashboardAuth;
}

export function getDashboardAuthContext(req: Request): DashboardAuthContext {
  return resolveAuthContext(req);
}

export function hasDashboardPermission(req: Request, permission: DashboardPermission): boolean {
  const authContext = resolveAuthContext(req);
  const role = authContext.role ?? 'admin';

  const requiredLevel = permission === 'read' ? 1 : permission === 'operate' ? 2 : 3;
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

  const requiredScope = SCOPE_BY_PERMISSION[permission];
  const requiredScopeLevel = requiredScope === 'dashboard:read' ? 1 : requiredScope === 'dashboard:operate' ? 2 : 3;

  return scopeLevel >= requiredScopeLevel;
}

export function getAllowedQueues(req: Request): Set<string> | null {
  const authContext = resolveAuthContext(req);
  const queues = authContext.allowedQueues;
  if (!queues || queues.length === 0) {
    return null;
  }

  return new Set(queues);
}

export function sendUnauthorized(
  res: Response,
  auth: DashboardAuthOptions,
  message = 'Unauthorized'
): void {
  const realm = auth.type === 'none' ? 'omni-queue-dashboard' : (auth.realm ?? 'omni-queue-dashboard');
  const challenge = auth.type === 'bearer' ? `Bearer realm="${realm}"` : `Basic realm="${realm}"`;
  res.status(401).set('www-authenticate', challenge).json({ error: message });
}

export async function checkAuth(
  req: Request,
  res: Response,
  auth: DashboardAuthOptions
): Promise<boolean> {
  if (auth.type === 'none') {
    (res.locals as { dashboardAuth?: DashboardAuthContext }).dashboardAuth = { role: 'admin' };
    return true;
  }

  const header = req.headers.authorization;
  if (!header) {
    sendUnauthorized(res, auth);
    return false;
  }

  if (auth.type === 'bearer') {
    if (!header.startsWith('Bearer ')) {
      sendUnauthorized(res, auth, 'Invalid bearer token');
      return false;
    }

    const credentials: DashboardBearerCredentials = {
      token: header.slice(7).trim(),
      request: req as unknown as http.IncomingMessage,
    };

    const authContext = normalizeDecision(await auth.validator(credentials));
    if (!authContext) {
      sendUnauthorized(res, auth, 'Invalid bearer token');
      return false;
    }

    (res.locals as { dashboardAuth?: DashboardAuthContext }).dashboardAuth = authContext;

    return true;
  }

  if (!header.startsWith('Basic ')) {
    sendUnauthorized(res, auth, 'Invalid basic auth');
    return false;
  }

  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const credentials: DashboardBasicCredentials = {
    username: separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded,
    password: separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '',
    request: req as unknown as http.IncomingMessage,
  };

  const authContext = normalizeDecision(await auth.validator(credentials));
  if (!authContext) {
    sendUnauthorized(res, auth, 'Invalid basic auth');
    return false;
  }

  (res.locals as { dashboardAuth?: DashboardAuthContext }).dashboardAuth = authContext;

  return true;
}
