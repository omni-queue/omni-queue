import type { Plugin, QueueConfig, StoredJob } from '@vasto/core';
import { TokenBucket } from './token-bucket';

export function RateLimiterPlugin(queueConfigs: Record<string, QueueConfig>): Plugin {
    const limiters = new Map<string, TokenBucket>();

    for (const [name, cfg] of Object.entries(queueConfigs)) {
        if (cfg.rateLimit) {
            limiters.set(
                name,
                new TokenBucket(cfg.rateLimit.capacity, cfg.rateLimit.refillRate)
            );
        }
    }

    return {
        name: 'RateLimiterPlugin',
        async onProcessStart(job: StoredJob) {
            const limiter = limiters.get(job.queue);

            if (limiter && !limiter.consume()) {
                throw new Error('Rate limit exceeded, requeue job');
            }
        },
    };
}