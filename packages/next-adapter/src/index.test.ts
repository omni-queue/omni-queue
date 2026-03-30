import { describe, expect, it } from 'vitest';
import { createNextAdapter, startNextAdapter } from './index';

describe('@omni-queue/next-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createNextAdapter).toBeTypeOf('function');
    expect(startNextAdapter).toBeTypeOf('function');
  });
});
