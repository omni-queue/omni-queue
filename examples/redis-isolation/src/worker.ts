import type { DashboardOptions } from '@omni-queue/core';
import { Supervisor } from '@omni-queue/core';
import { startDashboardServer } from '@omni-queue/dashboard-api';
import type http from 'node:http';
import { createConsumerWorkers, createQueues, createRedisStoreFromEnv, createRegistry } from './runtime';

import 'dotenv/config';

function parseBoolean(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true';
}

function buildDashboardOptionsFromEnv(): DashboardOptions | undefined {
    const enabled = parseBoolean(process.env.DASHBOARD_ENABLED);
    if (!enabled) {
        return undefined;
    }

    const authType = process.env.DASHBOARD_AUTH_TYPE;
    const base: DashboardOptions = {
        enabled: true,
        endpoint: process.env.DASHBOARD_ROUTE_PREFIX || '/dashboard',
    };

    if (authType === 'basic') {
        const username = process.env.DASHBOARD_BASIC_USERNAME;
        const password = process.env.DASHBOARD_BASIC_PASSWORD;
        if (username && password) {
            base.auth = {
                type: 'basic',
                validator: (credentials) => credentials.username === username && credentials.password === password,
            };
        }
        return base;
    }

    if (authType === 'bearer') {
        const token = process.env.DASHBOARD_BEARER_TOKEN;
        if (token) {
            base.auth = {
                type: 'bearer',
                validator: (credentials) => credentials.token === token,
            };
        }
        return base;
    }

    base.auth = { type: 'none' };
    return base;
}

async function main() {
    const store = createRedisStoreFromEnv();
    const queues = createQueues();
    const workers = createConsumerWorkers();
    const registry = createRegistry();

    const storageAdapters = {
        redis: store,
    };

    const dashboard = buildDashboardOptionsFromEnv();
    let dashboardServer: http.Server | undefined;

    const supervisor = new Supervisor({
        queues,
        workers,
        registry,
        storageAdapters,
        ...(dashboard ? { dashboard } : {}),
    });

    await supervisor.start();

    if (dashboard?.enabled) {
        dashboardServer = startDashboardServer({
            supervisor,
            host: process.env.DASHBOARD_HOST || '127.0.0.1',
            port: Number(process.env.DASHBOARD_PORT || '3210'),
        });
    }

    console.log('[worker] supervisor started');
    console.log('[worker] queues: inline-emails (inline), thread-thumbnails (thread), process-transcode (process)');
    if (process.env.DASHBOARD_ENABLED === '1' || process.env.DASHBOARD_ENABLED === 'true') {
        console.log('[worker] dashboard: enabled (see DASHBOARD_* env settings)');
    }
    console.log('[worker] waiting for jobs from Redis\n');

    const shutdown = async () => {
        console.log('\n[worker] shutting down ...');
        dashboardServer?.close();
        supervisor.stop();
        await store.close();
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown();
    });
    process.on('SIGTERM', () => {
        void shutdown();
    });
}

main().catch((error) => {
    console.error('[worker] fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
