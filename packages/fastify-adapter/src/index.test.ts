import { describe, expect, it } from 'vitest';
import { omniQueueFastifyAdapter, registerFastifyAdapter } from './index';

describe('@omni-queue/fastify-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerFastifyAdapter).toBeTypeOf('function');
    expect(omniQueueFastifyAdapter).toBeTypeOf('function');
  });
});
