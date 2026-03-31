# `@omni-queue/next-adapter`

Next.js integration adapter for Omni-Queue dashboard API.

Use the exported Node handler in a Pages Router API catch-all route and host it within your existing Next application.

## Usage

```ts
import path from 'node:path';
import { omniQueueNextAdapter } from '@omni-queue/next-adapter';

export default omniQueueNextAdapter({
  supervisor,
  apiBase: '/api/omni-queue',
  uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
  protectUiWithAuth: false,
});
```

If you own the underlying Node server, use `bindOmniQueueNextWebSocket()` to attach dashboard WebSocket upgrades with the same auth settings.

If WebSocket upgrades are not available in your Next deployment model, prefer runtime transport override in your host page/template (no dashboard rebuild required):

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/omni-queue',  // must match the apiBase option above
  };
</script>
```

You can also test per-request with the URL query param: `?transport=polling`. For local development only, `VITE_DASHBOARD_TRANSPORT=polling npm run dev` also works.

Publish the UI assets into that folder with:

```bash
queue dashboard:publish --out=./public/omni-queue-dashboard
```

`dashboard:publish` resolves assets from installed `@omni-queue/dashboard` in `node_modules`. A `dashboard-config.example.js` file is also generated in the output directory — see its inline comments for all available runtime config keys.
