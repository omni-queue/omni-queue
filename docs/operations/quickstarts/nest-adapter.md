# Nest adapter quickstart

Use this pattern when a Nest controller or service should hand work to Vasto.

## Generate a starter

```bash
vasto generate api-job --name=provision-account -=nest-api
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
  bindVastoNestWebSocket,
  vastoNestAdapter,
} from '@vasto/nest-adapter';

app.use(
  vastoNestAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    uiBase: '/',
    protectUiWithAuth: false,
  })
);

bindVastoNestWebSocket(app.getHttpServer(), {
  supervisor,
  apiBase: '/api/vasto',
});
```

Publish the UI assets once:

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

If WebSocket upgrades are blocked by a proxy or serverless environment, force polling at runtime by injecting this before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__VASTO_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/vasto',  // must match apiBase above
  };
</script>
```

Or append `?transport=polling` to the dashboard URL for a quick per-request test.
