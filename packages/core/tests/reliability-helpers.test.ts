import { describe, expect, it } from 'vitest';
import {
  createBackpressureStrategy,
  createCircuitBreakerStrategy,
  createIdempotencyPolicy,
  createPoisonMessagePolicy,
  createReliabilityProfile,
} from '../src/libs/reliability';

describe('reliability helpers', () => {
  it('builds idempotency policies from presets', () => {
    expect(createIdempotencyPolicy('strict')).toEqual({
      dedupeWindowMs: 24 * 60 * 60_000,
      includeFailed: true,
    });

    expect(createIdempotencyPolicy('throughput', { includeFailed: true })).toEqual({
      dedupeWindowMs: 5 * 60_000,
      includeFailed: true,
    });
  });

  it('builds backpressure and circuit-breaker strategies', () => {
    expect(createBackpressureStrategy()).toMatchObject({
      depthThreshold: 500,
      resumeThreshold: 250,
      checkIntervalMs: 1000,
      mode: 'delay',
    });

    expect(createCircuitBreakerStrategy({ failureThreshold: 4 })).toMatchObject({
      failureThreshold: 4,
      cooldownMs: 30_000,
      halfOpenMaxInFlight: 1,
      tripOnTimeout: true,
    });
  });

  it('builds poison-message policy templates', () => {
    expect(createPoisonMessagePolicy('quarantine')).toEqual({
      template: 'quarantine',
      maxFailures: 5,
    });

    expect(createPoisonMessagePolicy('auto-snooze')).toEqual({
      template: 'auto-snooze',
      maxFailures: 3,
      snoozeMs: 5 * 60_000,
    });
  });

  it('creates an integrated reliability profile', () => {
    const profile = createReliabilityProfile({
      exactlyOnce: 'balanced',
      backpressure: { depthThreshold: 1200 },
      poisonPolicy: { template: 'escalation', overrides: { escalationTag: 'ops:p1' } },
    });

    expect(profile.idempotency).toEqual({
      dedupeWindowMs: 60 * 60_000,
      includeFailed: false,
    });

    expect(profile.reliability.backpressure).toMatchObject({
      depthThreshold: 1200,
      resumeThreshold: 250,
    });

    expect(profile.reliability.circuitBreaker).toMatchObject({
      failureThreshold: 10,
      cooldownMs: 30_000,
    });

    expect(profile.reliability.poisonPolicy).toEqual({
      template: 'escalation',
      maxFailures: 1,
      escalationTag: 'ops:p1',
    });
  });
});
