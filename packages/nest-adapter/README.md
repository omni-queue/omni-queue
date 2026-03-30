# `@omni-queue/nest-adapter`

NestJS integration adapter for Omni-Queue dashboard API.

Use the adapter middleware with an Express-based Nest app.

## Usage

```ts
import { omniQueueNestAdapter } from '@omni-queue/nest-adapter';

app.use(
	omniQueueNestAdapter({
		supervisor,
		apiBase: '/api/omni-queue',
	})
);
```
