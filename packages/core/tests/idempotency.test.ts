import { describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';

class IdempotentTestJob extends Job<{ value: string }> {
	static jobName = 'idempotent-test-job';
	override jobName = IdempotentTestJob.jobName;

	override queue(): string {
		return 'default';
	}

	override isolation(): 'inline' {
		return 'inline';
	}

	override async handle(payload: { value: string }): Promise<string> {
		return payload.value;
	}
}

function createTestContext(queueOverrides: Partial<QueueConfig> = {}) {
	const storage = new InMemoryQueueStorage();
	const registry = new JobRegistry();
	registry.register(IdempotentTestJob);

	const queues: Record<string, QueueConfig> = {
		default: {
			name: 'default',
			connection: 'memory',
			concurrency: 1,
			batchSize: 10,
			...queueOverrides,
		},
	};

	const workers: Record<string, WorkerConfig> = {
		worker: {
			queues: ['default'],
			concurrency: 1,
			isolation: 'inline',
		},
	};

	const manager = new JobManager(queues, workers, registry, { memory: storage });
	return { storage, manager };
}

describe('idempotency dedupe policy', () => {
	it('dedupes by key within completed-job window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

		const { storage, manager } = createTestContext({
			idempotency: {
				dedupeWindowMs: 60_000,
			},
		});

		const firstId = await manager.dispatch(new IdempotentTestJob({ value: 'one' }), {
			idempotencyKey: 'email:123',
		});

		const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
		expect(leased).toHaveLength(1);
		await manager.execute(leased[0]!);

		const secondId = await manager.dispatch(new IdempotentTestJob({ value: 'two' }), {
			idempotencyKey: 'email:123',
		});

		expect(secondId).toBe(firstId);
		expect(await storage.getQueueDepth('default')).toBe(0);
	});

	it('allows redispatch outside dedupe window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

		const { storage, manager } = createTestContext({
			idempotency: {
				dedupeWindowMs: 1_000,
			},
		});

		const firstId = await manager.dispatch(new IdempotentTestJob({ value: 'one' }), {
			idempotencyKey: 'email:456',
		});

		const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
		await manager.execute(leased[0]!);

		await vi.advanceTimersByTimeAsync(1_100);

		const secondId = await manager.dispatch(new IdempotentTestJob({ value: 'two' }), {
			idempotencyKey: 'email:456',
		});

		expect(secondId).not.toBe(firstId);
		expect(await storage.getQueueDepth('default')).toBe(1);
	});

	it('optionally dedupes recently failed jobs', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

		const { storage, manager } = createTestContext({
			idempotency: {
				dedupeWindowMs: 60_000,
				includeFailed: true,
			},
		});

		const firstId = await manager.dispatch(new IdempotentTestJob({ value: 'one' }), {
			idempotencyKey: 'email:789',
		});

		const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
		expect(leased).toHaveLength(1);
		await storage.moveToDeadLetter(leased[0]!);

		const secondId = await manager.dispatch(new IdempotentTestJob({ value: 'two' }), {
			idempotencyKey: 'email:789',
		});

		expect(secondId).toBe(firstId);
		expect(await storage.getQueueDepth('default')).toBe(0);
	});
});
