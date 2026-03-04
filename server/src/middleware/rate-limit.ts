import type { ServerConfig } from '../config';

export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired entries within this key
    while (timestamps.length > 0 && (timestamps[0] ?? Infinity) < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /** Remove entries where all timestamps have expired */
  cleanup(): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let removed = 0;

    for (const [key, timestamps] of this.windows) {
      if (timestamps.length === 0 || timestamps.every((ts) => ts < cutoff)) {
        this.windows.delete(key);
        removed++;
      }
    }

    return removed;
  }

  reset(): void {
    this.windows.clear();
  }
}

export function createRateLimiters(config: ServerConfig['rateLimits']) {
  return {
    global: new RateLimiter(config.global, 60_000),
    perIp: new RateLimiter(config.perIp, 60_000),
    perWallet: new RateLimiter(config.perWallet, 60_000),
    settlePerWallet: new RateLimiter(config.settlePerWallet, 60_000),
  };
}
