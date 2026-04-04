import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearStoredDashboardToken,
  DASHBOARD_AUTH_EXPIRED_EVENT,
  fetchDashboardAuthConfig,
  fetchDashboardSession,
  getStoredDashboardToken,
  postDashboardLogin,
  postDashboardLogout,
  setStoredDashboardToken,
} from '../auth';
import type {
  DashboardAuthConfigResponse,
  DashboardAuthContext,
  DashboardAuthType,
  DashboardLoginMode,
} from '../types';

type DashboardAuthContextValue = {
  ready: boolean;
  requiresAuth: boolean;
  isAuthenticated: boolean;
  authType: DashboardAuthType;
  loginMode: DashboardLoginMode | null;
  authContext: DashboardAuthContext | null;
  login: (credentials: { token: string } | { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const DashboardAuthContextObject = createContext<DashboardAuthContextValue | undefined>(undefined);

const DEFAULT_CONFIG: DashboardAuthConfigResponse = {
  requiresAuth: false,
  authType: 'none',
  loginMode: null,
};

export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<DashboardAuthConfigResponse>(DEFAULT_CONFIG);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authContext, setAuthContext] = useState<DashboardAuthContext | null>(null);

  const clearAuthState = useCallback(() => {
    clearStoredDashboardToken();
    setIsAuthenticated(false);
    setAuthContext(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const nextConfig = await fetchDashboardAuthConfig();
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);

        if (!nextConfig.requiresAuth) {
          setIsAuthenticated(true);
          setAuthContext({ role: 'admin' });
          setReady(true);
          return;
        }

        const token = getStoredDashboardToken();
        if (!token) {
          clearAuthState();
          setReady(true);
          return;
        }

        try {
          const session = await fetchDashboardSession(token);
          if (cancelled) {
            return;
          }

          setIsAuthenticated(session.authenticated);
          setAuthContext(session.authContext ?? null);
        } catch {
          if (!cancelled) {
            clearAuthState();
          }
        } finally {
          if (!cancelled) {
            setReady(true);
          }
        }
      } catch {
        if (!cancelled) {
          clearAuthState();
          setConfig(DEFAULT_CONFIG);
          setReady(true);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [clearAuthState]);

  useEffect(() => {
    const handleExpired = () => {
      clearAuthState();
    };

    window.addEventListener(DASHBOARD_AUTH_EXPIRED_EVENT, handleExpired);
    return () => {
      window.removeEventListener(DASHBOARD_AUTH_EXPIRED_EVENT, handleExpired);
    };
  }, [clearAuthState]);

  const login = useCallback(
    async (credentials: { token: string } | { username: string; password: string }) => {
      const session = await postDashboardLogin(credentials);
      setStoredDashboardToken(session.token);
      setIsAuthenticated(true);
      setAuthContext(session.authContext ?? null);
    },
    []
  );

  const logout = useCallback(async () => {
    const token = getStoredDashboardToken();
    await postDashboardLogout(token);
    clearAuthState();
  }, [clearAuthState]);

  const value = useMemo<DashboardAuthContextValue>(
    () => ({
      ready,
      requiresAuth: config.requiresAuth,
      isAuthenticated,
      authType: config.authType,
      loginMode: config.loginMode,
      authContext,
      login,
      logout,
    }),
    [authContext, config.authType, config.loginMode, config.requiresAuth, isAuthenticated, login, logout, ready]
  );

  return <DashboardAuthContextObject.Provider value={value}>{children}</DashboardAuthContextObject.Provider>;
}

export function useDashboardAuth() {
  const value = useContext(DashboardAuthContextObject);
  if (!value) {
    throw new Error('useDashboardAuth must be used within DashboardAuthProvider');
  }

  return value;
}
