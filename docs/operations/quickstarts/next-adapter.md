# Next adapter quickstart

Use this pattern for Route Handlers or Server Actions that should offload background work.

## Generate a starter

```bash
vasto generate api-job --name=rebuild-search-index -=web-hooks
```

## Example route handler

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const job = new RebuildSearchIndexApiJob({
    requestId: crypto.randomUUID(),
    body,
  });

  const dispatched = await jobManager.dispatch(job);
  return Response.json({ accepted: true, jobId: dispatched.id }, { status: 202 });
}
```

## Notes

- Prefer thin route handlers.
- Push long-running work into the job.
- Pair with dashboard auth scopes when exposing queue telemetry to operators.
