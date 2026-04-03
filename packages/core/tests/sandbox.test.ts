import { describe, expect, it } from 'vitest';
import {
  buildSandboxedChildEnv,
  isHostAllowed,
  normalizeSandboxPolicy,
  parseSandboxPolicy,
  pruneEnvironment,
  SANDBOX_POLICY_ENV,
  sandboxPolicySignature,
} from '../src/libs/sandbox';

describe('normalizeSandboxPolicy', () => {
  it('returns undefined when policy is disabled', () => {
    expect(normalizeSandboxPolicy(undefined)).toBeUndefined();
    expect(normalizeSandboxPolicy({ enabled: false })).toBeUndefined();
  });

  it('returns normalized policy when enabled', () => {
    const result = normalizeSandboxPolicy({ enabled: true });
    expect(result).toEqual({ enabled: true });
  });

  it('deduplicates and sorts envAllowlist', () => {
    const result = normalizeSandboxPolicy({
      enabled: true,
      envAllowlist: ['Z_VAR', 'A_VAR', 'A_VAR'],
    });
    expect(result?.envAllowlist).toEqual(['A_VAR', 'Z_VAR']);
  });

  it('deduplicates and sorts networkAllowlist (lowercased)', () => {
    const result = normalizeSandboxPolicy({
      enabled: true,
      networkAllowlist: ['Api.Example.Com', 'api.example.com', 'other.io'],
    });
    expect(result?.networkAllowlist).toEqual(['api.example.com', 'other.io']);
  });

  it('passes through boolean flags', () => {
    const result = normalizeSandboxPolicy({
      enabled: true,
      denyNetwork: true,
      denyChildProcessSpawn: true,
      readOnlyFilesystem: true,
    });
    expect(result?.denyNetwork).toBe(true);
    expect(result?.denyChildProcessSpawn).toBe(true);
    expect(result?.readOnlyFilesystem).toBe(true);
  });
});

describe('sandboxPolicySignature', () => {
  it('returns "none" for disabled/missing policy', () => {
    expect(sandboxPolicySignature(undefined)).toBe('none');
    expect(sandboxPolicySignature({ enabled: false })).toBe('none');
  });

  it('returns a JSON string for enabled policy', () => {
    const sig = sandboxPolicySignature({ enabled: true, denyNetwork: true });
    expect(sig).not.toBe('none');
    const parsed = JSON.parse(sig) as { enabled: boolean; denyNetwork: boolean };
    expect(parsed.enabled).toBe(true);
    expect(parsed.denyNetwork).toBe(true);
  });

  it('produces the same signature for equivalent policies', () => {
    const a = sandboxPolicySignature({ enabled: true, envAllowlist: ['B', 'A'] });
    const b = sandboxPolicySignature({ enabled: true, envAllowlist: ['A', 'B'] });
    expect(a).toBe(b);
  });
});

describe('buildSandboxedChildEnv', () => {
  it('returns full env copy when policy is disabled', () => {
    const base: NodeJS.ProcessEnv = { NODE_ENV: 'test', HOME: '/home/user', SECRET: 'abc' };
    const result = buildSandboxedChildEnv(base, undefined);
    expect(result).toEqual(base);
  });

  it('prunes env to allowlist + essential keys when policy has envAllowlist', () => {
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      HOME: '/home/user',
      SECRET: 'abc',
      MY_VAR: 'keep',
      PATH: '/usr/bin',
    };
    const result = buildSandboxedChildEnv(base, {
      enabled: true,
      envAllowlist: ['MY_VAR'],
    });
    // MY_VAR and essential keys (HOME, PATH, …) should survive
    expect(result['MY_VAR']).toBe('keep');
    expect(result['PATH']).toBe('/usr/bin');
    expect(result['SECRET']).toBeUndefined();
  });

  it('injects SANDBOX_POLICY_ENV into the child env', () => {
    const result = buildSandboxedChildEnv({ NODE_ENV: 'test' }, { enabled: true, denyNetwork: true });
    expect(result[SANDBOX_POLICY_ENV]).toBeDefined();
    const policy = JSON.parse(result[SANDBOX_POLICY_ENV]!) as { denyNetwork: boolean };
    expect(policy.denyNetwork).toBe(true);
  });
});

describe('parseSandboxPolicy', () => {
  it('returns undefined for falsy input', () => {
    expect(parseSandboxPolicy(undefined)).toBeUndefined();
    expect(parseSandboxPolicy('')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseSandboxPolicy('{bad json')).toBeUndefined();
  });

  it('round-trips through buildSandboxedChildEnv', () => {
    const base: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    const env = buildSandboxedChildEnv(base, { enabled: true, denyNetwork: true });
    const parsed = parseSandboxPolicy(env[SANDBOX_POLICY_ENV]);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.denyNetwork).toBe(true);
  });
});

describe('pruneEnvironment', () => {
  it('keeps only allowed keys plus essential builtins', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: '/usr/bin',
      HOME: '/root',
      SECRET: 'x',
      ALLOWED: 'y',
    };
    const result = pruneEnvironment(env, ['ALLOWED']);
    expect('ALLOWED' in result).toBe(true);
    expect('PATH' in result).toBe(true);
    expect('HOME' in result).toBe(true);
    expect('SECRET' in result).toBe(false);
  });

  it('excludes undefined values', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', FOO: undefined, BAR: 'baz' };
    const result = pruneEnvironment(env, ['FOO', 'BAR']);
    expect('FOO' in result).toBe(false);
    expect(result['BAR']).toBe('baz');
  });
});

describe('isHostAllowed', () => {
  it('allows all hosts when allowlist is empty', () => {
    expect(isHostAllowed('api.example.com', [])).toBe(true);
    expect(isHostAllowed('api.example.com', undefined)).toBe(true);
  });

  it('blocks hosts not in allowlist', () => {
    expect(isHostAllowed('evil.io', ['api.example.com'])).toBe(false);
  });

  it('allows exact match', () => {
    expect(isHostAllowed('api.example.com', ['api.example.com'])).toBe(true);
  });

  it('strips port before matching', () => {
    expect(isHostAllowed('api.example.com:443', ['api.example.com'])).toBe(true);
  });

  it('returns false for empty host string', () => {
    expect(isHostAllowed('', ['api.example.com'])).toBe(false);
  });
});
