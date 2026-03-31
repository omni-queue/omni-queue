# `@omni-queue/fastify-adapter`

Fastify integration adapter for Omni-Queue dashboard API.

For in-process mounting, ensure Fastify has middleware support (`@fastify/middie` or `@fastify/express`) and then mount the adapter middleware into your app.

## Usage

```ts
import path from 'node:path';
import {
  bindOmniQueueFastifyWebSocket,
  omniQueueFastifyAdapter,
} from '@omni-queue/fastify-adapter';

await fastify.register(import('@fastify/middie'));
fastify.use(
  omniQueueFastifyAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: true,
  })
);

bindOmniQueueFastifyWebSocket(fastify.server, {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

Publish the UI assets into that folder with `queue dashboard:publish --out=./public/omni-queue-dashboard`.
