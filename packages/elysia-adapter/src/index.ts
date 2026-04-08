import http from 'node:http';
import express from 'express';
import { Elysia } from 'elysia';
import type {
	DashboardAuthContext,
	DashboardAuthDecision,
	DashboardAuthOptions,
	DashboardRole,
	Supervisor,
} from '@vasto-queue/core';
import {
	vastoAdapter,
	resolveDashboardConfig,
	type DashboardApiOptions,
} from '@vasto-queue/dashboard-api';

export interface ElysiaDashboardController {
	plugin: Elysia;
	waitUntilReady: () => Promise<void>;
	close: () => Promise<void>;
}

type DashboardPermission = 'read' | 'operate' | 'admin';

type QueueOverview = {
	queue: string;
	connection?: string;
	configuredConcurrency: number;
	paused?: boolean;
	depth: number;
	load?: number;
	deferredCount: number;
	dlqCount: number;
	completedCount?: number;
};

type ReliabilityQueue = {
	queueName: string;
	backpressureActive: boolean;
	circuitState: 'closed' | 'open' | 'half-open';
	updatedAt: number;
};

type DashboardOverview = {
	status: string;
	generatedAt: number;
	totals: { depth: number; load?: number; deferred: number; dlq: number; completed: number };
	metrics?: {
		recentCompletionTimestamps: number[];
		maxRuntimeMs: number;
	};
	reliability?: {
		openCircuits: number;
		halfOpenCircuits: number;
		backpressuredQueues: number;
		queues: ReliabilityQueue[];
	};
	queues: QueueOverview[];
	workers: {
		configured: Array<{ name: string; queues: string[]; concurrency: number; isolation: string }>;
		desiredScaling: Record<string, number>;
	};
};

const ROLE_LEVEL: Record<DashboardRole, number> = {
	viewer: 1,
	operator: 2,
	admin: 3,
};

function normalizeDecision(decision: DashboardAuthDecision): DashboardAuthContext | null {
	if (decision === true) {
		return { role: 'admin' };
	}

	if (!decision) {
		return null;
	}

	return {
		...decision,
		...(decision.role ? {} : { role: 'admin' }),
	};
}

function permissionToLevel(permission: DashboardPermission): number {
	return permission === 'read' ? 1 : permission === 'operate' ? 2 : 3;
}

async function authenticateWithHeaders(
	auth: DashboardAuthOptions,
	headers: Record<string, string | undefined>,
	requestRef: unknown
): Promise<DashboardAuthContext | null> {
	if (auth.type === 'none') {
		return { role: 'admin' };
	}

	const sessionValidator = auth.sessionValidator ?? auth.authValidator ?? auth.validator;
	if (!sessionValidator) {
		return null;
	}

	const header = headers.authorization;
	if (typeof header === 'string' && header.startsWith('Bearer ')) {
		return normalizeDecision(
			await sessionValidator({
				token: header.slice(7).trim(),
				request: requestRef as never,
			})
		);
	}

	const requestUrl =
		typeof requestRef === 'object' && requestRef && 'url' in requestRef
			? String((requestRef as { url?: string }).url ?? '')
			: '';
	if (!requestUrl) {
		return null;
	}

	const parsed = new URL(requestUrl, 'http://localhost');
	const token = parsed.searchParams.get('access_token') ?? parsed.searchParams.get('token');
	if (!token) {
		return null;
	}

	return normalizeDecision(
		await sessionValidator({
			token,
			request: requestRef as never,
		})
	);
}

function hasDashboardPermissionForContext(
	authContext: DashboardAuthContext,
	permission: DashboardPermission
): boolean {
	const role = authContext.role ?? 'admin';
	const requiredLevel = permissionToLevel(permission);
	if ((ROLE_LEVEL[role] ?? 0) < requiredLevel) {
		return false;
	}

	if (authContext.scopes == null || authContext.scopes.length === 0) {
		return true;
	}

	const scopeLevel = authContext.scopes.reduce<number>((level, scope) => {
		if (scope === 'dashboard:admin') return Math.max(level, 3);
		if (scope === 'dashboard:operate') return Math.max(level, 2);
		if (scope === 'dashboard:read') return Math.max(level, 1);
		return level;
	}, 0);

	return scopeLevel >= requiredLevel;
}

function getAllowedQueues(context: DashboardAuthContext): Set<string> | null {
	if (!context.allowedQueues || context.allowedQueues.length === 0) {
		return null;
	}

	return new Set(context.allowedQueues);
}

function filterOverviewByQueues(overview: DashboardOverview, allowedQueues: Set<string> | null): DashboardOverview {
	if (!allowedQueues) {
		return overview;
	}

	const filteredQueues = overview.queues.filter((queue) => allowedQueues.has(queue.queue));
	const totals = filteredQueues.reduce(
		(acc, queue) => {
			acc.depth += queue.depth;
			acc.deferred += queue.deferredCount;
			acc.dlq += queue.dlqCount;
			acc.completed += queue.completedCount ?? 0;
			return acc;
		},
		{ depth: 0, deferred: 0, dlq: 0, completed: 0 }
	);

	const reliabilityQueues = (overview.reliability?.queues ?? []).filter((queue) =>
		allowedQueues.has(queue.queueName)
	);

	const filteredWorkers = overview.workers.configured
		.map((worker) => ({
			...worker,
			queues: worker.queues.filter((queueName) => allowedQueues.has(queueName)),
		}))
		.filter((worker) => worker.queues.length > 0);

	return {
		...overview,
		totals: {
			...totals,
			load: totals.depth,
		},
		queues: filteredQueues,
		workers: {
			configured: filteredWorkers,
			desiredScaling: Object.fromEntries(
				Object.entries(overview.workers.desiredScaling).filter(([workerName]) =>
					filteredWorkers.some((worker) => worker.name === workerName)
				)
			),
		},
		reliability: {
			openCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'open').length,
			halfOpenCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'half-open').length,
			backpressuredQueues: reliabilityQueues.filter((queue) => queue.backpressureActive).length,
			queues: reliabilityQueues,
		},
	};
}

async function buildOverview(supervisor: Supervisor): Promise<DashboardOverview> {
	const queueNames = supervisor.getQueueNames();
	const queueStats = await Promise.all(
		queueNames.map(async (queueName) => {
			const config = supervisor.getQueueConfig(queueName);
			const depth = await supervisor.getQueueDepth([queueName]);
			const deferred = await supervisor.queryDeferredJobs({ queueName, status: 'pending', limit: 1000 });
			const dlq = await supervisor.getDLQ({ queueName, limit: 1000 });
			const completed = await supervisor.getCompletedJobs({ queueName, limit: 1000 });
			const recentCompletionTimestamps = completed
				.map((job) => job.completedAt)
				.filter((value): value is number => Number.isFinite(value));
			const maxRuntimeMs = completed.reduce((max, job) => {
				const runtime = Math.max(0, job.completedAt - job.createdAt);
				return runtime > max ? runtime : max;
			}, 0);

			return {
				queue: queueName,
				...(config?.connection ? { connection: config.connection } : {}),
				configuredConcurrency: config?.concurrency ?? 0,
				paused: supervisor.isQueuePaused(queueName),
				depth,
				load: depth,
				deferredCount: deferred.length,
				dlqCount: dlq.length,
				completedCount: completed.length,
				recentCompletionTimestamps,
				maxRuntimeMs,
			};
		})
	);

	const recentCompletionTimestamps = queueStats
		.flatMap((queue) => queue.recentCompletionTimestamps)
		.sort((left, right) => right - left)
		.slice(0, 10_000);

	const maxRuntimeMs = queueStats.reduce((max, queue) => {
		return queue.maxRuntimeMs > max ? queue.maxRuntimeMs : max;
	}, 0);

	const totals = queueStats.reduce(
		(acc, queue) => {
			acc.depth += queue.depth;
			acc.deferred += queue.deferredCount;
			acc.dlq += queue.dlqCount;
			acc.completed += queue.completedCount;
			return acc;
		},
		{ depth: 0, deferred: 0, dlq: 0, completed: 0 }
	);

	const workers = supervisor.getWorkerDefinitions();
	const reliabilityGetter = (supervisor as Supervisor & {
		getReliabilitySnapshot?: () => {
			openCircuits: number;
			halfOpenCircuits: number;
			backpressuredQueues: number;
			queues: ReliabilityQueue[];
		};
	}).getReliabilitySnapshot;
	const reliability =
		typeof reliabilityGetter === 'function'
			? reliabilityGetter.call(supervisor)
			: {
				openCircuits: 0,
				halfOpenCircuits: 0,
				backpressuredQueues: 0,
				queues: [],
			};

	return {
		status: 'ok',
		generatedAt: Date.now(),
		totals: {
			...totals,
			load: totals.depth,
		},
		metrics: {
			recentCompletionTimestamps,
			maxRuntimeMs,
		},
		reliability,
		queues: queueStats.map(({ recentCompletionTimestamps: _recentCompletionTimestamps, maxRuntimeMs: _maxRuntimeMs, ...queue }) => queue),
		workers: {
			configured: Object.entries(workers).map(([name, def]) => ({
				name,
				queues: def.queues,
				concurrency: def.concurrency,
				isolation: def.isolation ?? 'inline',
			})),
			desiredScaling: supervisor.getDesiredWorkerScaling(),
		},
	};
}

function isBodyMethod(method: string): boolean {
	return method !== 'GET' && method !== 'HEAD';
}

function copyRequestHeaders(headers: Headers): Headers {
	const forwarded = new Headers();
	for (const [name, value] of headers.entries()) {
		if (
			name === 'host' ||
			name === 'connection' ||
			name === 'content-length' ||
			name === 'transfer-encoding' ||
			name === 'keep-alive'
		) {
			continue;
		}

		forwarded.set(name, value);
	}

	return forwarded;
}

function addProxyRoute(
	plugin: Elysia,
	method: 'all' | 'get',
	basePath: string,
	handler: (request: Request) => Promise<Response>
) {
	if (method === 'all') {
		plugin.all(basePath, ({ request }) => handler(request));
		plugin.all(basePath === '/' ? '/*' : `${basePath}/*`, ({ request }) => handler(request));
		return;
	}

	plugin.get(basePath, ({ request }) => handler(request));
	plugin.get(basePath === '/' ? '/*' : `${basePath}/*`, ({ request }) => handler(request));
	plugin.route('HEAD', basePath, ({ request }) => handler(request));
	plugin.route('HEAD', basePath === '/' ? '/*' : `${basePath}/*`, ({ request }) => handler(request));
}

export function createElysiaAdapter(options: DashboardApiOptions): ElysiaDashboardController {
	const resolved = resolveDashboardConfig(options);
	const dashboardApp = express();
	dashboardApp.use(vastoAdapter(options));

	const proxyServer = http.createServer(dashboardApp);

	const ready = new Promise<string>((resolve, reject) => {
		const onError = (error: Error) => {
			proxyServer.off('listening', onListening);
			reject(error);
		};

		const onListening = () => {
			proxyServer.off('error', onError);
			const address = proxyServer.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Unable to resolve internal Elysia dashboard proxy address.'));
				return;
			}

			resolve(`http://127.0.0.1:${address.port}`);
		};

		proxyServer.once('error', onError);
		proxyServer.once('listening', onListening);
		proxyServer.listen(0, '127.0.0.1');
	});

	const proxyRequest = async (request: Request): Promise<Response> => {
		const origin = await ready;
		const url = new URL(request.url);
		const target = new URL(`${url.pathname}${url.search}`, origin);
		const init: RequestInit & { duplex?: 'half' } = {
			method: request.method,
			headers: copyRequestHeaders(request.headers),
			redirect: 'manual',
		};

		if (isBodyMethod(request.method)) {
			init.body = request.body;
			init.duplex = 'half';
		}

		const response = await fetch(target, init);
		return new Response(response.body, {
			status: response.status,
			headers: response.headers,
		});
	};

	const plugin = new Elysia({ name: 'vasto-elysia-dashboard' });
	addProxyRoute(plugin, 'all', resolved.base, proxyRequest);
	if (resolved.legacyBase) {
		addProxyRoute(plugin, 'all', resolved.legacyBase, proxyRequest);
	}
	if (resolved.uiDir) {
		addProxyRoute(plugin, 'get', resolved.uiBase, proxyRequest);
	}

	const activeSockets = new Map<
		string,
		{
			close: () => void;
		}
	>();

	const registerWsRoute = (basePath: string) => {
		plugin.ws(`${basePath}/ws`, {
			beforeHandle: async ({ headers, request, status, set }) => {
				const headerRecord = Object.fromEntries(
					Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
				) as Record<string, string | undefined>;
				const authContext = await authenticateWithHeaders(resolved.auth, headerRecord, request);
				if (!authContext) {
					const realm =
						resolved.auth.type === 'none'
							? 'vasto-dashboard'
							: (resolved.auth.realm ?? 'vasto-dashboard');
					set.headers['www-authenticate'] = `Bearer realm="${realm}"`;
					return status(401, { error: 'Unauthorized' });
				}

				if (!hasDashboardPermissionForContext(authContext, 'read')) {
					return status(403, { error: 'Insufficient permissions' });
				}

				return {
					dashboardAuthContext: authContext,
				};
			},
			open: (ws) => {
				const authContext = (ws.data as { dashboardAuthContext?: DashboardAuthContext }).dashboardAuthContext;
				if (!authContext) {
					ws.close();
					return;
				}

				const allowedQueues = getAllowedQueues(authContext);

				const sendOverview = async () => {
					if (ws.readyState !== 1) {
						return;
					}

					try {
						const overview = await buildOverview(options.supervisor);
						ws.send(
							JSON.stringify({
								type: 'overview',
								data: filterOverviewByQueues(overview, allowedQueues),
							})
						);
					} catch {
						// ignore send failures for closing sockets
					}
				};

				void sendOverview();

				const replay = options.supervisor
					.getRecentLifecycleEvents(100)
					.filter((event) => !allowedQueues || !event.queueName || allowedQueues.has(event.queueName));
				for (const event of replay) {
					ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
				}

				const unsubscribe = options.supervisor.subscribeLifecycleEvents((event) => {
					if (allowedQueues && event.queueName && !allowedQueues.has(event.queueName)) {
						return;
					}

					if (ws.readyState !== 1) {
						return;
					}

					try {
						ws.send(JSON.stringify({ type: 'lifecycle', data: event }));
					} catch {
						// ignore send failures for closing sockets
					}
				});

				const timer = setInterval(() => {
					void sendOverview();
				}, resolved.streamIntervalMs);

				activeSockets.set(ws.id, {
					close: () => {
						unsubscribe();
						clearInterval(timer);
					},
				});
			},
			close: (ws) => {
				const socket = activeSockets.get(ws.id);
				socket?.close();
				activeSockets.delete(ws.id);
			},
		});
	};

	registerWsRoute(resolved.base);
	if (resolved.legacyBase) {
		registerWsRoute(resolved.legacyBase);
	}

	return {
		plugin,
		waitUntilReady: async () => {
			await ready;
		},
		close: async () => {
			for (const socket of activeSockets.values()) {
				socket.close();
			}
			activeSockets.clear();

			await new Promise<void>((resolve, reject) => {
				proxyServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}

					resolve();
				});
			});
		},
	};
}

export function vastoElysiaAdapter(options: DashboardApiOptions): ElysiaDashboardController {
	return createElysiaAdapter(options);
}

export function registerElysiaAdapter(app: Elysia, options: DashboardApiOptions): ElysiaDashboardController {
	const controller = createElysiaAdapter(options);
	app.use(controller.plugin);
	return controller;
}