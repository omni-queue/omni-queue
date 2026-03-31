import type { DashboardAuthContext, DashboardAuthOptions } from '@omni-queue/core';
import { authenticateDashboardRequest, hasDashboardPermissionForContext } from './auth';

type DashboardPermission = 'read' | 'operate' | 'admin';

function resolveAuthContext(req: any): DashboardAuthContext {
  return (resLocalAuth(req) ?? { role: 'admin' }) as DashboardAuthContext;
}

function resLocalAuth(req: any): DashboardAuthContext | undefined {
  return (req.res?.locals as { dashboardAuth?: DashboardAuthContext } | undefined)?.dashboardAuth;
}

export function getDashboardAuthContext(req: any): DashboardAuthContext {
  return resolveAuthContext(req);
}

export function hasDashboardPermission(req: any, permission: DashboardPermission): boolean {
  const authContext = resolveAuthContext(req);
  return hasDashboardPermissionForContext(authContext, permission);
}

export function getAllowedQueues(req: any): Set<string> | null {
  const authContext = resolveAuthContext(req);
  const queues = authContext.allowedQueues;
  if (!queues || queues.length === 0) {
    return null;
  }

  return new Set(queues);
}

export function sendUnauthorized(
  res: any,
  auth: DashboardAuthOptions,
  message = 'Unauthorized'
): void {
  const realm = auth.type === 'none' ? 'omni-queue-dashboard' : (auth.realm ?? 'omni-queue-dashboard');
  const challenge = auth.type === 'bearer' ? `Bearer realm="${realm}"` : `Basic realm="${realm}"`;
  res.status(401).set('www-authenticate', challenge).json({ error: message });
}

export async function checkAuth(req: any, res: any, auth: DashboardAuthOptions): Promise<boolean> {
  const authContext = await authenticateDashboardRequest(req, auth);
  if (!authContext) {
    sendUnauthorized(res, auth);
    return false;
  }

  (res.locals as { dashboardAuth?: DashboardAuthContext }).dashboardAuth = authContext;
  return true;
}
