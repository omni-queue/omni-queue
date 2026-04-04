import { describe, expect, it, vi } from 'vitest';
import { Queue } from '../src/libs/queue';
import { Job } from '../src/contracts/job';
import type { StoredJob } from '../src/types';

class HelloJob extends Job<{ name: string }> {
  static jobName = 'HelloJob';
  jobName = 'HelloJob';
  queue() { return 'hello'; }
  async handle(_payload: { name: string }) {
    return `Hello ${_payload.name}`;
  }
}

function makeStorage() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

describe('Queue.dispatch', () => {
  it('calls storage.enqueue with a well-formed StoredJob', async () => {
    const storage = makeStorage();
    const queues = { 'hello': { connection: 'default' } };
    const adapters = { default: storage };

    const queue = new Queue(queues, adapters);
    const job = new HelloJob({ name: 'world' });

    await queue.dispatch(job);

    expect(storage.enqueue).toHaveBeenCalledOnce();

    const stored: StoredJob = storage.enqueue.mock.calls[0][0];
    expect(stored.name).toBe('HelloJob');
    expect(stored.queue).toBe('hello');
    expect(stored.payload).toEqual({ name: 'world' });
    expect(stored.state).toBe('queued');
    expect(stored.attempts).toBe(0);
    expect(typeof stored.id).toBe('string');
    expect(typeof stored.createdAt).toBe('number');
  });

  it('routes to the correct storage adapter via queue connection', async () => {
    const defaultStorage = makeStorage();
    const otherStorage = makeStorage();
    const queues = {
      'hello': { connection: 'default' },
      'other': { connection: 'other' },
    };
    const adapters = { default: defaultStorage, other: otherStorage };

    const queue = new Queue(queues, adapters);
    await queue.dispatch(new HelloJob({ name: 'test' }));

    expect(defaultStorage.enqueue).toHaveBeenCalledOnce();
    expect(otherStorage.enqueue).not.toHaveBeenCalled();
  });
});
