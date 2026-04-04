import { describe, expect, it } from 'vitest';
import { bindVastoNextWebSocket, createNextAdapter, vastoNextAdapter } from './index';

describe('@vasto/next-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createNextAdapter).toBeTypeOf('function');
    expect(vastoNextAdapter).toBeTypeOf('function');
    expect(bindVastoNextWebSocket).toBeTypeOf('function');
  });
});
