# `@omni-queue/hono-adapter`

Hono integration adapter for Omni-Queue dashboard API.

Exports a Node handler that can be mounted through a Hono Node bridge.

## Usage

Use `omniQueueHonoAdapter(options)` with your Hono Node bridge/middleware integration layer.

```ts
import path from 'node:path';
import { omniQueueHonoAdapter } from '@omni-queue/hono-adapter';

const handler = omniQueueHonoAdapter({
  supervisor,
  apiBase: '/api/omni-queue',
  uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
  protectUiWithAuth: true,
});
```

If you own the underlying Node server, use `bindOmniQueueHonoWebSocket()` to attach dashboard WebSocket upgrades with the same auth settings.

Publish the UI assets into that folder with `queue dashboard:publish --out=./public/omni-queue-dashboard`.
