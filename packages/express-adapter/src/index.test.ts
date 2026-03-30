import { describe, expect, it } from 'vitest';
import {
  createDefaultDashboardMiddleware,
  createExpressAdapter,
  omniQueueExpressAdapter,
} from './index';

describe('@omni-queue/express-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createExpressAdapter).toBeTypeOf('function');
    expect(omniQueueExpressAdapter).toBeTypeOf('function');
    expect(createDefaultDashboardMiddleware).toBeTypeOf('function');
  });
});
