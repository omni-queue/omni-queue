import { describe, expect, it } from 'vitest';
import { bindVastoFastifyWebSocket, vastoFastifyAdapter, registerFastifyAdapter } from './index';

describe('@vasto/fastify-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(registerFastifyAdapter).toBeTypeOf('function');
    expect(vastoFastifyAdapter).toBeTypeOf('function');
    expect(bindVastoFastifyWebSocket).toBeTypeOf('function');
  });
});
