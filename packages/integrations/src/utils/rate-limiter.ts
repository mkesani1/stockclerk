/**
 * Rate Limiter Utility
 * Per-API rate limiting with configurable limits
 */

import PQueue from 'p-queue';

// ============================================================================
// Types
// ============================================================================

export interface RateLimiterOptions {
  /** Maximum concurrent requests */
  concurrency: number;
  /** Time interval in milliseconds */
  intervalMs: number;
  /** Maximum requests per interval */
  maxPerInterval: number;
  /** Whether to carry over remaining quota to next interval */
  carryoverConcurrencyCount?: boolean;
  /** Whether to auto-start processing */
  autoStart?: boolean;
}

export interface RateLimiterStats {
  pending: number;
  size: number;
  isPaused: boolean;
}

// ============================================================================
// Pre-configured Rate Limits by API
// ============================================================================

export const API_RATE_LIMITS = {
  eposnow: {
    concurrency: 5,
    intervalMs: 60000, // 1 minute
    maxPerInterval: 60, // 60 requests per minute
  },
  wix: {
    concurrency: 10,
    intervalMs: 60000, // 1 minute
    maxPerInterval: 100, // 100 requests per minute
  },
  otter: {
    concurrency: 5,
    intervalMs: 60000, // 1 minute
    maxPerInterval: 50, // 50 requests per minute
  },
} as const;

export type ApiProvider = keyof typeof API_RATE_LIMITS;

// ============================================================================
// Rate Limiter Class
// ============================================================================

export class RateLimiter {
  private readonly queue: PQueue;
  private readonly options: RateLimiterOptions;
  private requestCount = 0;
  private intervalStart = Date.now();

  constructor(options: RateLimiterOptions) {
    this.options = options;
    this.queue = new PQueue({
      concurrency: options.concurrency,
      interval: options.intervalMs,
      intervalCap: options.maxPerInterval,
      carryoverConcurrencyCount: options.carryoverConcurrencyCount ?? false,
      autoStart: options.autoStart ?? true,
    });

    // Reset counter at each interval
    setInterval(() => {
      this.requestCount = 0;
      this.intervalStart = Date.now();
    }, options.intervalMs);
  }

  /**
   * Add a task to the rate-limited queue
   */
  async add<T>(task: () => Promise<T>, priority?: number): Promise<T> {
    return this.queue.add(async () => {
      this.requestCount++;
      return task();
    }, { priority }) as Promise<T>;
  }

  /**
   * Add multiple tasks to the queue
   */
  async addAll<T>(
    tasks: Array<() => Promise<T>>,
    options?: { priority?: number }
  ): Promise<T[]> {
    return Promise.all(
      tasks.map((task) => this.add(task, options?.priority))
    );
  }

  /**
   * Pause the queue
   */
  pause(): void {
    this.queue.pause();
  }

  /**
   * Resume the queue
   */
  start(): void {
    this.queue.start();
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Wait for the queue to be empty
   */
  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  /**
   * Wait for the queue to be empty and for all tasks to be processed
   */
  async onEmpty(): Promise<void> {
    return this.queue.onEmpty();
  }

  /**
   * Get current statistics
   */
  getStats(): RateLimiterStats {
    return {
      pending: this.queue.pending,
      size: this.queue.size,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Get remaining requests in current interval
   */
  getRemainingRequests(): number {
    return Math.max(0, this.options.maxPerInterval - this.requestCount);
  }

  /**
   * Get time until rate limit resets
   */
  getTimeUntilReset(): number {
    const elapsed = Date.now() - this.intervalStart;
    return Math.max(0, this.options.intervalMs - elapsed);
  }

  /**
   * Check if rate limit is currently exceeded
   */
  isRateLimited(): boolean {
    return this.requestCount >= this.options.maxPerInterval;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a rate limiter with custom options
 */
export function createRateLimiter(options: RateLimiterOptions): PQueue {
  return new PQueue({
    concurrency: options.concurrency,
    interval: options.intervalMs,
    intervalCap: options.maxPerInterval,
    carryoverConcurrencyCount: options.carryoverConcurrencyCount ?? false,
    autoStart: options.autoStart ?? true,
  });
}

/**
 * Create a rate limiter for a specific API provider
 */
export function createApiRateLimiter(provider: ApiProvider): RateLimiter {
  const limits = API_RATE_LIMITS[provider];
  return new RateLimiter(limits);
}

/**
 * Create rate limiters for all API providers
 */
export function createAllRateLimiters(): Record<ApiProvider, RateLimiter> {
  return {
    eposnow: createApiRateLimiter('eposnow'),
    wix: createApiRateLimiter('wix'),
    otter: createApiRateLimiter('otter'),
  };
}

// ============================================================================
// Rate Limit Error
// ============================================================================

export class RateLimitExceededError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs: number
  ) {
    super(`Rate limit exceeded for ${provider}. Retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitExceededError';
  }
}
