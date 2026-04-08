import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Redis from 'ioredis';
import {
  InMemoryQueueStorage,
  JobRegistry,
  type Plugin,
  Supervisor,
  defineQueues,
  defineWorkers,
  type JobConstructor,
} from '@vasto-queue/core';
import { RedisStore } from '@vasto-queue/redis-store';
import { PostgresStore } from '@vasto-queue/postgres-store';
import type { LibraryName } from './types.js';

type VastoBackend = 'memory' | 'redis' | 'postgres';

export interface VastoFixtureOptions {
  backend: VastoBackend;
  jobClass: JobConstructor;
  concurrency: number;
  batchSize: number;
  globalPlugins?: Plugin[];
  enqueueChunkSize?: number;
  partitionByQueue?: boolean;
  enablePromoter?: boolean;
  recoverOnStart?: boolean;
  redisUrl?: string;
  postgresUrl?: string;
  promoterIntervalMs?: number;
}

export interface VastoFixture {
  library: Extract<LibraryName, 'vasto-memory' | 'vasto-redis' | 'vasto-postgres'>;
  queueName: string;
  supervisor: Supervisor;
  cleanup(): Promise<void>;
}

function uniqueToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function envOptionalInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function asSqlIdentifier(name: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}. Only letters, numbers, and underscores are allowed.`);
  }

  return name;
}

function libraryNameForBackend(backend: VastoBackend): VastoFixture['library'] {
  switch (backend) {
    case 'memory':
      return 'vasto-memory';
    case 'redis':
      return 'vasto-redis';
    case 'postgres':
      return 'vasto-postgres';
  }
}

async function deleteRedisPrefix(client: Redis, prefix: string): Promise<void> {
  let cursor = '0';

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', '1000');
    if (keys.length > 0) {
      await client.del(...keys);
    }
    cursor = nextCursor;
  } while (cursor !== '0');
}

export async function createVastoFixture(options: VastoFixtureOptions): Promise<VastoFixture> {
  const token = uniqueToken();
  const queueName = 'bench';
  const library = libraryNameForBackend(options.backend);
  const registry = new JobRegistry();
  registry.register(options.jobClass);

  if (options.backend === 'memory') {
    const storage = new InMemoryQueueStorage();
    const supervisor = new Supervisor({
      queues: defineQueues({
        [queueName]: {
          name: queueName,
          connection: 'memory',
          concurrency: options.concurrency,
          batchSize: options.batchSize,
        },
      }),
      workers: defineWorkers({ w: { queues: [queueName], concurrency: options.concurrency } }),
      registry,
      storageAdapters: { memory: storage },
      ...(options.globalPlugins != null ? { globalPlugins: options.globalPlugins } : {}),
      ...(options.enqueueChunkSize != null ? { enqueueChunkSize: options.enqueueChunkSize } : {}),
      repeatables: {
        recoverOnStart: options.recoverOnStart ?? false,
        promoterEnabled: options.enablePromoter ?? false,
        ...(options.promoterIntervalMs !== undefined ? { promoterIntervalMs: options.promoterIntervalMs } : {}),
      },
    });

    return {
      library,
      queueName,
      supervisor,
      cleanup: async () => {
        supervisor.stop();
        await (storage as InMemoryQueueStorage & { clear?: () => Promise<void> }).clear?.();
      },
    };
  }

  if (options.backend === 'redis') {
    if (!options.redisUrl) {
      throw new Error('REDIS_URL is required for the Vasto Redis benchmark fixture');
    }

    const prefix = `vasto:bench:${token}`;
    const client = new Redis(options.redisUrl);
    const storage = new RedisStore({ client, prefix });
    const supervisor = new Supervisor({
      queues: defineQueues({
        [queueName]: {
          name: queueName,
          connection: 'redis',
          concurrency: options.concurrency,
          batchSize: options.batchSize,
        },
      }),
      workers: defineWorkers({ w: { queues: [queueName], concurrency: options.concurrency } }),
      registry,
      storageAdapters: { redis: storage },
      ...(options.globalPlugins != null ? { globalPlugins: options.globalPlugins } : {}),
      ...(options.enqueueChunkSize != null ? { enqueueChunkSize: options.enqueueChunkSize } : {}),
      repeatables: {
        recoverOnStart: options.recoverOnStart ?? false,
        promoterEnabled: options.enablePromoter ?? false,
        ...(options.promoterIntervalMs !== undefined ? { promoterIntervalMs: options.promoterIntervalMs } : {}),
      },
    });

    return {
      library,
      queueName,
      supervisor,
      cleanup: async () => {
        supervisor.stop();
        try {
          await deleteRedisPrefix(client, prefix);
          await client.quit();
        } catch {
          client.disconnect();
        }
      },
    };
  }

  if (!options.postgresUrl) {
    throw new Error('POSTGRES_URL is required for the Vasto Postgres benchmark fixture');
  }

  const keepPostgresTables = envFlag('VASTO_BENCH_KEEP_PG_TABLES');
  const trackCompletedJobs = envFlag('VASTO_BENCH_TRACK_COMPLETED');
  const benchPartitionByQueue = options.partitionByQueue ?? !envFlag('VASTO_BENCH_DISABLE_QUEUE_PARTITIONS');
  const benchEnqueueChunkSize = options.enqueueChunkSize ?? envOptionalInt('VASTO_BENCH_ENQUEUE_CHUNK_SIZE');
  const configuredPoolMax = envOptionalInt('VASTO_BENCH_PG_POOL_MAX');
  const configuredPoolMin = envOptionalInt('VASTO_BENCH_PG_POOL_MIN');
  const configuredPoolIdleTimeoutMs = envOptionalInt('VASTO_BENCH_PG_POOL_IDLE_TIMEOUT_MS');
  const configuredBase = process.env.VASTO_BENCH_PG_TABLE_BASE?.trim();
  const tableBase = configuredBase
    ? asSqlIdentifier(configuredBase, 'VASTO_BENCH_PG_TABLE_BASE')
    : `vasto_bench_${token}`;
  const tableName = `${tableBase}_jobs`;
  const deadLetterTableName = `${tableBase}_dead_letter`;
  const defaultPoolMax = Math.max(20, options.concurrency * 4);
  const poolMax = configuredPoolMax ?? defaultPoolMax;
  const poolMin = configuredPoolMin != null ? Math.min(configuredPoolMin, poolMax) : Math.min(4, poolMax);
  const poolIdleTimeoutMs = configuredPoolIdleTimeoutMs ?? 10_000;
  const pool = new Pool({
    connectionString: options.postgresUrl,
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: poolIdleTimeoutMs,
  });
  const storage = new PostgresStore({
    pool,
    tableName,
    deadLetterTableName,
    partitionByQueue: benchPartitionByQueue,
    trackCompletedJobs,
  });
  await storage.migrate();

  if (keepPostgresTables) {
    console.log(`[benchmark] preserving Vasto Postgres tables: ${tableName}, ${deadLetterTableName}`);
  }

  const supervisor = new Supervisor({
    queues: defineQueues({
      [queueName]: {
        name: queueName,
        connection: 'postgres',
        concurrency: options.concurrency,
        batchSize: options.batchSize,
      },
    }),
    workers: defineWorkers({ w: { queues: [queueName], concurrency: options.concurrency } }),
    registry,
    storageAdapters: { postgres: storage },
    ...(options.globalPlugins != null ? { globalPlugins: options.globalPlugins } : {}),
    ...(benchEnqueueChunkSize != null ? { enqueueChunkSize: benchEnqueueChunkSize } : {}),
    repeatables: {
      recoverOnStart: options.recoverOnStart ?? false,
      promoterEnabled: options.enablePromoter ?? false,
      ...(options.promoterIntervalMs !== undefined ? { promoterIntervalMs: options.promoterIntervalMs } : {}),
    },
  });

  return {
    library,
    queueName,
    supervisor,
    cleanup: async () => {
      supervisor.stop();
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (!keepPostgresTables) {
          await pool.query(`DROP TABLE IF EXISTS ${deadLetterTableName}, ${tableName} CASCADE`);
        }
      } finally {
        await pool.end();
      }
    },
  };
}