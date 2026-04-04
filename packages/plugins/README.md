# `@vasto/plugins`

Reusable plugins for Vasto.

## Included helpers

- `DAGPlugin` — blocks jobs until registered dependencies are complete
- `IdempotencyPlugin(store)` — skips duplicate jobs using idempotency keys
- `LoggingPlugin()` — logs enqueue, start, completion and failures
- `RateLimiterPlugin` — throttles processing per queue with token buckets
- `TimingPlugin()` — measures duration for completed and failed jobs
- `HookPlugin()` — adapts plain callbacks to the `Plugin` interface
- `composePlugins()` — flattens plugin arrays and removes falsy values

## Usage

```ts
import { LoggingPlugin, TimingPlugin } from '@vasto/plugins';

const plugins = [
  LoggingPlugin(),
  TimingPlugin({
    onMeasure(job, durationMs, status) {
      console.log(job.name, durationMs, status);
    },
  }),
];
```
