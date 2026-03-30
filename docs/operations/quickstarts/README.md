# Adapter Quickstarts

These quickstarts show the recommended application shapes for official Omni Queue adapters and integration styles.

## Available quickstarts

- [Express adapter](express-adapter.md)
- [Next adapter](next-adapter.md)
- [Fastify adapter](fastify-adapter.md)
- [Nest adapter](nest-adapter.md)
- [Hono adapter](hono-adapter.md)

## How to use these guides

Each quickstart is intentionally short:

1. Generate a starter with the CLI.
2. Wire the generated job into your route or service layer.
3. Keep validation at the framework edge.
4. Keep side effects in the job handler.
5. Add reliability controls once the baseline path is working.

## Recommended CLI commands

```bash
queue generate:api-job --name=send-email
queue generate:workflow --name=asset-pipeline
queue generate:scheduled --name=daily-digest
```

## Choosing the right starter

- Use **API job** starters when an HTTP request should enqueue work and return quickly.
- Use **workflow** starters when the work has explicit dependency ordering.
- Use **scheduled** starters when recurring maintenance or batch tasks need cron-like execution.

## Next steps

- For BullMQ users, continue with the [migration guide](../migration-guides/from-bullmq.md)
- For production rollout, review the [capacity planning toolkit](../phase-5/capacity-planning-toolkit.md)
