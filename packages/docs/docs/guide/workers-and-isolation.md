---
title: Workers and Isolation
description: Choose between inline, thread, and process isolation per queue. Understand the tradeoffs and configuration options.
outline: deep
---

# Workers and Isolation

Vasto lets you pick an execution isolation mode per worker definition. This decision affects fault containment, overhead, and sandbox capabilities.

## Isolation modes at a glance

| Mode | Runs in | Crash containment | Overhead | Best for |
|---|---|---|---|---|
| `inline` | Same process | None — a thrown error propagates | Minimal | Development, trusted jobs, low-latency |
| `thread` | Worker thread | Thread crash does not kill host | Low | CPU-bound work, partial isolation |
| `process` | Child process | Full OS boundary | Moderate | Untrusted payloads, strict sandboxing |

## Inline

Workers execute inside the same Node.js process as the supervisor. Jobs share memory and import scope with the rest of your application.

```ts
const workers = defineWorkers({
  main: {
    queues: ['emails', 'notifications'],
    concurrency: 4,
    isolation: 'inline',
  },
});
```

::: tip When to use inline
Ideal for local development and jobs that are known-safe (e.g., internal microservice calls). It is also the default when isolation is omitted.
:::

## Thread

Workers run in Node.js `worker_threads`. Each thread has its own event loop and memory, but shares the same process address space.

```ts
const workers = defineWorkers({
  media: {
    queues: ['image-resize'],
    concurrency: 2,
    isolation: 'thread',
    workerModule: './dist/worker-entry.js',   // path to your worker bootstrap
    registryModule: './dist/registry.js',
    poolSize: 4,
  },
});
```

::: warning workerModule is required
For `thread` and `process` isolation, the runtime needs a separate module to bootstrap the worker. Generate the entry file with:

```sh
vst generate isolation
```
:::

## Process

Workers run as isolated child processes. This is the strongest boundary — a crashed worker cannot corrupt the supervisor's memory, and you can enforce a strict sandbox.

```ts
const workers = defineWorkers({
  heavy: {
    queues: ['pdf-export'],
    concurrency: 2,
    isolation: 'process',
    workerModule: './dist/worker-entry.js',
    registryModule: './dist/registry.js',
    poolSize: 2,
  },
});
```

### Sandbox configuration

Process-isolated workers support a fine-grained sandbox via the queue's `sandbox` config:

```ts
const queues = defineQueues({
  'pdf-export': {
    name: 'pdf-export',
    connection: 'redis',
    concurrency: 2,
    batchSize: 2,
    sandbox: {
      enabled: true,
      denyNetwork: true,
      denyChildProcessSpawn: true,
      readOnlyFilesystem: true,
      envAllowlist: ['NODE_ENV', 'PDF_FONT_PATH'],
    },
  },
});
```

::: details Sandbox config options
| Option | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Activates the sandbox |
| `denyNetwork` | `boolean` | Blocks network syscalls |
| `denyChildProcessSpawn` | `boolean` | Prevents spawning child processes |
| `readOnlyFilesystem` | `boolean` | Mounts the filesystem read-only |
| `envAllowlist` | `string[]` | Environment variables the worker can see |
| `cwdAllowlist` | `string[]` | Directories the worker is allowed to read |
| `networkAllowlist` | `string[]` | Hosts the worker may connect to |
:::

## Generating the worker entry

When using thread or process isolation, your job registry and plugins must be importable in the worker context without importing your entire application.

```sh
vst generate isolation
```

This generates a `worker-entry.ts` (and optionally `registry.ts`, `plugins.ts`) that you reference in the `workerModule` / `registryModule` / `pluginsModule` fields of your worker config.

## Decision guide

```
Is this a development or test environment?
  └─ Yes → inline

Does the job do CPU-heavy work (image/video/document processing)?
  └─ Yes →
       Does it need a network/filesystem sandbox?
         └─ Yes → process
         └─ No  → thread

Is the job payload user-supplied or externally sourced?
  └─ Yes → process (with sandbox.denyNetwork + denyChildProcessSpawn)

Otherwise → inline or thread based on concurrency needs
```
