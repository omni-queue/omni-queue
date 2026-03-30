export class TokenBucket {
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

  consume(tokens = 1): boolean {
    this.refill();

    if (tokens > this.tokens) {
      return false;
    }

    this.tokens -= tokens;
    return true;
  }

  availableTokens(): number {
    this.refill();
    return this.tokens;
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
