# GitHub Copilot Instructions for vasto

## Big picture
- This is an npm workspaces + Turbo monorepo. `packages/core` is the source of truth for runtime behavior; other packages are adapters, storage backends, plugins, dashboard layers, or examples.
- The main runtime split is: `Supervisor` orchestrates workers, scaling, scheduling recovery, lifecycle events, and dashboard ownership, while `JobManager` handles dispatch, execution, retries, flows, batches, scheduling, and storage access. Read [packages/core/src/libs/supervisor.ts](../packages/core/src/libs/supervisor.ts) and [packages/core/src/libs/worker-runtime.ts](../packages/core/src/libs/worker-runtime.ts) together.
- Queue configs are declarative. `defineQueues()` and `defineWorkers()` create plain config objects; `queue.connection` must match a key in `storageAdapters`.
- Jobs are class-based and registry-driven. Every job class must define a unique static `jobName`, and must be registered in `JobRegistry` before execution. See [packages/core/src/libs/registry.ts](../packages/core/src/libs/registry.ts).

## Core patterns to follow
- Prefer the object-style `new Supervisor({ queues, workers, registry, storageAdapters, globalPlugins, dashboard })` constructor; it is the dominant composition pattern in examples and runtime code.
- Keep new runtime capabilities inside `packages/core/src/interfaces/*` + `packages/core/src/libs/*`. Public surface should flow through the interfaces/types and the `src/index.ts` / `src/libs/index.ts` barrels.
- Storage adapters implement the full `QueueStorage` contract; do not add runtime behavior that only works for one backend unless it is explicitly optional. See [packages/core/src/interfaces/queue-storage.ts](../packages/core/src/interfaces/queue-storage.ts).
- Isolation behavior is centralized in `runWithIsolation()` and the thread/process pools. Thread/process workers depend on generated runtime modules (`workerModule`, `registryModule`, `pluginsModule`) rather than direct imports.
- For process/thread isolation examples, follow [examples/queue-system/src/index.ts](../examples/queue-system/src/index.ts) and [examples/redis-isolation](../examples/redis-isolation) instead of inventing a different wiring pattern.

## Dashboard and integration boundaries
- `@vasto-queue/dashboard-api` turns Supervisor-owned dashboard config into HTTP server / request handler / Express middleware. Keep auth and route behavior there, not in `core`.
- `@vasto-queue/dashboard` is a standalone frontend package that talks to dashboard-api endpoints; it should not reach into core internals directly.
- Framework adapters are thin integration layers. If a change affects queue semantics, implement it in `core` first, then surface it through adapters if needed.

## Project-specific conventions
- Examples are treated as executable documentation. When adding a major feature, prefer updating or extending an example rather than documenting only in markdown.
- The docs in `docs/operations/` are more current than older status notes in the root README; use them as the source of truth for roadmap/prod-readiness context.
- Recent Phase 5.5 work added strict sandboxing and error-aware retry policies in core. Reuse those paths instead of creating parallel mechanisms.
- Tests for runtime behavior live mainly in `packages/core/tests/*.test.ts`; keep new core behavior covered there with focused files (for example `sandbox-policy.test.ts`, `retry-policy.test.ts`).

## Useful commands
- Install/build all workspaces: `npm install && npm run build`
- Full monorepo test sweep: `npm test`
- Type check workspace root: `npm run check-types`
- Target only core while iterating: `npm --workspace @vasto-queue/core run build`
- Run focused core tests: `npm --workspace @vasto-queue/core run test -- <pattern>`
- Dashboard UI local dev: `cd packages/dashboard && npm run dev`
- End-to-end Redis isolation flow: `cd examples/redis-isolation && npm run dev:dashboard`
- If thread/process isolation wiring changes, regenerate example isolation artifacts with `vasto generate isolation`.

## Practical guidance for agents
- Before changing queue semantics, inspect `worker-runtime.ts`, `supervisor.ts`, and the relevant `QueueStorage` methods together; behavior is often split across all three.
- Before changing isolation behavior, inspect `isolation.ts`, `thread-pool.ts`, `process-pool.ts`, and `isolation-worker.ts` together.
- Preserve backward compatibility for existing hooks such as `retries()`, `backoff()`, lifecycle plugins, and queue config fields unless the change explicitly updates the public contract.
- Validate core changes with a targeted core build and targeted Vitest runs before broader workspace commands.
