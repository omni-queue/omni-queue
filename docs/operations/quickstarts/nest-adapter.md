# Nest adapter quickstart

Use this pattern when a Nest controller or service should hand work to Omni Queue.

## Generate a starter

```bash
queue generate api-job --name=provision-account --queue=nest-api
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

## Dashboard mounting

```ts
import path from 'node:path';
import {
  bindOmniQueueNestWebSocket,
  omniQueueNestAdapter,
} from '@omni-queue/nest-adapter';

app.use(
  omniQueueNestAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: true,
  })
);

bindOmniQueueNestWebSocket(app.getHttpServer(), {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

Publish the UI assets once:

```bash
queue dashboard:publish --out=./public/omni-queue-dashboard
```

If WebSocket upgrades are blocked by a proxy or serverless environment, force polling at runtime by injecting this before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/omni-queue',  // must match apiBase above
  };
</script>
```

Or append `?transport=polling` to the dashboard URL for a quick per-request test.
