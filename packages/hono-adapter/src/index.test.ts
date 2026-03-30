import { describe, expect, it } from 'vitest';
import { omniQueueHonoAdapter } from './index';

describe('@omni-queue/hono-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(omniQueueHonoAdapter).toBeTypeOf('function');
  });
});
