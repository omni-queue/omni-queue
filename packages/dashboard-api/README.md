# @vasto-queue/dashboard-api

HTTP bindings for Vasto dashboard APIs.

## Purpose

`@vasto-queue/core` only stores dashboard configuration on `Supervisor`. This package turns that configuration into:

- shared dashboard primitives for provider adapters:
  - dashboard config + WS path resolution helpers (`resolveDashboardConfig`, `resolveDashboardWsPaths`)
  - transport-agnostic auth helpers (`authenticateDashboardRequest`, permission checks)
  - dashboard query/service helpers used by framework adapters to implement HTTP routes

It does not create an Express app, start a server, or serve static UI files directly. Those responsibilities belong to the provider adapter.

Default provider adapter package: `@vasto-queue/express-adapter`.

## Example

```ts
import express from 'express';
import path from 'node:path';
import { Supervisor } from '@vasto-queue/core';
import {
  createExpressAdapter,
  createExpressWebSocketBinding,
} from '@vasto-queue/express-adapter';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
});

const dashboardAuth = {
  type: 'basic' as const,
  authHandler: async (request) => {
    if (request.mode === 'token') {
      return null;
    }

    if (request.username !== 'test' || request.password !== 'password') {
      return null;
    }

    return {
      token: 'dashboard-session-token',
      authContext: { role: 'admin' as const },
    };
  },
  sessionValidator: async ({ token }: { token: string }) =>
    token === 'dashboard-session-token' ? { role: 'admin' as const } : false,
};

const app = express();
app.use(
  createExpressAdapter({
    supervisor,
    apiBase: '/queue-manager',
    auth: dashboardAuth,
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    uiBase: '/',
    protectUiWithAuth: false,
  })
);

const server = app.listen(3210);
createExpressWebSocketBinding(server, {
  supervisor,
  apiBase: '/queue-manager',
  auth: dashboardAuth,
});

// publish assets first:
// queue dashboard:publish --out=./public/vasto-dashboard
// (resolved from installed @vasto-queue/dashboard in node_modules)
```

The dashboard UI now handles login itself. Serve the static shell publicly (`protectUiWithAuth: false`), then protect the API and WebSocket endpoints with `authHandler` + `sessionValidator`.
