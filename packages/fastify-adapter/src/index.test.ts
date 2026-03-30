import { describe, expect, it } from 'vitest';
import { registerFastifyAdapter, startFastifyAdapter } from './index';

describe('@omni-queue/fastify-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerFastifyAdapter).toBeTypeOf('function');
    expect(startFastifyAdapter).toBeTypeOf('function');
  });
});
