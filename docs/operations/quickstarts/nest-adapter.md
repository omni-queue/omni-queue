# Nest adapter quickstart

Use this pattern when a Nest controller or service should hand work to Omni Queue.

## Generate a starter

```bash
queue generate:api-job --name=provision-account --queue=nest-api
```

## Example service usage

```ts
@Injectable()
export class AccountsService {
  constructor(private readonly jobManager: JobManager) {}

  async provision(body: Record<string, unknown>) {
    const job = new ProvisionAccountApiJob({
      requestId: crypto.randomUUID(),
      body,
    });

    return this.jobManager.dispatch(job);
  }
}
```

## Notes

- Inject `JobManager` through Nest providers.
- Keep orchestration in services, not controllers.
- Use workflow templates when provisioning requires multiple dependent steps.
