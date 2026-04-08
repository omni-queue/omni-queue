import { describe, expect, it } from 'vitest';
import { DynamoDbStore } from './index';

describe('@vasto-queue/dynamodb-store exports', () => {
  it('exports DynamoDbStore', () => {
    expect(DynamoDbStore).toBeTypeOf('function');
  });
});
