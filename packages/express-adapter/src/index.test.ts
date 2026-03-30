import { describe, expect, it } from 'vitest';
import {
  createDefaultDashboardMiddleware,
  createExpressAdapter,
  startDefaultDashboardServer,
  startExpressAdapter,
} from './index';

describe('@omni-queue/express-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createExpressAdapter).toBeTypeOf('function');
    expect(startExpressAdapter).toBeTypeOf('function');
    expect(createDefaultDashboardMiddleware).toBeTypeOf('function');
    expect(startDefaultDashboardServer).toBeTypeOf('function');
  });
});
