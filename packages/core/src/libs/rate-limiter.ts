import { QueueConfig } from '../interfaces/queue-config';

class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number,
    private readonly now: () => number = Date.now
  ) {
    this.tokens = capacity;
    this.lastRefillAt = this.now();
  }

  availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  consume(tokens = 1): boolean {
    this.refill();

    if (tokens > this.tokens) {
      return false;
    }

    this.tokens -= tokens;
    return true;
  }

  private refill(): void {
    const currentTime = this.now();
    const elapsedMs = currentTime - this.lastRefillAt;

    if (elapsedMs <= 0) {
      return;
    }

    const replenished = (elapsedMs / 1000) * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + replenished);
    this.lastRefillAt = currentTime;
  }
}

export class RateLimitCoordinator {
  private queueLimiters = new Map<string, TokenBucket>();
  private consumerLimiters = new Map<string, TokenBucket>();

  canConsume(queueName: string, consumerId: string, config: QueueConfig): boolean {
    const { rateLimit } = config;
    if (!rateLimit) {
      return true;
    }

    const queueLimiter = this.getQueueLimiter(queueName, config);
    const consumerLimiter = this.getConsumerLimiter(queueName, consumerId, config);

    if (queueLimiter && queueLimiter.availableTokens() < 1) {
      return false;
    }

    if (consumerLimiter && consumerLimiter.availableTokens() < 1) {
      return false;
    }

    if (queueLimiter && !queueLimiter.consume()) {
      return false;
    }

    if (consumerLimiter && !consumerLimiter.consume()) {
      return false;
    }

    return true;
  }

  private getQueueLimiter(queueName: string, config: QueueConfig): TokenBucket | undefined {
    const { rateLimit } = config;
    if (!rateLimit) {
      return undefined;
    }

    const key = queueName;
    let limiter = this.queueLimiters.get(key);
    if (!limiter) {
      limiter = new TokenBucket(Math.max(1, rateLimit.capacity), Math.max(0, rateLimit.refillRate));
      this.queueLimiters.set(key, limiter);
    }

    return limiter;
  }

  private getConsumerLimiter(
    queueName: string,
    consumerId: string,
    config: QueueConfig
  ): TokenBucket | undefined {
    const consumerRateLimit = config.rateLimit?.perConsumer;
    if (!consumerRateLimit) {
      return undefined;
    }

    const key = `${queueName}::${consumerId}`;
    let limiter = this.consumerLimiters.get(key);
    if (!limiter) {
      limiter = new TokenBucket(
        Math.max(1, consumerRateLimit.capacity),
        Math.max(0, consumerRateLimit.refillRate)
      );
      this.consumerLimiters.set(key, limiter);
    }

    return limiter;
  }
}
