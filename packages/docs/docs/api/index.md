---
title: API Reference
description: Complete reference for Vasto's runtime API, storage adapters, and CLI.
---

# API Reference

<div class="vp-doc">

This section documents Vasto's public surface area. For a walkthrough approach, start with the [Guide](/guide/getting-started).

</div>

## In this section

<div class="tip custom-block" style="padding-top: 8px">

| Page | What's covered |
|---|---|
| [Core Runtime](/api/core-runtime) | `Supervisor`, `JobManager`, `JobRegistry`, `defineQueues`, `defineWorkers`, `Job`, dispatch options, schedule options |
| [Storage Adapters](/api/storage-adapters) | `QueueStorage` contract, constructor signatures for all 7 adapters |
| [CLI Reference](/api/cli-reference) | All `vasto` / `vst` commands with flags and examples |

</div>

## Package layout

```
@vasto/core
  src/contracts/job.ts         — Job base class
  src/interfaces/
    queue-config.ts            — QueueConfig, defineQueues()
    worker-config.ts           — WorkerConfig, defineWorkers()
    queue-storage.ts           — QueueStorage contract
    plugin.ts                  — Plugin interface
  src/libs/
    supervisor.ts              — Supervisor
    worker-runtime.ts          — JobManager
    registry.ts                — JobRegistry
    isolation.ts               — runWithIsolation()
  src/types.ts                 — StoredJob, DispatchOptions, ScheduleOptions, …
  src/index.ts                 — public barrel
```
