import type {
    DashboardAuthContext,
    DashboardAuthOptions,
    DashboardAuthSession,
    DashboardLoginRequest,
    DashboardSessionCredentials,
} from '@omni-queue/core';
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

function buildAdminContext(): DashboardAuthContext {
    return { role: 'admin' };
}

function createSessionToken(subject: string): string {
    return Buffer.from(`omni-queue-dashboard:${subject}`).toString('base64url');
}

function createPasswordAuthHandler(
    username: string,
    password: string,
    issuedToken: string
): (request: DashboardLoginRequest) => DashboardAuthSession | null {
    return (request) => {
        if (request.mode === 'token') {
            return null;
        }

        if (request.username !== username || request.password !== password) {
            return null;
        }

        return {
            token: issuedToken,
            authContext: buildAdminContext(),
        };
    };
}

function createStaticSessionValidator(
    expectedToken: string
): (credentials: DashboardSessionCredentials) => DashboardAuthContext | false {
    return (credentials) => {
        if (credentials.token !== expectedToken) {
            return false;
        }

        return buildAdminContext();
    };
}

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
            const issuedToken = createSessionToken(`basic:${username}`);
            return {
                apiBase,
                auth: {
                    type: 'basic',
                    authHandler: createPasswordAuthHandler(username, password, issuedToken),
                    sessionValidator: createStaticSessionValidator(issuedToken),
                },
            };
        }
    }

    if (authType === 'bearer') {
        const loginMode = process.env.DASHBOARD_AUTH_LOGIN_MODE === 'custom' ? 'custom' : 'token';

        if (loginMode === 'custom') {
            const username = process.env.DASHBOARD_BASIC_USERNAME;
            const password = process.env.DASHBOARD_BASIC_PASSWORD;
            if (username && password) {
                const issuedToken = createSessionToken(`bearer-custom:${username}`);
                return {
                    apiBase,
                    auth: {
                        type: 'bearer',
                        loginMode: 'custom',
                        authHandler: createPasswordAuthHandler(username, password, issuedToken),
                        sessionValidator: createStaticSessionValidator(issuedToken),
                    },
                };
            }
        }

        const token = process.env.DASHBOARD_BEARER_TOKEN;
        if (token) {
            return {
                apiBase,
                auth: {
                    type: 'bearer',
                    loginMode: 'token',
                    authHandler: (request) => {
                        if (request.mode !== 'token' || request.token !== token) {
                            return null;
                        }

                        return {
                            token,
                            authContext: buildAdminContext(),
                        };
                    },
                    sessionValidator: createStaticSessionValidator(token),
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
                protectUiWithAuth: false,
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
