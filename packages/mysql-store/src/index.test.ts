import { describe, expect, it } from 'vitest';
import { MySqlStore } from './index';

describe('@omni-queue/mysql-store exports', () => {
  it('exports MySqlStore', () => {
    expect(MySqlStore).toBeTypeOf('function');
  });
});
