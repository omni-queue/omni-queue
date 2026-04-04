# @vasto/elysia-adapter

Elysia integration adapter for Vasto dashboard hosting.

This adapter gives Elysia and Bun users a supported integration path today by proxying the current dashboard HTTP/static surface through an internal adapter instance and mounting it into your Elysia app.

## Current support

- dashboard API routes
- dashboard static UI hosting
- dashboard auth enforcement
- native Elysia/Bun WebSocket live updates (`/ws` under your configured dashboard API base)
- Bun/Elysia-compatible mounting into your existing app

## Usage

```ts
import path from 'node:path';
import { Elysia } from 'elysia';
import { registerElysiaAdapter } from '@vasto/elysia-adapter';

const app = new Elysia();

const dashboard = registerElysiaAdapter(app, {
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  uiBase: '/',
  protectUiWithAuth: false,
});

await dashboard.waitUntilReady();

app.listen(3000);

// On shutdown:
await dashboard.close();
```

If you need to force polling mode for specific deployments, prefer runtime override (no dashboard rebuild required):

```html
<script>
  window.__VASTO_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/vasto',  // must match the apiBase option above
  };
</script>
```

You can also test per-request with the URL query param: `?transport=polling`. For local development only, `VITE_DASHBOARD_TRANSPORT=polling npm run dev` also works.

Publish the UI assets into that folder with:

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

`dashboard:publish` resolves assets from installed `@vasto/dashboard` in `node_modules`. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.
