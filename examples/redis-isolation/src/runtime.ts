import {
    JobRegistry,
    defineQueues,
    defineWorkers,
    resolveRuntimeModules,
} from '@omni-queue/core';
import { RedisStore } from '@omni-queue/redis-store';
import {
    GenerateThumbnailJob,
    SendWelcomeEmailJob,
    TranscodeVideoJob,
} from './jobs';

function getEnv(key: string, fallback?: string): string | undefined {
    const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const viteKey = `VITE_${key}`;

    return process.env[key] ?? viteEnv?.[key] ?? viteEnv?.[viteKey] ?? fallback;
}

export function createRedisStoreFromEnv(): RedisStore {
    const redisUrl = getEnv('REDIS_URL', 'redis://127.0.0.1:6379')!;
    const redisPrefix = getEnv('REDIS_PREFIX', 'omniq:redis-isolation')!;
    const envUsername = getEnv('REDIS_USERNAME');
    const envPassword = getEnv('REDIS_PASSWORD');

    const parsedRedisUrl = new URL(redisUrl);
    const redisPort = Number(parsedRedisUrl.port || '6379');
    const redisUsername = parsedRedisUrl.username || envUsername || undefined;
    const redisPassword = parsedRedisUrl.password || envPassword || undefined;
    const redisDb =
        parsedRedisUrl.pathname && parsedRedisUrl.pathname !== '/'
            ? Number(parsedRedisUrl.pathname.replace('/', ''))
            : undefined;

    return new RedisStore({
        client: {
            host: parsedRedisUrl.hostname,
            port: redisPort,
            ...(redisUsername ? { username: redisUsername } : {}),
            ...(redisPassword ? { password: redisPassword } : {}),
            ...(Number.isFinite(redisDb) ? { db: redisDb } : {}),
        },
        prefix: redisPrefix,
    });
}

export function createQueues() {
    return defineQueues({
        'inline-emails': {
            name: 'inline-emails',
            connection: 'redis',
            concurrency: 8,
            batchSize: 25,
        },
        'thread-thumbnails': {
            name: 'thread-thumbnails',
            connection: 'redis',
            concurrency: 4,
            batchSize: 10,
        },
        'process-transcode': {
            name: 'process-transcode',
            connection: 'redis',
            concurrency: 10,
            batchSize: 2,
            visibilityTimeout: 120000,
        },
    });
}

export function createProducerWorkers() {
    return defineWorkers({});
}

export function createConsumerWorkers() {
    const threadModules = resolveRuntimeModules('thread-media');
    const processModules = resolveRuntimeModules('process-media');

    return defineWorkers({
        inlineWorker: {
            queues: ['inline-emails'],
            concurrency: 2,
            isolation: 'inline',
        },
        threadWorker: {
            queues: ['thread-thumbnails'],
            concurrency: 2,
            isolation: 'thread',
            poolSize: 4,
            workerModule: threadModules.isolationWorkerModule,
            ...(threadModules.registryModule ? { registryModule: threadModules.registryModule } : {}),
            ...(threadModules.runtimePluginsModule
                ? { pluginsModule: threadModules.runtimePluginsModule }
                : {}),
        },
        processWorker: {
            queues: ['process-transcode'],
            concurrency: 10,
            isolation: 'process',
            poolSize: 2,
            timeout: 180000,
            workerModule: processModules.isolationWorkerModule,
            ...(processModules.registryModule ? { registryModule: processModules.registryModule } : {}),
            ...(processModules.runtimePluginsModule
                ? { pluginsModule: processModules.runtimePluginsModule }
                : {}),
        },
    });
}

export function createRegistry() {
    const registry = new JobRegistry();
    registry.registerAll([SendWelcomeEmailJob, GenerateThumbnailJob, TranscodeVideoJob]);
    return registry;
}
