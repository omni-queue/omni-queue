import { describe, expect, it } from 'vitest';
import { resolveSupervisorMode } from '../src/libs/supervisor-mode';

describe('supervisor mode helpers', () => {
  it('defaults to hybrid when no mode is provided', () => {
    expect(resolveSupervisorMode(undefined)).toBe('hybrid');
    expect(resolveSupervisorMode('')).toBe('hybrid');
    expect(resolveSupervisorMode('unknown')).toBe('hybrid');
  });

  it('accepts supported modes and normalizes all to hybrid', () => {
    expect(resolveSupervisorMode('api')).toBe('api');
    expect(resolveSupervisorMode('worker')).toBe('worker');
    expect(resolveSupervisorMode('hybrid')).toBe('hybrid');
    expect(resolveSupervisorMode('all')).toBe('hybrid');
    expect(resolveSupervisorMode('  HYBRID  ')).toBe('hybrid');
  });

  it('supports overriding the default mode', () => {
    expect(resolveSupervisorMode(undefined, 'api')).toBe('api');
  });
});