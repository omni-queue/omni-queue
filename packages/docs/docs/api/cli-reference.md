---
title: CLI Reference
description: Complete reference for all vasto / vst CLI commands.
outline: deep
---

# CLI Reference

`vasto` and `vst` are interchangeable aliases.

::: code-group

```sh [npm]
npm install -g @vasto-queue/cli
```

```sh [pnpm]
pnpm add -g @vasto-queue/cli
```

:::

---

## Project setup

### `vasto init`

Scaffold a new Vasto project in the current directory.

```sh
vst init
```

---

## Generators

### `vasto generate job`

Generate a typed job class.

```sh
vst generate job --name=SendEmail
# → src/jobs/send-email.job.ts
```

### `vasto generate api-job`

Generate a job class wired for dispatch from an HTTP handler (includes route example).

```sh
vst generate api-job --name=PublishWebhook
```

### `vasto generate workflow`

Generate a flow (DAG) definition with two example nodes.

```sh
vst generate workflow --name=ReportFlow
```

### `vasto generate scheduled`

Generate a recurring scheduled job.

```sh
vst generate scheduled --name=DailyDigest
```

### `vasto generate isolation`

Generate the `worker-entry.ts`, `registry.ts`, and `plugins.ts` bootstrap files required for thread or process isolation.

```sh
vst generate isolation
```

::: tip
Run this command whenever you add new job classes that will run in thread or process isolation. The generated registry file must import all job classes that workers will execute.
:::

---

## Failed jobs

### `vasto failed:list`

List failed jobs for a queue.

```sh
vst failed:list --queue=emails
vst failed:list --queue=emails --limit=50
```

| Flag | Description |
|---|---|
| `--queue` | Queue name |
| `--limit` | Max results (default: 20) |

### `vasto failed:retry`

Retry a single failed job by ID.

```sh
vst failed:retry --queue=emails --id=<jobId>
```

### `vasto failed:retry-all`

Retry all failed jobs in a queue.

```sh
vst failed:retry-all --queue=emails
```

---

## Dashboard

### `vasto dashboard:publish`

Copy the dashboard frontend assets into your project so they can be served by a framework adapter.

```sh
vst dashboard:publish --base=/dashboard --api-base=/api/vasto
```

| Flag | Required | Description |
|---|---|---|
| `--base` | Yes | URL base path for the dashboard UI |
| `--api-base` | Yes | URL base path for the dashboard API |
| `--out` | No | Output directory (default: `public/vasto-dashboard`) |
