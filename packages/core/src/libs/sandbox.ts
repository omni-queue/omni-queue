import { createRequire } from 'node:module';
import path from 'node:path';
import { QueueSandboxConfig } from '../interfaces/queue-config';

const requireBuiltin = createRequire(path.join(process.cwd(), 'package.json'));

export const SANDBOX_POLICY_ENV = 'VASTO_SANDBOX_POLICY';

const ESSENTIAL_ENV_KEYS = new Set(['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS', 'TZ']);

export class SandboxViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolationError';
  }
}

let processSandboxApplied = false;

export function normalizeSandboxPolicy(policy?: QueueSandboxConfig): QueueSandboxConfig | undefined {
  if (!policy?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    ...(policy.envAllowlist ? { envAllowlist: uniqueSorted(policy.envAllowlist) } : {}),
    ...(policy.cwdAllowlist ? { cwdAllowlist: uniqueSorted(policy.cwdAllowlist.map((entry) => path.resolve(entry))) } : {}),
    ...(policy.networkAllowlist ? { networkAllowlist: uniqueSorted(policy.networkAllowlist.map((entry) => entry.trim().toLowerCase())) } : {}),
    ...(policy.denyNetwork !== undefined ? { denyNetwork: policy.denyNetwork } : {}),
    ...(policy.denyChildProcessSpawn !== undefined
      ? { denyChildProcessSpawn: policy.denyChildProcessSpawn }
      : {}),
    ...(policy.readOnlyFilesystem !== undefined ? { readOnlyFilesystem: policy.readOnlyFilesystem } : {}),
  };
}

export function sandboxPolicySignature(policy?: QueueSandboxConfig): string {
  const normalized = normalizeSandboxPolicy(policy);
  return normalized ? JSON.stringify(normalized) : 'none';
}

export function buildSandboxedChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  policy?: QueueSandboxConfig
): NodeJS.ProcessEnv {
  const normalized = normalizeSandboxPolicy(policy);
  if (!normalized) {
    return { ...baseEnv };
  }

  const env = normalized.envAllowlist
    ? pruneEnvironment(baseEnv, normalized.envAllowlist)
    : { ...baseEnv };

  env[SANDBOX_POLICY_ENV] = JSON.stringify(normalized);
  return env;
}

export function parseSandboxPolicy(rawPolicy?: string): QueueSandboxConfig | undefined {
  if (!rawPolicy) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawPolicy) as QueueSandboxConfig;
    return normalizeSandboxPolicy(parsed);
  } catch {
    return undefined;
  }
}

export function pruneEnvironment(
  env: NodeJS.ProcessEnv,
  allowlist: string[]
): NodeJS.ProcessEnv {
  const allowed = new Set([...allowlist, ...ESSENTIAL_ENV_KEYS]);
  const pruned: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(key) && value !== undefined) {
      pruned[key] = value;
    }
  }

  return pruned as NodeJS.ProcessEnv;
}

export function isHostAllowed(host: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }

  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return false;
  }

  return allowlist.some((entry) => matchesHost(normalizedHost, entry));
}

export function applyProcessSandbox(policy?: QueueSandboxConfig): void {
  if (processSandboxApplied) {
    return;
  }

  const normalized = normalizeSandboxPolicy(policy);
  if (!normalized) {
    return;
  }

  enforceCwdAllowlist(normalized);

  if (normalized.envAllowlist) {
    const pruned = pruneEnvironment(process.env, normalized.envAllowlist);
    for (const key of Object.keys(process.env)) {
      if (!(key in pruned)) {
        delete process.env[key];
      }
    }

    for (const [key, value] of Object.entries(pruned)) {
      process.env[key] = value;
    }
  }

  if (normalized.denyChildProcessSpawn) {
    patchChildProcess();
  }

  if (normalized.readOnlyFilesystem) {
    patchFileSystemWrites();
  }

  if (normalized.denyNetwork || (normalized.networkAllowlist && normalized.networkAllowlist.length > 0)) {
    patchNetwork(normalized);
  }

  processSandboxApplied = true;
}

function uniqueSorted(entries: string[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.trim()).filter(Boolean))).sort();
}

function enforceCwdAllowlist(policy: QueueSandboxConfig): void {
  const allowlist = policy.cwdAllowlist;
  if (!allowlist || allowlist.length === 0) {
    return;
  }

  const cwd = path.resolve(process.cwd());
  const allowed = allowlist.some((entry) => cwd === entry || cwd.startsWith(`${entry}${path.sep}`));

  if (!allowed) {
    throw new SandboxViolationError(`Sandbox denied current working directory: ${cwd}`);
  }
}

function patchChildProcess(): void {
  const deny = () => {
    throw new SandboxViolationError('Sandbox denied child process spawn');
  };

  const childProcessMutable = requireBuiltin('node:child_process') as Record<string, unknown>;

  childProcessMutable.spawn = deny;
  childProcessMutable.exec = deny;
  childProcessMutable.execFile = deny;
  childProcessMutable.fork = deny;
  childProcessMutable.spawnSync = deny;
  childProcessMutable.execSync = deny;
  childProcessMutable.execFileSync = deny;
}

function patchFileSystemWrites(): void {
  const deny = () => {
    throw new SandboxViolationError('Sandbox denied filesystem write operation');
  };

  const fsMutable = requireBuiltin('node:fs') as Record<string, unknown> & {
    promises?: Record<string, unknown>;
  };

  fsMutable.writeFile = deny;
  fsMutable.writeFileSync = deny;
  fsMutable.appendFile = deny;
  fsMutable.appendFileSync = deny;
  fsMutable.createWriteStream = deny;
  fsMutable.rename = deny;
  fsMutable.renameSync = deny;
  fsMutable.unlink = deny;
  fsMutable.unlinkSync = deny;
  fsMutable.rm = deny;
  fsMutable.rmSync = deny;
  fsMutable.mkdir = deny;
  fsMutable.mkdirSync = deny;
  fsMutable.rmdir = deny;
  fsMutable.rmdirSync = deny;

  const promiseMutable = fsMutable.promises;
  if (promiseMutable) {
    promiseMutable.writeFile = deny;
    promiseMutable.appendFile = deny;
    promiseMutable.rename = deny;
    promiseMutable.unlink = deny;
    promiseMutable.rm = deny;
    promiseMutable.mkdir = deny;
    promiseMutable.rmdir = deny;
  }
}

function patchNetwork(policy: QueueSandboxConfig): void {
  const netMutable = requireBuiltin('node:net') as Record<string, unknown> & {
    createConnection: (...args: unknown[]) => unknown;
    connect: (...args: unknown[]) => unknown;
  };
  const httpMutable = requireBuiltin('node:http') as Record<string, unknown> & {
    request: (...args: unknown[]) => unknown;
  };
  const httpsMutable = requireBuiltin('node:https') as Record<string, unknown> & {
    request: (...args: unknown[]) => unknown;
  };

  const originalCreateConnection = netMutable.createConnection.bind(netMutable);
  const originalConnect = netMutable.connect.bind(netMutable);
  const originalHttpRequest = httpMutable.request.bind(httpMutable);
  const originalHttpsRequest = httpsMutable.request.bind(httpsMutable);

  const assertAllowed = (rawHost?: string) => {
    if (!rawHost) {
      if (policy.denyNetwork) {
        throw new SandboxViolationError('Sandbox denied network access');
      }
      return;
    }

    if (policy.denyNetwork) {
      throw new SandboxViolationError(`Sandbox denied network host: ${rawHost}`);
    }

    if (!isHostAllowed(rawHost, policy.networkAllowlist)) {
      throw new SandboxViolationError(`Sandbox denied network host: ${rawHost}`);
    }
  };

  netMutable.createConnection = (...args: unknown[]) => {
    assertAllowed(extractNetHost(args));
    return originalCreateConnection(...args);
  };

  netMutable.connect = (...args: unknown[]) => {
    assertAllowed(extractNetHost(args));
    return originalConnect(...args);
  };

  httpMutable.request = (...args: unknown[]) => {
    assertAllowed(extractHttpHost(args));
    return originalHttpRequest(...args);
  };

  httpsMutable.request = (...args: unknown[]) => {
    assertAllowed(extractHttpHost(args));
    return originalHttpsRequest(...args);
  };

  httpMutable.get = (...args: unknown[]) => {
    const req = httpMutable.request(...args) as { end: () => void };
    req.end();
    return req;
  };

  httpsMutable.get = (...args: unknown[]) => {
    const req = httpsMutable.request(...args) as { end: () => void };
    req.end();
    return req;
  };
}

function extractNetHost(args: unknown[]): string | undefined {
  const first = args[0];

  if (typeof first === 'object' && first !== null) {
    const host = (first as { host?: string; hostname?: string }).host;
    const hostname = (first as { host?: string; hostname?: string }).hostname;
    return host ?? hostname;
  }

  if (typeof first === 'string') {
    return first;
  }

  const second = args[1];
  if (typeof second === 'string') {
    return second;
  }

  return undefined;
}

function extractHttpHost(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'string') {
    try {
      const parsed = new URL(first);
      return parsed.hostname;
    } catch {
      return undefined;
    }
  }

  if (first && typeof first === 'object') {
    const host = (first as { host?: string; hostname?: string }).host;
    const hostname = (first as { host?: string; hostname?: string }).hostname;
    return host ?? hostname;
  }

  const second = args[1];
  if (second && typeof second === 'object') {
    const host = (second as { host?: string; hostname?: string }).host;
    const hostname = (second as { host?: string; hostname?: string }).hostname;
    return host ?? hostname;
  }

  return undefined;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

function matchesHost(host: string, rule: string): boolean {
  const normalizedRule = normalizeHost(rule);
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1);
    return host.endsWith(suffix);
  }

  return host === normalizedRule;
}
