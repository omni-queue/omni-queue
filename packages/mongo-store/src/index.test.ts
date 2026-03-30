import { describe, expect, it } from 'vitest';
import { MongoStore } from './index';

describe('@omni-queue/mongo-store exports', () => {
  it('exports MongoStore', () => {
    expect(MongoStore).toBeTypeOf('function');
  });
});
