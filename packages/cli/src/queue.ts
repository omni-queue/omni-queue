import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { runGenerateIsolation } from './gen';

// Template written to <outDir>/dashboard-config.example.js by `dashboard:publish`.
const DASHBOARD_CONFIG_EXAMPLE = `// dashboard-config.example.js
//
// Inject this <script> block into the HTML page that hosts the Omni Queue
// dashboard (e.g. app.html, _document.tsx, layout.ejs) BEFORE the dashboard
// JS bundle tag.  All keys are optional — omit any you do not need to override.
//
// window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
//
//   // transport
//   // ─────────────────────────────────────────────────────────────────────
//   // Controls the real-time data transport used by the dashboard.
//   //   'auto'    — try WebSocket first, fall back to long-polling (default)
//   //   'polling' — force long-polling only
//   //                (use this when WebSocket upgrades are blocked by a
//   //                 proxy, CDN, serverless platform, or load balancer)
//   //
//   // Can also be set per-page-load via URL query param:  ?transport=polling
//   // Build-time env var (local dev only):  VITE_DASHBOARD_TRANSPORT=polling
//   //
//   transport: 'auto',
//
//   // endpoint
//   // ─────────────────────────────────────────────────────────────────────
//   // The API base URL the dashboard uses to reach the Omni Queue API.
//   // Must match the \`apiBase\` option you passed to your framework adapter.
//   //
//   // Build-time env var (local dev only):  VITE_DASHBOARD_ENDPOINT=/api/omni-queue
//   //
//   // Default: '/api/dashboard'
//   //
//   endpoint: '/api/dashboard',
//
// };
`;

type WorkerManifest = {
	workers?: Array<{
		name: string;
		queues: string[];
		concurrency?: number;
		isolation?: string;
		poolSize?: number;
	}>;
};

export async function runQueue(queueArgs: string[]) {
	const command = queueArgs[0];
	const subcommand = queueArgs[1];
	const flagArgs = queueArgs.slice(1);

	switch (command) {
		case 'init':
			await runQueueInit(flagArgs);
			return;
		case 'generate':
			if (subcommand === 'isolation') {
				await runGenerateIsolation(queueArgs.slice(2));
				return;
			} else if (subcommand === 'job') {
				await runGenerateJob(queueArgs.slice(2));
				return;
			} else if (subcommand === 'api-job') {
				await runGenerateApiJob(queueArgs.slice(2));
				return;
			} else if (subcommand === 'workflow') {
				await runGenerateWorkflow(queueArgs.slice(2));
				return;
			} else if (subcommand === 'scheduled') {
				await runGenerateScheduledJob(queueArgs.slice(2));
				return;
			}
			break;
		case 'generate:job':
			await runGenerateJob(flagArgs);
			return;
			case 'generate:api-job':
				await runGenerateApiJob(flagArgs);
				return;
			case 'generate:workflow':
				await runGenerateWorkflow(flagArgs);
				return;
			case 'generate:scheduled':
				await runGenerateScheduledJob(flagArgs);
				return;
		case 'monitor':
			await runMonitor(flagArgs);
			return;
		case 'dlq:list':
			await runDlqList(flagArgs);
			return;
		case 'dlq:retry':
			await runDlqRetry(flagArgs);
			return;
		case 'dlq:retry-all':
			await runDlqRetryAll(flagArgs);
			return;
		case 'dev':
			await runQueueDev();
			return;
		case 'start':
			await runQueueStart();
			return;
		case 'dashboard':
			if (subcommand === 'publish') {
				await runQueueDashboardPublish(queueArgs.slice(2));
				return;
			}
			await runQueueDashboard();
			return;
		case 'dashboard:publish':
			await runQueueDashboardPublish(flagArgs);
			return;
		case 'workers:list':
			await runWorkersList();
			return;
		case 'gen':
			if (subcommand === 'isolation') {
				await runGenerateIsolation(queueArgs.slice(2));
				return;
			} else if (subcommand === 'job') {
				await runGenerateJob(queueArgs.slice(2));
				return;
				} else if (subcommand === 'api-job') {
					await runGenerateApiJob(queueArgs.slice(2));
					return;
				} else if (subcommand === 'workflow') {
					await runGenerateWorkflow(queueArgs.slice(2));
					return;
				} else if (subcommand === 'scheduled') {
					await runGenerateScheduledJob(queueArgs.slice(2));
					return;
			}
			break;
		default:
			break;
	}

	printQueueUsage();
	process.exitCode = command ? 1 : 0;
}

function printQueueUsage() {
	console.log('Omni-Queue CLI');
	console.log('');
	console.log('Usage:');
	console.log('  queue init [--yes] [--dir=.]');
	console.log('  queue generate isolation [--dir=./src/definitions]');
	console.log('  queue generate job --name=send-email [--dir=./src/jobs] [--queue=default]');
	console.log('  queue generate api-job --name=send-email [--dir=./src/jobs] [--queue=api-jobs]');
	console.log('  queue generate workflow --name=asset-pipeline [--dir=./src/workflows] [--queue=default]');
	console.log('  queue generate scheduled --name=daily-digest [--dir=./src/jobs] [--queue=default]');
	console.log('  queue monitor [--baseUrl=http://localhost:3110] [--queue=name]');
	console.log('  queue dlq:list [--baseUrl=http://localhost:3110] [--queue=name] [--limit=20] [--offset=0]');
	console.log('  queue dlq:retry --queue=name --jobId=id [--baseUrl=http://localhost:3110]');
	console.log('  queue dlq:retry-all --queue=name [--baseUrl=http://localhost:3110] [--limit=100]');
	console.log('  queue dev');
	console.log('  queue start');
	console.log('  queue dashboard');
	console.log('  queue dashboard publish [--out=./public/omni-queue-dashboard]');
	console.log('  queue dashboard:publish [--out=./public/omni-queue-dashboard]');
	console.log('  queue workers:list');
}

function parseFlags(flagArgs: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (const arg of flagArgs) {
		if (!arg.startsWith('--')) continue;
		const match = arg.match(/^--([^=]+)=?(.*)$/);
		if (!match) continue;
		flags[match[1]!] = match[2] ?? 'true';
	}
	return flags;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

function toKebabCase(value: string): string {
	return value
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
}

function toPascalCase(value: string): string {
	return toKebabCase(value)
		.split('-')
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join('');
}

function ensureDirectory(dirPath: string) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath: string, content: string) {
	if (fs.existsSync(filePath)) return;
	ensureDirectory(path.dirname(filePath));
	fs.writeFileSync(filePath, content, 'utf8');
}

function emptyDirectory(dirPath: string) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		return;
	}

	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const entryPath = path.join(dirPath, entry.name);
		fs.rmSync(entryPath, { recursive: true, force: true });
	}
}

function copyDirectory(sourceDir: string, targetDir: string) {
	ensureDirectory(targetDir);
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
			continue;
		}

		fs.copyFileSync(sourcePath, targetPath);
	}
}

function resolveDashboardDistDir(cwd: string): string {
	const require = createRequire(import.meta.url);
	try {
		const dashboardPackageJson = require.resolve('@omni-queue/dashboard/package.json', {
			paths: [cwd],
		});
		const distDir = path.join(path.dirname(dashboardPackageJson), 'dist');
		if (fs.existsSync(distDir) && fs.statSync(distDir).isDirectory()) {
			return distDir;
		}
	} catch {
		// handled below with a user-facing error
	}

	throw new Error(
		'Unable to locate dashboard dist assets from @omni-queue/dashboard. Install the package in this project before publishing assets.'
	);
}

function mergePackageScripts(pkgPath: string, scripts: Record<string, string>) {
	const parsed = fs.existsSync(pkgPath)
		? (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> })
		: {};
	parsed.scripts = parsed.scripts ?? {};
	for (const [key, value] of Object.entries(scripts)) {
		if (!parsed.scripts[key]) {
			parsed.scripts[key] = value;
		}
	}
	fs.writeFileSync(pkgPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

async function runQueueInit(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const projectDir = path.resolve(cwd, flags.dir ?? '.');
	const runtimeDir = path.join(projectDir, '.omni', 'runtime');
	const srcJobsDir = path.join(projectDir, 'src', 'jobs');
	const srcDefinitionsDir = path.join(projectDir, 'src', 'definitions');
	const packageJsonPath = path.join(projectDir, 'package.json');

	ensureDirectory(runtimeDir);
	ensureDirectory(srcJobsDir);
	ensureDirectory(srcDefinitionsDir);

	const sampleJobPath = path.join(srcJobsDir, 'sample-job.ts');
	ensureFile(
		sampleJobPath,
		[
			"import type { Job } from '@omni-queue/core';",
			'',
			'type SampleJobPayload = {',
			"\tmessage: string;",
			'};',
			'',
			'export class SampleJob implements Job<SampleJobPayload, void> {',
			"\treadonly name = 'sample-job';",
			'',
			'\tasync handle(payload: SampleJobPayload): Promise<void> {',
			"\t\tconsole.log('[sample-job]', payload.message);",
			'\t}',
			'}',
			'',
		].join('\n')
	);

	const sampleDefinitionPath = path.join(srcDefinitionsDir, 'main.ts');
	ensureFile(
		sampleDefinitionPath,
		[
			"import { defineIsolation } from '@omni-queue/core';",
			"import { SampleJob } from '../jobs/sample-job';",
			'',
			'export const { getRegistry, getPlugins } = defineIsolation({',
			'\tjobs: [SampleJob],',
			'\tplugins: [],',
			'});',
			'',
		].join('\n')
	);

	if (fs.existsSync(packageJsonPath)) {
		mergePackageScripts(packageJsonPath, {
			'queue:dev': 'queue dev',
			'queue:start': 'queue start',
			'queue:monitor': 'queue monitor',
			'queue:dashboard:publish': 'queue dashboard:publish --out=./public/omni-queue-dashboard',
			'queue:generate:isolation': 'queue generate isolation',
			'queue:generate:job': 'queue generate job --name=sample-job',
			'queue:dlq:list': 'queue dlq:list',
		});
	}

	console.log('Omni-Queue project initialized.');
	console.log(`- Runtime directory: ${path.relative(cwd, runtimeDir) || '.omni/runtime'}`);
	console.log(`- Sample job: ${path.relative(cwd, sampleJobPath)}`);
	console.log(`- Sample definition: ${path.relative(cwd, sampleDefinitionPath)}`);
	if (fs.existsSync(packageJsonPath)) {
		console.log('- Added queue:* scripts to package.json (without overwriting existing scripts).');
	}
	console.log('Next steps:');
	console.log('  1) queue generate isolation');
	console.log('  2) queue generate job --name=send-email');
	console.log('  3) queue dashboard:publish --out=./public/omni-queue-dashboard');
	console.log('  4) queue monitor');
}

async function runGenerateJob(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const rawName = flags.name;

	if (!rawName) {
		throw new Error('Missing --name. Example: queue generate job --name=send-email');
	}

	const jobName = toKebabCase(rawName);
	if (!jobName) {
		throw new Error('Invalid --name. Use letters, numbers, dashes, or spaces.');
	}

	const className = `${toPascalCase(jobName)}Job`;
	const queueName = toKebabCase(flags.queue ?? 'default') || 'default';
	const targetDir = path.resolve(cwd, flags.dir ?? './src/jobs');
	const filePath = path.join(targetDir, `${jobName}.job.ts`);

	if (fs.existsSync(filePath)) {
		throw new Error(`Job file already exists: ${filePath}`);
	}

	ensureDirectory(targetDir);
	fs.writeFileSync(
		filePath,
		[
			"import type { Job } from '@omni-queue/core';",
			'',
			`export type ${className}Payload = {`,
			"\tinput: string;",
			'};',
			'',
			`export type ${className}Result = {`,
			"\tok: boolean;",
			'};',
			'',
			`export class ${className} implements Job<${className}Payload, ${className}Result> {`,
			`\treadonly name = '${jobName}';`,
			`\treadonly queue = '${queueName}';`,
			'',
			`\tasync handle(payload: ${className}Payload): Promise<${className}Result> {`,
			'\t\treturn {',
			'\t\t\tok: payload.input.length > 0,',
			'\t\t};',
			'\t}',
			'}',
			'',
		].join('\n'),
		'utf8'
	);

	console.log(`Generated job: ${path.relative(cwd, filePath)}`);
	console.log(`Class: ${className}`);
	console.log(`Queue: ${queueName}`);
}

async function runGenerateApiJob(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const rawName = flags.name;

	if (!rawName) {
		throw new Error('Missing --name. Example: queue generate api-job --name=send-email');
	}

	const jobName = toKebabCase(rawName);
	const className = `${toPascalCase(jobName)}ApiJob`;
	const queueName = toKebabCase(flags.queue ?? 'api-jobs') || 'api-jobs';
	const targetDir = path.resolve(cwd, flags.dir ?? './src/jobs');
	const filePath = path.join(targetDir, `${jobName}.api-job.ts`);

	if (fs.existsSync(filePath)) {
		throw new Error(`Job file already exists: ${filePath}`);
	}

	ensureDirectory(targetDir);
	fs.writeFileSync(
		filePath,
		[
			"import { Job } from '@omni-queue/core';",
			'',
			`export type ${className}Payload = {`,
			"\trequestId: string;",
			"\tbody: Record<string, unknown>;",
			'};',
			'',
			`export type ${className}Result = {`,
			"\tok: boolean;",
			"\thandledAt: string;",
			'};',
			'',
			`export class ${className} extends Job<${className}Payload> {`,
			`	static jobName = '${jobName}';`,
			`	override jobName = ${className}.jobName;`,
			'',
			'	override queue(): string {',
			`		return '${queueName}';`,
			'	}',
			'',
			'	override isolation(): \"inline\" {',
			"		return 'inline';",
			'	}',
			'',
			`	override async handle(payload: ${className}Payload): Promise<${className}Result> {`,
			"		return { ok: true, handledAt: new Date().toISOString() };",
			'	}',
			'}',
			'',
		].join('\n'),
		'utf8'
	);

	console.log(`Generated API job template: ${path.relative(cwd, filePath)}`);
}

async function runGenerateWorkflow(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const rawName = flags.name;

	if (!rawName) {
		throw new Error('Missing --name. Example: queue generate workflow --name=asset-pipeline');
	}

	const workflowName = toKebabCase(rawName);
	const classBase = toPascalCase(workflowName);
	const queueName = toKebabCase(flags.queue ?? 'default') || 'default';
	const targetDir = path.resolve(cwd, flags.dir ?? './src/workflows');
	const filePath = path.join(targetDir, `${workflowName}.workflow.ts`);

	if (fs.existsSync(filePath)) {
		throw new Error(`Workflow file already exists: ${filePath}`);
	}

	ensureDirectory(targetDir);
	fs.writeFileSync(
		filePath,
		[
			"import { Job, type FlowNodeInput, type Supervisor } from '@omni-queue/core';",
			'',
			`export class ${classBase}PrepareJob extends Job<{ workflowId: string }> {`,
			`	static jobName = '${workflowName}-prepare';`,
			`	override jobName = ${classBase}PrepareJob.jobName;`,
			'	override queue(): string {',
			`		return '${queueName}';`,
			'	}',
			'	override async handle(): Promise<string> {',
			"		return 'prepared';",
			'	}',
			'}',
			'',
			`export class ${classBase}FinalizeJob extends Job<{ workflowId: string }> {`,
			`	static jobName = '${workflowName}-finalize';`,
			`	override jobName = ${classBase}FinalizeJob.jobName;`,
			'	override queue(): string {',
			`		return '${queueName}';`,
			'	}',
			'	override async handle(): Promise<string> {',
			"		return 'finalized';",
			'	}',
			'}',
			'',
			`export async function dispatch${classBase}Workflow(supervisor: Supervisor, workflowId: string) {`,
			'	const nodes: FlowNodeInput[] = [',
			`		{ id: 'prepare', job: new ${classBase}PrepareJob({ workflowId }) },`,
			`		{ id: 'finalize', job: new ${classBase}FinalizeJob({ workflowId }), dependsOn: ['prepare'] },`,
			'	];',
			'',
			'	return supervisor.dispatchFlow(nodes, { flowId: workflowId, atomicFailure: true });',
			'}',
			'',
		].join('\n'),
		'utf8'
	);

	console.log(`Generated workflow template: ${path.relative(cwd, filePath)}`);
}

async function runGenerateScheduledJob(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const rawName = flags.name;

	if (!rawName) {
		throw new Error('Missing --name. Example: queue generate scheduled --name=daily-digest');
	}

	const jobName = toKebabCase(rawName);
	const className = `${toPascalCase(jobName)}ScheduledJob`;
	const queueName = toKebabCase(flags.queue ?? 'default') || 'default';
	const targetDir = path.resolve(cwd, flags.dir ?? './src/jobs');
	const filePath = path.join(targetDir, `${jobName}.scheduled.ts`);

	if (fs.existsSync(filePath)) {
		throw new Error(`Scheduled job file already exists: ${filePath}`);
	}

	ensureDirectory(targetDir);
	fs.writeFileSync(
		filePath,
		[
			"import { Job, type JobManager } from '@omni-queue/core';",
			'',
			`export class ${className} extends Job<{ triggeredBy: string }> {`,
			`	static jobName = '${jobName}';`,
			`	override jobName = ${className}.jobName;`,
			'',
			'	override queue(): string {',
			`		return '${queueName}';`,
			'	}',
			'',
			`	override async handle(payload: { triggeredBy: string }): Promise<void> {`,
			"		console.log('scheduled trigger', payload.triggeredBy);",
			'	}',
			'}',
			'',
			`export async function schedule${toPascalCase(jobName)}(jobManager: JobManager) {`,
			`	return jobManager.schedule(new ${className}({ triggeredBy: 'scheduler' }), {`,
			"		pattern: '0 * * * *',",
			'	});',
			'}',
			'',
		].join('\n'),
		'utf8'
	);

	console.log(`Generated scheduled job template: ${path.relative(cwd, filePath)}`);
}

function resolveBaseUrl(flags: Record<string, string>): string {
	const raw = flags.baseUrl ?? process.env.OMNI_QUEUE_API_URL ?? 'http://localhost:3110';
	return raw.replace(/\/+$/, '');
}

async function fetchJson(baseUrl: string, endpoint: string, init?: RequestInit): Promise<unknown> {
	const response = await fetch(`${baseUrl}${endpoint}`, {
		headers: {
			'content-type': 'application/json',
			...(init?.headers ?? {}),
		},
		...init,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Request failed (${response.status}) ${endpoint}: ${body || response.statusText}`);
	}

	if (response.status === 204) {
		return {};
	}

	return response.json();
}

async function runMonitor(flagArgs: string[]) {
	const flags = parseFlags(flagArgs);
	const baseUrl = resolveBaseUrl(flags);
	const queueName = flags.queue;

	const [health, overview] = await Promise.all([
		fetchJson(baseUrl, '/health'),
		fetchJson(baseUrl, '/overview'),
	]);

	console.log(`Dashboard API: ${baseUrl}`);
	console.log(JSON.stringify(health, null, 2));

	const overviewPayload = overview as {
		totals?: {
			depth?: number;
			deferred?: number;
			dlq?: number;
			active?: number;
			ready?: number;
			completed?: number;
		};
		queues?: Array<{ name: string }>;
	};

	console.log('Overview:');
	console.log(`- queues: ${overviewPayload.queues?.length ?? 0}`);
	console.log(`- depth: ${overviewPayload.totals?.depth ?? 0}`);
	console.log(`- ready: ${overviewPayload.totals?.ready ?? 0}`);
	console.log(`- active: ${overviewPayload.totals?.active ?? 0}`);
	console.log(`- deferred: ${overviewPayload.totals?.deferred ?? 0}`);
	console.log(`- completed: ${overviewPayload.totals?.completed ?? 0}`);
	console.log(`- dlq: ${overviewPayload.totals?.dlq ?? 0}`);

	if (queueName) {
		const status = (await fetchJson(baseUrl, `/queues/${encodeURIComponent(queueName)}/status`)) as {
			queue?: {
				queueName: string;
				paused: boolean;
				depth: number;
				ready: number;
				active: number;
				deferred: number;
				failed: number;
			};
		};

		if (status.queue) {
			console.log(`Queue ${status.queue.queueName}:`);
			console.log(`- paused: ${status.queue.paused}`);
			console.log(`- depth: ${status.queue.depth}`);
			console.log(`- ready: ${status.queue.ready}`);
			console.log(`- active: ${status.queue.active}`);
			console.log(`- deferred: ${status.queue.deferred}`);
			console.log(`- failed: ${status.queue.failed}`);
		}
	}
}

async function runDlqList(flagArgs: string[]) {
	const flags = parseFlags(flagArgs);
	const baseUrl = resolveBaseUrl(flags);
	const limit = parsePositiveInt(flags.limit, 20);
	const offset = parsePositiveInt(flags.offset, 0);
	const queueName = flags.queue;

	const query = new URLSearchParams({
		limit: String(limit),
		offset: String(offset),
	});
	if (queueName) {
		query.set('queue', queueName);
	}

	const payload = (await fetchJson(baseUrl, `/failed?${query.toString()}`)) as {
		total?: number;
		jobs?: Array<{ id: string; queue: string; name: string; attempts?: number; error?: { message?: string } }>;
	};

	const jobs = payload.jobs ?? [];
	console.log(`DLQ jobs: ${jobs.length}${payload.total != null ? ` / ${payload.total}` : ''}`);
	for (const job of jobs) {
		console.log(
			`- id=${job.id} queue=${job.queue} name=${job.name} attempts=${job.attempts ?? 0} error=${job.error?.message ?? '-'}`
		);
	}
}

async function runDlqRetry(flagArgs: string[]) {
	const flags = parseFlags(flagArgs);
	const { queue: queueName, jobId } = flags;

	if (!queueName || !jobId) {
		throw new Error('Missing --queue or --jobId. Example: queue dlq:retry --queue=emails --jobId=abc123');
	}

	const baseUrl = resolveBaseUrl(flags);
	await fetchJson(baseUrl, '/dlq/retry', {
		method: 'POST',
		body: JSON.stringify({ queueName, jobId }),
	});

	console.log(`Retried DLQ job: queue=${queueName} jobId=${jobId}`);
}

async function runDlqRetryAll(flagArgs: string[]) {
	const flags = parseFlags(flagArgs);
	const queueName = flags.queue;

	if (!queueName) {
		throw new Error('Missing --queue. Example: queue dlq:retry-all --queue=emails');
	}

	const baseUrl = resolveBaseUrl(flags);
	const limit = parsePositiveInt(flags.limit, 100);
	const payload = (await fetchJson(
		baseUrl,
		`/failed?queue=${encodeURIComponent(queueName)}&limit=${limit}&offset=0`
	)) as {
		jobs?: Array<{ id: string; queue: string }>;
	};

	const jobs = payload.jobs ?? [];
	let retried = 0;

	for (const job of jobs) {
		await fetchJson(baseUrl, '/dlq/retry', {
			method: 'POST',
			body: JSON.stringify({ queueName: job.queue, jobId: job.id }),
		});
		retried += 1;
	}

	console.log(`Retried ${retried} dead-letter jobs for queue=${queueName}.`);
	if (jobs.length === limit) {
		console.log('More jobs may remain. Re-run with a higher --limit if needed.');
	}
}

function readPackageScripts(cwd: string): Record<string, string> {
	const pkgPath = path.join(cwd, 'package.json');
	if (!fs.existsSync(pkgPath)) return {};
	const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
	return parsed.scripts ?? {};
}

function runNpmScript(script: string, cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('npm', ['run', script], {
			cwd,
			stdio: 'inherit',
			shell: process.platform === 'win32',
			env: process.env,
		});
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`npm run ${script} failed with code ${code ?? 'unknown'}`));
		});
		child.on('error', reject);
	});
}

function isRecursiveQueueAlias(scriptName: string, scriptCommand: string, queueCommand: 'dev' | 'start'): boolean {
	if (!scriptName.startsWith('queue:')) {
		return false;
	}

	const normalized = scriptCommand.trim().toLowerCase();
	const direct = new RegExp(`\\bqueue\\s+${queueCommand}\\b`);
	const npmAlias = new RegExp(`\\bnpm\\s+run\\s+queue:${queueCommand}\\b`);

	return direct.test(normalized) || npmAlias.test(normalized);
}

async function runPreferredScript(
	scripts: Record<string, string>,
	cwd: string,
	queueCommand: 'dev' | 'start',
	candidates: string[]
): Promise<boolean> {
	for (const candidate of candidates) {
		const scriptCommand = scripts[candidate];
		if (!scriptCommand) {
			continue;
		}

		if (isRecursiveQueueAlias(candidate, scriptCommand, queueCommand)) {
			continue;
		}

		await runNpmScript(candidate, cwd);
		return true;
	}

	return false;
}

async function runQueueDev() {
	const cwd = process.cwd();
	const scripts = readPackageScripts(cwd);

	if (await runPreferredScript(scripts, cwd, 'dev', ['dev', 'queue:dev'])) {
		return;
	}

	throw new Error('No dev script found. Add queue:dev or dev to package.json scripts.');
}

async function runQueueStart() {
	const cwd = process.cwd();
	const scripts = readPackageScripts(cwd);

	if (await runPreferredScript(scripts, cwd, 'start', ['start', 'queue:start', 'dev', 'queue:dev'])) {
		return;
	}

	throw new Error('No start/dev script found. Add start, queue:start, dev, or queue:dev to package.json scripts.');
}

async function runQueueDashboard() {
	const cwd = process.cwd();
	const runtimeDir = resolveRuntimeDir(cwd);

	console.log('Queue Dashboard');
	console.log('---------------');
	console.log(`Project: ${cwd}`);

	if (!runtimeDir) {
		console.log('Runtime directory not found. Expected .omni/runtime/');
		return;
	}

	console.log(`Runtime directory: ${runtimeDir}`);
	const shimPath = path.join(runtimeDir, 'isolation-worker.js');
	console.log(`- isolation-worker.js: ${fs.existsSync(shimPath) ? 'present' : 'missing'}`);

	const definitionFiles = fs.existsSync(runtimeDir)
		? fs.readdirSync(runtimeDir).filter((file) => file.endsWith('.js') && file !== 'isolation-worker.js')
		: [];

	if (definitionFiles.length > 0) {
		console.log('Generated definitions:');
		for (const file of definitionFiles) {
			console.log(`  - ${path.basename(file, '.js')}`);
		}
	}
}

async function runQueueDashboardPublish(flagArgs: string[]) {
	const cwd = process.cwd();
	const flags = parseFlags(flagArgs);
	const outDir = path.resolve(cwd, flags.out ?? flags.dir ?? './public/omni-queue-dashboard');
	const sourceDir = resolveDashboardDistDir(cwd);

	if (!fs.existsSync(path.join(sourceDir, 'index.html'))) {
		throw new Error(`Dashboard dist is incomplete: ${sourceDir}`);
	}

	emptyDirectory(outDir);
	copyDirectory(sourceDir, outDir);

	const exampleConfigPath = path.join(outDir, 'dashboard-config.example.js');
	fs.writeFileSync(exampleConfigPath, DASHBOARD_CONFIG_EXAMPLE, 'utf8');

	console.log('Published dashboard assets');
	console.log(`- source: ${path.relative(cwd, sourceDir) || sourceDir}`);
	console.log(`- output: ${path.relative(cwd, outDir) || outDir}`);
	console.log('Use this path in adapters:');
	console.log(`  uiDir: path.resolve(process.cwd(), '${path.relative(cwd, outDir).replace(/\\/g, '/')}')`);
	console.log('Runtime config template:');
	console.log(`  ${path.relative(cwd, exampleConfigPath)}`);
}

async function runWorkersList() {
	const cwd = process.cwd();
	const runtimeDir = resolveRuntimeDir(cwd);
	if (!runtimeDir) {
		console.log('No runtime directory found.');
		return;
	}

	const workersManifestPath = path.join(runtimeDir, 'workers.json');
	if (!fs.existsSync(workersManifestPath)) {
		console.log(`No workers manifest found at ${workersManifestPath}`);
		return;
	}

	const parsed = JSON.parse(fs.readFileSync(workersManifestPath, 'utf8')) as WorkerManifest;
	if (!parsed.workers?.length) {
		console.log('No workers configured.');
		return;
	}

	console.log('Configured workers:');
	for (const worker of parsed.workers) {
		console.log(
			`- ${worker.name}: queues=[${worker.queues.join(', ')}], concurrency=${worker.concurrency ?? 1}, isolation=${worker.isolation ?? 'inline'}, poolSize=${worker.poolSize ?? '-'}`
		);
	}
}

function resolveRuntimeDir(cwd: string): string | null {
	const candidates = [
		path.join(cwd, '.omni', 'runtime'),
		path.join(cwd, 'runtime'),
		path.join(cwd, 'src', 'runtime'),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
	}
	return null;
}
