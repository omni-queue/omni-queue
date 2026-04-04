import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import type { DashboardAuthOptions } from '@vasto/core';
import {
  authenticateDashboardLogin,
  authenticateDashboardRequest,
  resolveDashboardLoginMode,
} from './auth';
import { createScopedBearerAuth } from './token-auth';

function mockRequest(url: string, authorization?: string): http.IncomingMessage {
  return {
    url,
    headers: authorization ? { authorization } : {},
  } as http.IncomingMessage;
}

describe('dashboard interactive auth', () => {
  it('resolves login modes for interactive auth types', () => {
    expect(resolveDashboardLoginMode({ type: 'none' })).toBeNull();
    expect(
      resolveDashboardLoginMode({
        type: 'basic',
        authHandler: async () => ({ token: 'session-basic' }),
        sessionValidator: async () => ({ role: 'admin' }),
      })
    ).toBe('password');
    expect(
      resolveDashboardLoginMode({
        type: 'bearer',
        loginMode: 'custom',
        authHandler: async () => ({ token: 'session-custom' }),
        sessionValidator: async () => ({ role: 'admin' }),
      })
    ).toBe('custom');
  });

  it('authenticates a basic login through the backend auth handler', async () => {
    const auth: DashboardAuthOptions = {
      type: 'basic',
      authHandler: async (request) => {
        if (request.mode === 'token') {
          return null;
        }

        if (request.username !== 'admin' || request.password !== 'secret') {
          return null;
        }

        return {
          token: 'issued-session-token',
          authContext: { role: 'admin' },
        };
      },
      sessionValidator: async ({ token }) => (token === 'issued-session-token' ? { role: 'admin' } : false),
    };

    const session = await authenticateDashboardLogin(
      {
        mode: 'password',
        username: 'admin',
        password: 'secret',
      },
      auth
    );

    expect(session?.token).toBe('issued-session-token');
    expect(session?.authContext?.role).toBe('admin');
  });

  it('accepts websocket access tokens in query params', async () => {
    const auth = createScopedBearerAuth({
      tokens: [
        {
          id: 'token-1',
          token: 'query-token',
          role: 'admin',
        },
      ],
    });

    const authContext = await authenticateDashboardRequest(
      mockRequest('/api/dashboard/ws?access_token=query-token'),
      auth
    );

    expect(authContext?.role).toBe('admin');
    expect(authContext?.tokenId).toBe('token-1');
  });
});
