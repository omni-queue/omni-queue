# `@omni-queue/fastify-adapter`

Fastify integration adapter for Omni-Queue dashboard API.

For in-process mounting, ensure Fastify has middleware support (`@fastify/middie` or `@fastify/express`) and then mount the adapter middleware into your app.

## Usage

```ts
import { omniQueueFastifyAdapter } from '@omni-queue/fastify-adapter';

await fastify.register(import('@fastify/middie'));
fastify.use(
	omniQueueFastifyAdapter({
		supervisor,
		apiBase: '/api/omni-queue',
	})
);
```
