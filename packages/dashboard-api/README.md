# @omni-queue/dashboard-api

HTTP bindings for Omni Queue dashboard APIs.

## Purpose

`@omni-queue/core` only stores dashboard configuration on `Supervisor`. This package turns that configuration into:

- shared dashboard primitives for provider adapters:
  - dashboard config + WS path resolution helpers (`resolveDashboardConfig`, `resolveDashboardWsPaths`)
  - transport-agnostic auth helpers (`authenticateDashboardRequest`, permission checks)
  - dashboard query/service helpers used by framework adapters to implement HTTP routes

It does not create an Express app, start a server, or serve static UI files directly. Those responsibilities belong to the provider adapter.

Default provider adapter package: `@omni-queue/express-adapter`.

## Example

```ts
import express from 'express';
import path from 'node:path';
import { Supervisor } from '@omni-queue/core';
import {
  createExpressAdapter,
  createExpressWebSocketBinding,
} from '@omni-queue/express-adapter';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
});

const app = express();
app.use(
  createExpressAdapter({
    supervisor,
    apiBase: '/queue-manager',
    auth: {
      type: 'basic',
      validator: ({ username, password }) => username === 'test' && password === 'password',
    },
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
  })
);

const server = app.listen(3210);
createExpressWebSocketBinding(server, {
  supervisor,
  apiBase: '/queue-manager',
  auth: {
    type: 'basic',
    validator: ({ username, password }) => username === 'test' && password === 'password',
  },
});

// publish assets first:
// queue dashboard:publish --out=./public/omni-queue-dashboard
// (resolved from installed @omni-queue/dashboard in node_modules)
```
