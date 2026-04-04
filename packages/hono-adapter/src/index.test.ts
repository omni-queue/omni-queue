import { describe, expect, it } from 'vitest';
import { bindVastoHonoWebSocket, vastoHonoAdapter } from './index';

describe('@vasto/hono-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(vastoHonoAdapter).toBeTypeOf('function');
    expect(bindVastoHonoWebSocket).toBeTypeOf('function');
  });
});
