import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredJob } from '@vasto-queue/core';

vi.mock('ioredis', async () => {
  class MockRedis {
    private strings = new Map<string, string>();
    private zsets = new Map<string, Map<string, number>>();
    // private commands = new Map<string, (args: unknown[]) => Promise<unknown>>();

    defineCommand(name: string, config: { numberOfKeys: number; lua: string }): void {
      // Store command implementation for unit tests
      // For vastoDequeue, delegate to eval logic
      const commandName = name;
      const { numberOfKeys } = config;
      const self = this;

      if (name === 'vastoDequeue') {
        (this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[commandName] = async (
          ...args: unknown[]
        ) => {
          // Extract parameters: readyKey, leasedKey, jobPrefix, now, leaseUntil, batchSize, reclaimLimit
          const readyKey = args[0] as string;
          const leasedKey = args[1] as string;
          const jobPrefix = args[2] as string;
          const now = args[3] as number;
          const leaseUntil = args[4] as number;
          const batchSize = args[5] as number;
          // reclaimLimit = args[6] - not used in our simple mock

          return self.eval(config.lua, numberOfKeys, readyKey, leasedKey, jobPrefix, now, leaseUntil, batchSize);
        };
      } else {
        // Other commands
        (this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[commandName] = async (
          ..._args: unknown[]
        ) => {
          // Mock Lua script execution - just return empty results for unknown commands
          return [];
        };
      }
    }

    pipeline() {
      const commands: Array<{ op: string; args: unknown[] }> = [];
      const self = this;

      return {
        set(key: string, value: string) {
          commands.push({ op: 'set', args: [key, value] });
          return this;
        },
        get(key: string) {
          commands.push({ op: 'get', args: [key] });
          return this;
        },
        del(key: string) {
          commands.push({ op: 'del', args: [key] });
          return this;
        },
        zadd(key: string, score: number, member: string) {
          commands.push({ op: 'zadd', args: [key, score, member] });
          return this;
        },
        zrem(key: string, member: string) {
          commands.push({ op: 'zrem', args: [key, member] });
          return this;
        },
        zrange(key: string, start: number, end: number) {
          commands.push({ op: 'zrange', args: [key, start, end] });
          return this;
        },
        async exec() {
          const results: Array<[Error | null, unknown]> = [];
          for (const command of commands) {
            try {
              const value = await (
                self as unknown as Record<string, (...args: unknown[]) => unknown>
              )[command.op](...command.args);
              results.push([null, value]);
            } catch (error) {
              results.push([error as Error, null]);
            }
          }
          return results;
        },
      };
    }

    async set(key: string, value: string): Promise<'OK'> {
      this.strings.set(key, value);
      return 'OK';
    }

    async get(key: string): Promise<string | null> {
      return this.strings.get(key) ?? null;
    }

    async del(key: string): Promise<number> {
      const existed = this.strings.delete(key);
      return existed ? 1 : 0;
    }

    async zadd(key: string, score: number, member: string): Promise<number> {
      const set = this.ensureZset(key);
      set.set(member, Number(score));
      return 1;
    }

    async zrem(key: string, member: string): Promise<number> {
      const set = this.zsets.get(key);
      if (!set) return 0;
      const existed = set.delete(member);
      return existed ? 1 : 0;
    }

    async zcard(key: string): Promise<number> {
      const set = this.zsets.get(key);
      return set?.size ?? 0;
    }

    async zrange(key: string, start: number, end: number): Promise<string[]> {
      const members = this.sortedMembers(key).map(([member]) => member);
      if (members.length === 0) return [];

      const normalizedStart = start < 0 ? Math.max(members.length + start, 0) : start;
      const normalizedEnd = end < 0 ? members.length + end : end;

      if (normalizedEnd < normalizedStart) return [];
      return members.slice(normalizedStart, normalizedEnd + 1);
    }

    async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
      const lower = Number(min);
      const upper = Number(max);
      return this.sortedMembers(key)
        .filter(([, score]) => score >= lower && score <= upper)
        .map(([member]) => member);
    }

    async scan(
      cursor: string,
      _matchLiteral: string,
      matchPattern: string
    ): Promise<[string, string[]]> {
      if (cursor !== '0') {
        return ['0', []];
      }

      const regex = new RegExp(`^${matchPattern.replace(/\*/g, '.*')}$`);
      const keys = [...this.strings.keys(), ...this.zsets.keys()].filter((key) => regex.test(key));
      return ['0', keys];
    }

    async eval(
      _script: string,
      _numKeys: number,
      readyKey: string,
      leasedKey: string,
      jobPrefix: string,
      now: number,
      leaseUntil: number,
      batchSize: number
    ): Promise<string[]> {
      const expired = await this.zrangebyscore(leasedKey, 0, now);
      for (const id of expired) {
        const raw = await this.get(`${jobPrefix}${id}`);
        if (!raw) continue;

        const job = JSON.parse(raw) as StoredJob;
        await this.zrem(leasedKey, id);
        await this.zadd(readyKey, job.createdAt, id);
      }

      const ids = (await this.zrange(readyKey, 0, Number(batchSize) - 1)) ?? [];
      const jobs: string[] = [];
      for (const id of ids) {
        await this.zrem(readyKey, id);
        await this.zadd(leasedKey, Number(leaseUntil), id);

        const raw = await this.get(`${jobPrefix}${id}`);
        if (!raw) continue;

        const job = JSON.parse(raw) as StoredJob;
        job.state = 'leased';
        job.updatedAt = Number(now);
        await this.set(`${jobPrefix}${id}`, JSON.stringify(job));
        jobs.push(JSON.stringify(job));
      }

      return jobs;
    }

    async quit(): Promise<'OK'> {
      return 'OK';
    }

    private ensureZset(key: string): Map<string, number> {
      let set = this.zsets.get(key);
      if (!set) {
        set = new Map<string, number>();
        this.zsets.set(key, set);
      }
      return set;
    }

    private sortedMembers(key: string): Array<[string, number]> {
      const set = this.zsets.get(key);
      if (!set) return [];

      return [...set.entries()].sort((a, b) => {
        if (a[1] === b[1]) {
          return a[0].localeCompare(b[0]);
        }
        return a[1] - b[1];
      });
    }
  }

  return {
    __esModule: true,
    default: MockRedis,
  };
});

import { RedisStore } from '../src/redis-store';

function job(overrides: Partial<StoredJob> = {}): StoredJob {
  const now = 1_711_715_200_000;
  return {
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'test',
    payload: overrides.payload ?? { ok: true },
    queue: overrides.queue ?? 'emails',
    attempts: overrides.attempts ?? 0,
    state: overrides.state ?? 'queued',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

describe('RedisStore delayed/deferred behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores delayed jobs as deferred and reports pending queries', async () => {
    const store = new RedisStore({ client: {} as never, prefix: 'test' });

    const delayed = job({ id: 'd-1', delayUntil: Date.now() + 5000 });
    await store.enqueue(delayed);

    expect(await store.getQueueDepth('emails')).toBe(1);

    const delayedBeforeTime = await store.getDelayedJobs('emails', Date.now());
    expect(delayedBeforeTime).toHaveLength(0);

    const pending = await store.queryDeferredJobs({ queueName: 'emails', status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('d-1');

    await store.close();
  });

  it('promotes delayed jobs to active queue and makes them dequeueable', async () => {
    const store = new RedisStore({ client: {} as never, prefix: 'test' });

    const now = Date.now();
    const delayed = job({ id: 'd-2', delayUntil: now - 10 });
    await store.enqueue(delayed);

    const ready = await store.getDelayedJobs('emails', now);
    expect(ready.map((item) => item.id)).toEqual(['d-2']);

    await store.moveJobToQueue('emails', 'd-2', 'active');

    const afterPromotion = await store.getDelayedJobs('emails', now);
    expect(afterPromotion).toHaveLength(0);

    const dequeued = await store.dequeue({ queue: 'emails', batchSize: 1, leaseMs: 1000 });
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0]?.id).toBe('d-2');
    expect(dequeued[0]?.state).toBe('leased');

    await store.close();
  });

  it('keeps failed deferred jobs queryable via failed status', async () => {
    const store = new RedisStore({ client: {} as never, prefix: 'test' });

    const delayed = job({ id: 'd-3', delayUntil: Date.now() + 1000 });
    await store.enqueue(delayed);

    await store.moveJobToQueue('emails', 'd-3', 'failed');

    const failed = await store.queryDeferredJobs({ queueName: 'emails', status: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe('d-3');
    expect(failed[0]?.state).toBe('failed');

    const promotable = await store.getDelayedJobs('emails', Date.now() + 10_000);
    expect(promotable).toHaveLength(0);

    await store.close();
  });
});
