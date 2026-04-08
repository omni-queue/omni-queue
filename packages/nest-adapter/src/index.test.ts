import { describe, expect, it } from 'vitest';
import { bindVastoNestWebSocket, vastoNestAdapter, registerNestAdapter } from './index';

describe('@vasto-queue/nest-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerNestAdapter).toBeTypeOf('function');
    expect(vastoNestAdapter).toBeTypeOf('function');
    expect(bindVastoNestWebSocket).toBeTypeOf('function');
  });
});
