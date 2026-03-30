import { describe, expect, it } from 'vitest';
import { registerNestAdapter, startNestAdapter } from './index';

describe('@omni-queue/nest-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerNestAdapter).toBeTypeOf('function');
    expect(startNestAdapter).toBeTypeOf('function');
  });
});
