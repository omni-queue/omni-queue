# `@vasto/express-adapter`

Default framework adapter for Vasto dashboard integration.

Built on top of `@vasto/dashboard-api` and intended for Express/Connect-compatible apps.

This package does not start an HTTP server for you. Mount it into your existing Express app, optionally serve the built UI, and bind WebSocket upgrades on the server you own.

## Installation

```bash
npm install @vasto/express-adapter
```

## Usage

```ts
import express from 'express';
import path from 'node:path';
import {
  createExpressAdapter,
  createExpressWebSocketBinding,
} from '@vasto/express-adapter';

const app = express();
app.use(
  createExpressAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    uiBase: '/',
    protectUiWithAuth: false,
  })
);

const server = app.listen(3210);

createExpressWebSocketBinding(server, {
  supervisor,
  apiBase: '/api/vasto',
});
```

`auth`, `uiDir`, `uiBase`, and `protectUiWithAuth` are all configured through the adapter options. When using the built-in dashboard login UI, keep `protectUiWithAuth: false` so the SPA can render its own sign-in screen before calling the protected API routes.

Publish the UI assets into that folder with:

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

`dashboard:publish` resolves assets from installed `@vasto/dashboard` in `node_modules`. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.

## Runtime configuration

If WebSocket upgrades are unavailable (proxy, serverless platform, CDN), force polling without rebuilding the dashboard by injecting a config object before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__VASTO_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/vasto',  // must match the apiBase option above
  };
</script>
```

You can also test per-request with the URL query param: `?transport=polling`.
