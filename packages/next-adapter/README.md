# `@omni-queue/next-adapter`

Next.js integration adapter for Omni-Queue dashboard API.

Use the exported Node handler in a Pages Router API catch-all route and host it within your existing Next application.

## Usage

```ts
import { omniQueueNextAdapter } from '@omni-queue/next-adapter';

export default omniQueueNextAdapter({
	supervisor,
	apiBase: '/api/omni-queue',
});
```
