import type { DashboardAuthOptions } from '@omni-queue/core';
import { Supervisor } from '@omni-queue/core';
import express from 'express';
import path from 'node:path';
import { createExpressAdapter, createExpressWebSocketBinding } from '@omni-queue/express-adapter';
import type http from 'node:http';
import { createConsumerWorkers, createQueues, createRedisStoreFromEnv, createRegistry } from './runtime';
import { registerGracefulShutdown } from './graceful-shutdown';

import 'dotenv/config';

function parseBoolean(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true';
}

type DashboardAdapterConfig = {
    apiBase: string;
    auth: DashboardAuthOptions;
};

function buildDashboardConfigFromEnv(): DashboardAdapterConfig | undefined {
    const enabled = parseBoolean(process.env.DASHBOARD_ENABLED);
    if (!enabled) {
        return undefined;
    }

    const apiBase = process.env.DASHBOARD_ROUTE_PREFIX || '/dashboard';
    const authType = process.env.DASHBOARD_AUTH_TYPE;

    if (authType === 'basic') {
        const username = process.env.DASHBOARD_BASIC_USERNAME;
        const password = process.env.DASHBOARD_BASIC_PASSWORD;
        if (username && password) {
            return {
                apiBase,
                auth: {
                    type: 'basic',
                    validator: (credentials) => credentials.username === username && credentials.password === password,
                },
            };
        }
    }

    if (authType === 'bearer') {
        const token = process.env.DASHBOARD_BEARER_TOKEN;
        if (token) {
            return {
                apiBase,
                auth: {
                    type: 'bearer',
                    validator: (credentials) => credentials.token === token,
                },
            };
        }
    }

    return { apiBase, auth: { type: 'none' } };
}

async function main() {
    const dashboardUiDir = path.resolve(process.cwd(), 'public/omni-queue-dashboard');
    const store = createRedisStoreFromEnv();
    const queues = createQueues();
    const workers = createConsumerWorkers();
    const registry = createRegistry();

    const storageAdapters = {
        redis: store,
    };

    const dashboardConfig = buildDashboardConfigFromEnv();
    let dashboardServer: http.Server | undefined;
    let dashboardSocket: { close: () => void } | undefined;

    const supervisor = new Supervisor({
        queues,
        workers,
        registry,
        storageAdapters,
    });

    await supervisor.start();

    if (dashboardConfig) {
        const dashboardApp = express();
        dashboardApp.use(
            createExpressAdapter({
                supervisor,
                apiBase: dashboardConfig.apiBase,
                auth: dashboardConfig.auth,
                uiDir: dashboardUiDir,
                uiBase: '/',
                protectUiWithAuth: true,
            })
        );

        dashboardServer = await new Promise<http.Server>((resolve) => {
            const started = dashboardApp.listen(
                Number(process.env.DASHBOARD_PORT || '3210'),
                process.env.DASHBOARD_HOST || '127.0.0.1',
                () => resolve(started)
            );
        });

        dashboardSocket = createExpressWebSocketBinding(dashboardServer, {
            supervisor,
            apiBase: dashboardConfig.apiBase,
            auth: dashboardConfig.auth,
        });
    }

    console.log('[worker] supervisor started');
    console.log('[worker] queues: inline-emails (inline), thread-thumbnails (thread), process-transcode (process)');
    if (process.env.DASHBOARD_ENABLED === '1' || process.env.DASHBOARD_ENABLED === 'true') {
        console.log('[worker] dashboard: enabled (see DASHBOARD_* env settings)');
    }
    console.log('[worker] waiting for jobs from Redis\n');

    registerGracefulShutdown({
        label: 'worker',
        onShutdown: async () => {
            dashboardSocket?.close();
            dashboardServer?.closeIdleConnections?.();
            dashboardServer?.closeAllConnections?.();
            await new Promise<void>((resolve) => {
                if (!dashboardServer) {
                    resolve();
                    return;
                }

                dashboardServer.close(() => resolve());
            });
            supervisor.stop();
            await store.close();
        },
    });
}

main().catch((error) => {
    console.error('[worker] fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
