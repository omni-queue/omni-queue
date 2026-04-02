import { describe, expect, it, vi } from 'vitest';
import { defineIsolation } from '../src/libs/isolation-definition';
import { JobRegistry } from '../src/libs/registry';
import { Job } from '../src/contracts/job';

class PingJob extends Job<{ msg: string }> {
  static jobName = 'PingJob';
  jobName = 'PingJob';
  async handle(_payload: { msg: string }) {
    return 'pong';
  }
}

class PongJob extends Job<void> {
  static jobName = 'PongJob';
  jobName = 'PongJob';
  async handle() {
    return 'ping';
  }
}

describe('defineIsolation', () => {
  it('getRegistry returns a JobRegistry containing the supplied jobs', () => {
    const { getRegistry } = defineIsolation({ jobs: [PingJob] });
    const reg = getRegistry();
    expect(reg).toBeInstanceOf(JobRegistry);
    expect(reg.has('PingJob')).toBe(true);
  });

  it('getRegistry registers multiple jobs', () => {
    const { getRegistry } = defineIsolation({ jobs: [PingJob, PongJob] });
    const reg = getRegistry();
    expect(reg.has('PingJob')).toBe(true);
    expect(reg.has('PongJob')).toBe(true);
  });

  it('each getRegistry() call returns a fresh registry', () => {
    const { getRegistry } = defineIsolation({ jobs: [PingJob] });
    const a = getRegistry();
    const b = getRegistry();
    expect(a).not.toBe(b);
  });

  it('getPlugins returns empty array when plugins are omitted', () => {
    const { getPlugins } = defineIsolation({ jobs: [PingJob] });
    expect(getPlugins()).toEqual([]);
  });

  it('getPlugins returns supplied plugins', () => {
    const plugin = { name: 'test-plugin', onJobComplete: vi.fn() };
    const { getPlugins } = defineIsolation({ jobs: [], plugins: [plugin as never] });
    expect(getPlugins()).toContain(plugin);
  });
});

describe('JobRegistry', () => {
  it('registers and retrieves a job class', () => {
    const reg = new JobRegistry();
    reg.register(PingJob);
    expect(reg.get('PingJob')).toBe(PingJob);
  });

  it('registerAll registers multiple jobs', () => {
    const reg = new JobRegistry();
    reg.registerAll([PingJob, PongJob]);
    expect(reg.has('PingJob')).toBe(true);
    expect(reg.has('PongJob')).toBe(true);
  });

  it('throws on duplicate jobName', () => {
    const reg = new JobRegistry();
    reg.register(PingJob);
    expect(() => reg.register(PingJob)).toThrow('Duplicate jobName');
  });

  it('throws when getting an unregistered job', () => {
    const reg = new JobRegistry();
    expect(() => reg.get('NotRegistered')).toThrow('Job not registered');
  });
});

describe('Job base-class default implementations', () => {
  it('retries() returns 3 by default', () => {
    expect(new PingJob({ msg: 'hi' }).retries()).toBe(3);
  });

  it('backoff() caps at 30 000 ms', () => {
    const job = new PingJob({ msg: 'hi' });
    expect(job.backoff(0)).toBe(1000);
    expect(job.backoff(1)).toBe(2000);
    expect(job.backoff(2)).toBe(4000);
    // Large attempt — should be capped
    expect(job.backoff(100)).toBe(30000);
  });

  it('retryPolicy() returns undefined by default', () => {
    const job = new PingJob({ msg: 'hi' });
    expect(job.retryPolicy(new Error('x'), { attempt: 1 } as never)).toBeUndefined();
  });

  it('queue() returns "default" by default', () => {
    expect(new PingJob({ msg: 'hi' }).queue()).toBe('default');
  });

  it('tags() returns empty array by default', () => {
    expect(new PingJob({ msg: 'hi' }).tags()).toEqual([]);
  });

  it('isolation() returns "inline" by default', () => {
    expect(new PingJob({ msg: 'hi' }).isolation()).toBe('inline');
  });

  it('serialize() returns payload wrapper', () => {
    const job = new PingJob({ msg: 'hello' });
    expect(job.serialize()).toEqual({ payload: { msg: 'hello' } });
  });

  it('reportProgress no-op resolves without throwing', async () => {
    const job = new PingJob({ msg: 'hi' });
    await expect(job.reportProgress(50)).resolves.toBeUndefined();
  });
});
