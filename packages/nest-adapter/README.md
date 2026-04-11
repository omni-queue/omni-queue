# `@vasto-queue/nest-adapter`

NestJS integration adapter for Vasto dashboard API.

Use the adapter middleware with an Express-based Nest app.

## Usage

```ts
import path from 'node:path';
import {
  bindVastoNestWebSocket,
  vastoNestAdapter,
} from '@vasto-queue/nest-adapter';

app.use(
  vastoNestAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    uiBase: '/',
    protectUiWithAuth: false,
  })
);

bindVastoNestWebSocket(app.getHttpServer(), {
  supervisor,
  apiBase: '/api/vasto',
});
```

## Publishing UI assets

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

`dashboard:publish` resolves assets from installed `@vasto-queue/dashboard` in `node_modules` and copies them into the target directory. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.

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
