import { describe, expect, it } from 'vitest';
import {
  buildSandboxedChildEnv,
  isHostAllowed,
  parseSandboxPolicy,
  SANDBOX_POLICY_ENV,
  sandboxPolicySignature,
} from '../src/libs/sandbox';

describe('sandbox policy helpers', () => {
  it('creates a deterministic policy signature', () => {
    const signatureA = sandboxPolicySignature({
      enabled: true,
      envAllowlist: ['API_KEY', 'NODE_ENV'],
      networkAllowlist: ['api.example.com'],
    });

    const signatureB = sandboxPolicySignature({
      enabled: true,
      networkAllowlist: ['api.example.com'],
      envAllowlist: ['NODE_ENV', 'API_KEY'],
    });

    expect(signatureA).toBe(signatureB);
  });

  it('builds child environment with allowlist and sandbox payload', () => {
    const env = buildSandboxedChildEnv(
      {
        API_KEY: 'secret',
        NODE_ENV: 'test',
        INTERNAL_TOKEN: 'deny-me',
      },
      {
        enabled: true,
        envAllowlist: ['API_KEY', 'NODE_ENV'],
      }
    );

    expect(env.API_KEY).toBe('secret');
    expect(env.NODE_ENV).toBe('test');
    expect(env.INTERNAL_TOKEN).toBeUndefined();
    expect(env[SANDBOX_POLICY_ENV]).toBeDefined();
  });

  it('parses sandbox policy from environment payload', () => {
    const rawPolicy = JSON.stringify({
      enabled: true,
      denyNetwork: true,
      networkAllowlist: ['internal.example.com'],
    });

    const parsed = parseSandboxPolicy(rawPolicy);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.denyNetwork).toBe(true);
    expect(parsed?.networkAllowlist).toEqual(['internal.example.com']);
  });

  it('supports exact and wildcard host allowlist matching', () => {
    const allowlist = ['api.example.com', '*.svc.internal'];

    expect(isHostAllowed('api.example.com', allowlist)).toBe(true);
    expect(isHostAllowed('worker.svc.internal', allowlist)).toBe(true);
    expect(isHostAllowed('public.example.net', allowlist)).toBe(false);
  });
});
