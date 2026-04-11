import {
	InMemoryQueueStorage,
	JobRegistry,
	Supervisor,
	defineQueues,
	defineWorkers,
	resolveRuntimeModules,
} from '@vasto-queue/core';
import { TracingPlugin } from '@vasto-queue/otel-plugin';
import { DAGPlugin, RateLimiterPlugin } from '@vasto-queue/plugins';
import { CleanupJob, GenerateReportJob, SendEmailJob } from './jobs/index.js';

async function main() {
	const mainModules = resolveRuntimeModules('main');

	const registry = new JobRegistry();
	registry.registerAll([SendEmailJob, GenerateReportJob, CleanupJob]);

	const queues = defineQueues({
		emails: {
			name: 'emails',
			connection: 'memory',
			concurrency: 4,
			batchSize: 10,
			rateLimit: {
				capacity: 50,
				refillRate: 50,
			},
		},
		reports: {
			name: 'reports',
			connection: 'memory',
			concurrency: 2,
			batchSize: 5,
		},
		maintenance: {
			name: 'maintenance',
			connection: 'memory',
			concurrency: 1,
			batchSize: 2,
		},
	});

	const workers = defineWorkers({
		main: {
			queues: ['emails', 'reports', 'maintenance'],
			concurrency: 2,
			poolSize: 4,
			workerModule: mainModules.isolationWorkerModule,
			...(mainModules.registryModule ? { registryModule: mainModules.registryModule } : {}),
			...(mainModules.runtimePluginsModule ? { pluginsModule: mainModules.runtimePluginsModule } : {}),
			isolation: 'thread',
		},
	});

	const storageAdapters = {
		memory: new InMemoryQueueStorage(),
	};

	const supervisor = new Supervisor({
		queues,
		workers,
		registry,
		storageAdapters,
		globalPlugins: [
			new DAGPlugin(),
			new TracingPlugin({ tracerName: 'runtime' }),
		],
	});

	const emailsQueue = queues.emails;
	if (!emailsQueue) {
		throw new Error('emails queue is not defined');
	}

	emailsQueue.plugins = [RateLimiterPlugin({ emails: emailsQueue })];

	// Phase 1.2: Priority email routing demo
	// Emails are dispatched out-of-order but processed in priority order:
	// critical → high → normal → low
	await supervisor.jobManager.dispatch(
		new SendEmailJob({
			to: 'ops@vasto-queue.local',
			subject: '[CRITICAL] Production alert',
			body: 'Immediate attention required.',
		}),
		{ priority: 'critical' }
	);

	await supervisor.jobManager.dispatch(
		new SendEmailJob({
			to: 'dev@vasto-queue.local',
			subject: 'Weekly newsletter',
			body: 'Here is your weekly digest.',
		}),
		{ priority: 'low' }
	);

	await supervisor.jobManager.dispatch(
		new SendEmailJob({
			to: 'support@vasto-queue.local',
			subject: 'Your ticket was updated',
			body: 'A reply was posted to your support ticket.',
		}),
		{ priority: 'high' }
	);

	await supervisor.jobManager.dispatch(
		new SendEmailJob({
			to: 'dev@vasto-queue.local',
			subject: 'Hello from Vasto',
			body: 'This is a class-based job dispatch test.',
		})
		// no priority → treated as 'normal'
	);

	await supervisor.jobManager.dispatch(
		new GenerateReportJob({
			reportId: 'sales-weekly-001',
			period: 'weekly',
		})
	);

	await supervisor.jobManager.dispatch(
		new CleanupJob({
			path: '/tmp/vasto-cache',
		})
	);

	await supervisor.start();

	console.log('runtime initialized with plugins:', ['DAGPlugin', 'TracingPlugin']);
	console.log('queue-level plugins for emails:', emailsQueue.plugins?.map((plugin) => plugin.name));
	console.log('isolation worker module:', mainModules.isolationWorkerModule);

	setTimeout(() => {
		supervisor.stop();
		console.log('supervisor stopped');
	}, 60000);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});