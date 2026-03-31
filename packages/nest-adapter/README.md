# `@omni-queue/nest-adapter`

NestJS integration adapter for Omni-Queue dashboard API.

Use the adapter middleware with an Express-based Nest app.

## Usage

```ts
import path from 'node:path';
import {
  bindOmniQueueNestWebSocket,
  omniQueueNestAdapter,
} from '@omni-queue/nest-adapter';

app.use(
  omniQueueNestAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: false,
  })
);

bindOmniQueueNestWebSocket(app.getHttpServer(), {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

## Publishing UI assets

```bash
queue dashboard:publish --out=./public/omni-queue-dashboard
```

`dashboard:publish` resolves assets from installed `@omni-queue/dashboard` in `node_modules` and copies them into the target directory. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.

## Runtime configuration

If WebSocket upgrades are unavailable (proxy, serverless platform, CDN), force polling without rebuilding the dashboard by injecting a config object before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/omni-queue',  // must match the apiBase option above
  };
</script>
```

You can also test per-request with the URL query param: `?transport=polling`.
