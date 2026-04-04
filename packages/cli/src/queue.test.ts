import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runQueue } from './queue';

const originalCwd = process.cwd();

afterEach(() => {
	process.chdir(originalCwd);
	process.exitCode = undefined;
});

describe('@vasto/cli queue commands', () => {
	it('initializes project structure with queue scripts', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-init-'));
		const projectDir = path.join(tempDir, 'app');
		fs.mkdirSync(projectDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectDir, 'package.json'),
			JSON.stringify({ name: 'app', private: true, scripts: {} }, null, 2),
			'utf8'
		);

		process.chdir(projectDir);
		await runQueue(['init', '--yes']);

		expect(fs.existsSync(path.join(projectDir, '.vasto', 'runtime'))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, 'src', 'jobs', 'sample-job.ts'))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, 'src', 'definitions', 'main.ts'))).toBe(true);

		const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(pkg.scripts?.['vasto:dev']).toBe('vasto dev');
		expect(pkg.scripts?.['vasto:generate:isolation']).toBe('vasto generate isolation');
		expect(pkg.scripts?.['vasto:generate:job']).toContain('vasto generate job');
	});

	it('generates a typed job file from command flags', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-generate-job-'));
		process.chdir(tempDir);

		await runQueue(['generate', 'job', '--name=send-email', '-=emails']);

		const filePath = path.join(tempDir, 'src', 'jobs', 'send-email.job.ts');
		expect(fs.existsSync(filePath)).toBe(true);

		const content = fs.readFileSync(filePath, 'utf8');
		expect(content).toContain('export class SendEmailJob');
		expect(content).toContain("readonly name = 'send-email'");
		expect(content).toContain("readonly queue = 'default'");
	});

	it('generates an API job starter template', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-generate-api-job-'));
		process.chdir(tempDir);

		await runQueue(['generate', 'api-job', '--name=send-email', '-=api-events']);

		const filePath = path.join(tempDir, 'src', 'jobs', 'send-email.api-job.ts');
		expect(fs.existsSync(filePath)).toBe(true);

		const content = fs.readFileSync(filePath, 'utf8');
		expect(content).toContain('export class SendEmailApiJob');
		expect(content).toContain("static jobName = 'send-email'");
		expect(content).toContain("return 'api-jobs';");
		expect(content).toContain('requestId: string;');
	});

	it('generates a workflow starter template', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-generate-workflow-'));
		process.chdir(tempDir);

		await runQueue(['generate', 'workflow', '--name=asset-pipeline', '-=media']);

		const filePath = path.join(tempDir, 'src', 'workflows', 'asset-pipeline.workflow.ts');
		expect(fs.existsSync(filePath)).toBe(true);

		const content = fs.readFileSync(filePath, 'utf8');
		expect(content).toContain('export class AssetPipelinePrepareJob');
		expect(content).toContain('export class AssetPipelineFinalizeJob');
		expect(content).toContain('dispatchAssetPipelineWorkflow');
		expect(content).toContain("return 'default';");
		expect(content).toContain('supervisor.dispatchFlow(nodes');
	});

	it('generates a scheduled job starter template', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-generate-scheduled-'));
		process.chdir(tempDir);

		await runQueue(['generate', 'scheduled', '--name=daily-digest', '-=cron']);

		const filePath = path.join(tempDir, 'src', 'jobs', 'daily-digest.scheduled.ts');
		expect(fs.existsSync(filePath)).toBe(true);

		const content = fs.readFileSync(filePath, 'utf8');
		expect(content).toContain('export class DailyDigestScheduledJob');
		expect(content).toContain('scheduleDailyDigest');
		expect(content).toContain("return 'default';");
		expect(content).toContain("pattern: '0 * * * *'");
	});
});
