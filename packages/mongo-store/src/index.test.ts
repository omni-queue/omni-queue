import { describe, expect, it } from 'vitest';
import { MongoStore } from './index';

describe('@vasto/mongo-store exports', () => {
  it('exports MongoStore', () => {
    expect(MongoStore).toBeTypeOf('function');
  });
});
