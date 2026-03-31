import { describe, expect, it } from 'vitest';
import { bindOmniQueueNextWebSocket, createNextAdapter, omniQueueNextAdapter } from './index';

describe('@omni-queue/next-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createNextAdapter).toBeTypeOf('function');
    expect(omniQueueNextAdapter).toBeTypeOf('function');
    expect(bindOmniQueueNextWebSocket).toBeTypeOf('function');
  });
});
