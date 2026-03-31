import { describe, expect, it } from 'vitest';
import { bindOmniQueueHonoWebSocket, omniQueueHonoAdapter } from './index';

describe('@omni-queue/hono-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(omniQueueHonoAdapter).toBeTypeOf('function');
    expect(bindOmniQueueHonoWebSocket).toBeTypeOf('function');
  });
});
