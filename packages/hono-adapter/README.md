# `@vasto/hono-adapter`

Hono integration adapter for Vasto dashboard API.

Exports a Node handler that can be mounted through a Hono Node bridge.

## Usage

Use `vastoHonoAdapter(options)` with your Hono Node bridge/middleware integration layer.

```ts
import path from 'node:path';
import { vastoHonoAdapter } from '@vasto/hono-adapter';

const handler = vastoHonoAdapter({
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  protectUiWithAuth: false,
});
```

If you own the underlying Node server, use `bindVastoHonoWebSocket()` to attach dashboard WebSocket upgrades with the same auth settings.

## Publishing UI assets

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

`dashboard:publish` resolves assets from installed `@vasto/dashboard` in `node_modules` and copies them into the target directory. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.

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
