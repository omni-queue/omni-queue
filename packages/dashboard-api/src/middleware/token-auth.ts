import type {
  DashboardApiToken,
  DashboardAuthContext,
  DashboardBearerAuthOptions,
  DashboardSessionCredentials,
} from '@vasto-queue/core';

export type TokenAuthOptions = {
  tokens: DashboardApiToken[];
  realm?: string;
};

function toContext(token: DashboardApiToken): DashboardAuthContext {
  return {
    role: token.role,
    ...(token.scopes ? { scopes: token.scopes } : {}),
    ...(token.tenantId ? { tenantId: token.tenantId } : {}),
    ...(token.allowedQueues ? { allowedQueues: token.allowedQueues } : {}),
    tokenId: token.id,
  };
}

export function createScopedBearerAuth(options: TokenAuthOptions): DashboardBearerAuthOptions {
  const getActiveToken = (credentials: DashboardSessionCredentials): DashboardApiToken | null => {
    const now = Date.now();
    const match = options.tokens.find((token) => token.token === credentials.token);
    if (!match) {
      return null;
    }

    if (match.active === false) {
      return null;
    }

    if (match.expiresAt != null && match.expiresAt <= now) {
      return null;
    }

    return match;
  };

  return {
    type: 'bearer',
    loginMode: 'token',
    ...(options.realm ? { realm: options.realm } : {}),
    authHandler: async (credentials) => {
      if (credentials.mode !== 'token') {
        return null;
      }

      const match = getActiveToken({ token: credentials.token, request: credentials.request });
      if (!match) {
        return null;
      }

      return {
        token: match.token,
        authContext: toContext(match),
        ...(match.expiresAt != null ? { expiresAt: match.expiresAt } : {}),
      };
    },
    sessionValidator: async (credentials) => {
      const match = getActiveToken(credentials);
      if (!match) {
        return false;
      }

      return toContext(match);
    },
  };
}

export function rotateScopedBearerTokens(
  currentTokens: DashboardApiToken[],
  updates: Array<
    | { op: 'add'; token: DashboardApiToken }
    | { op: 'disable'; tokenId: string }
    | { op: 'replace'; tokenId: string; token: DashboardApiToken }
  >
): DashboardApiToken[] {
  const next = [...currentTokens];

  for (const update of updates) {
    if (update.op === 'add') {
      next.push(update.token);
      continue;
    }

    const index = next.findIndex((token) => token.id === update.tokenId);
    if (index < 0) {
      continue;
    }

    if (update.op === 'disable') {
      next[index] = {
        ...next[index]!,
        active: false,
      };
      continue;
    }

    next[index] = update.token;
  }

  return next;
}
