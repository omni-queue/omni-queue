import type {
  QueueBackpressureConfig,
  QueueCircuitBreakerConfig,
  QueueConfig,
  QueuePoisonMessagePolicy,
  QueueReliabilityConfig,
} from '../interfaces/queue-config';

export type ExactlyOncePreset = 'strict' | 'balanced' | 'throughput';
export type PoisonPolicyTemplate = 'quarantine' | 'auto-snooze' | 'escalation';

const EXACTLY_ONCE_PRESETS: Record<ExactlyOncePreset, Required<NonNullable<QueueConfig['idempotency']>>> = {
  strict: {
    dedupeWindowMs: 24 * 60 * 60_000,
    includeFailed: true,
  },
  balanced: {
    dedupeWindowMs: 60 * 60_000,
    includeFailed: false,
  },
  throughput: {
    dedupeWindowMs: 5 * 60_000,
    includeFailed: false,
  },
};

const DEFAULT_BACKPRESSURE: QueueBackpressureConfig = {
  depthThreshold: 500,
  resumeThreshold: 250,
  checkIntervalMs: 1000,
  mode: 'delay',
};

const DEFAULT_CIRCUIT_BREAKER: QueueCircuitBreakerConfig = {
  failureThreshold: 10,
  cooldownMs: 30_000,
  halfOpenMaxInFlight: 1,
  tripOnTimeout: true,
};

const POISON_POLICY_TEMPLATES: Record<PoisonPolicyTemplate, QueuePoisonMessagePolicy> = {
  quarantine: {
    template: 'quarantine',
    maxFailures: 5,
  },
  'auto-snooze': {
    template: 'auto-snooze',
    maxFailures: 3,
    snoozeMs: 5 * 60_000,
  },
  escalation: {
    template: 'escalation',
    maxFailures: 1,
    escalationTag: 'severity:high',
  },
};

export function createIdempotencyPolicy(
  preset: ExactlyOncePreset = 'balanced',
  overrides: Partial<NonNullable<QueueConfig['idempotency']>> = {}
): Required<NonNullable<QueueConfig['idempotency']>> {
  const base = EXACTLY_ONCE_PRESETS[preset];
  return {
    ...base,
    ...overrides,
  };
}

export function createBackpressureStrategy(
  overrides: Partial<QueueBackpressureConfig> = {}
): QueueBackpressureConfig {
  return {
    ...DEFAULT_BACKPRESSURE,
    ...overrides,
  };
}

export function createCircuitBreakerStrategy(
  overrides: Partial<QueueCircuitBreakerConfig> = {}
): QueueCircuitBreakerConfig {
  return {
    ...DEFAULT_CIRCUIT_BREAKER,
    ...overrides,
  };
}

export function createPoisonMessagePolicy(
  template: PoisonPolicyTemplate,
  overrides: Partial<QueuePoisonMessagePolicy> = {}
): QueuePoisonMessagePolicy {
  return {
    ...POISON_POLICY_TEMPLATES[template],
    ...overrides,
  };
}

export function createReliabilityProfile(options: {
  exactlyOnce?: ExactlyOncePreset;
  idempotency?: Partial<NonNullable<QueueConfig['idempotency']>>;
  backpressure?: Partial<QueueBackpressureConfig>;
  circuitBreaker?: Partial<QueueCircuitBreakerConfig>;
  poisonPolicy?:
    | PoisonPolicyTemplate
    | {
        template: PoisonPolicyTemplate;
        overrides?: Partial<QueuePoisonMessagePolicy>;
      };
} = {}): {
  idempotency: Required<NonNullable<QueueConfig['idempotency']>>;
  reliability: QueueReliabilityConfig;
} {
  const poisonPolicyInput = options.poisonPolicy;

  const poisonPolicy =
    poisonPolicyInput == null
      ? undefined
      : typeof poisonPolicyInput === 'string'
        ? createPoisonMessagePolicy(poisonPolicyInput)
        : createPoisonMessagePolicy(poisonPolicyInput.template, poisonPolicyInput.overrides);

  return {
    idempotency: createIdempotencyPolicy(options.exactlyOnce ?? 'balanced', options.idempotency),
    reliability: {
      backpressure: createBackpressureStrategy(options.backpressure),
      circuitBreaker: createCircuitBreakerStrategy(options.circuitBreaker),
      ...(poisonPolicy ? { poisonPolicy } : {}),
    },
  };
}
