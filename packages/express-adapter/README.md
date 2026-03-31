# `@omni-queue/express-adapter`

Default framework adapter for Omni-Queue dashboard integration.

Built on top of `@omni-queue/dashboard-api` and intended for Express/Connect-compatible apps.

This package does not start an HTTP server for you. Mount it into your existing Express app, optionally serve the built UI, and bind WebSocket upgrades on the server you own.

## Installation

```bash
npm install @omni-queue/express-adapter
```

## Usage

```ts
import express from 'express';
import path from 'node:path';
import {
  createExpressAdapter,
  createExpressWebSocketBinding,
} from '@omni-queue/express-adapter';

const app = express();
app.use(
  createExpressAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: true,
  })
);

const server = app.listen(3210);

createExpressWebSocketBinding(server, {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

`auth`, `uiDir`, `uiBase`, and `protectUiWithAuth` are all configured through the adapter options.

Publish the UI assets into that folder with:

```bash
queue dashboard:publish --out=./public/omni-queue-dashboard
```

`dashboard:publish` resolves assets from installed `@omni-queue/dashboard` in `node_modules`.
