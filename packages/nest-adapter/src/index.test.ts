import { describe, expect, it } from 'vitest';
import { omniQueueNestAdapter, registerNestAdapter } from './index';

describe('@omni-queue/nest-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerNestAdapter).toBeTypeOf('function');
    expect(omniQueueNestAdapter).toBeTypeOf('function');
  });
});
