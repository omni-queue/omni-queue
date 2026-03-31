import {
  API_BASE,
  type DashboardAuthConfigResponse,
  type DashboardAuthSessionResponse,
  type DashboardLoginResponse,
} from './types';

const DASHBOARD_AUTH_TOKEN_KEY = 'omni-queue.dashboard.token';
export const DASHBOARD_AUTH_EXPIRED_EVENT = 'omni-queue-dashboard-auth-expired';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredDashboardToken(): string | null {
  if (!canUseStorage()) {
    return null;
  }

  const token = window.localStorage.getItem(DASHBOARD_AUTH_TOKEN_KEY);
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  return trimmed || null;
}

export function setStoredDashboardToken(token: string | null): void {
  if (!canUseStorage()) {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(DASHBOARD_AUTH_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(DASHBOARD_AUTH_TOKEN_KEY, token);
}

export function clearStoredDashboardToken(): void {
  setStoredDashboardToken(null);
}

export function dispatchDashboardAuthExpired(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(DASHBOARD_AUTH_EXPIRED_EVENT));
}

function withAuthorization(headers: Headers): Headers {
  const token = getStoredDashboardToken();
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return headers;
}

export async function dashboardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = withAuthorization(new Headers(init?.headers));
  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    dispatchDashboardAuthExpired();
  }

  return response;
}

export function resolveDashboardWsUrl(): string {
  const httpBase = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
  const httpUrl = new URL(httpBase, window.location.origin);
  httpUrl.pathname = `${httpUrl.pathname.replace(/\/$/, '')}/ws`;
  const token = getStoredDashboardToken();
  if (token) {
    httpUrl.searchParams.set('access_token', token);
  }

  const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${httpUrl.host}${httpUrl.pathname}${httpUrl.search}`;
}

export async function fetchDashboardAuthConfig(): Promise<DashboardAuthConfigResponse> {
  const response = await fetch(`${API_BASE}/auth/config`);
  if (!response.ok) {
    throw new Error(`Failed to load auth config: ${response.status}`);
  }

  return response.json() as Promise<DashboardAuthConfigResponse>;
}

export async function fetchDashboardSession(token: string): Promise<DashboardAuthSessionResponse> {
  const response = await fetch(`${API_BASE}/auth/session`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Unauthorized' : `Failed to validate session: ${response.status}`);
  }

  return response.json() as Promise<DashboardAuthSessionResponse>;
}

export async function postDashboardLogin(body: unknown): Promise<DashboardLoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Login failed');
  }

  return response.json() as Promise<DashboardLoginResponse>;
}

export async function postDashboardLogout(token: string | null): Promise<void> {
  const headers = new Headers();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers,
  }).catch(() => undefined);
}
