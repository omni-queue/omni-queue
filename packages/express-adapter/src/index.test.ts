import { describe, expect, it } from 'vitest';
import {
  createExpressAdapter,
  createExpressWebSocketBinding,
} from './index';

describe('@vasto-queue/express-adapter exports', () => {
  it('exports adapter functions', () => {
    expect(createExpressAdapter).toBeTypeOf('function');
    expect(createExpressWebSocketBinding).toBeTypeOf('function');
  });
});
