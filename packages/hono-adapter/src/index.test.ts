import { describe, expect, it } from 'vitest';
import { startHonoAdapter } from './index';

describe('@omni-queue/hono-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(startHonoAdapter).toBeTypeOf('function');
  });
});
