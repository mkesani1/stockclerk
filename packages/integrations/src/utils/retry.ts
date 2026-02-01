/**
 * Retry Utility with Exponential Backoff and Jitter
 * Handles transient failures gracefully
 */

import pRetry, { AbortError } from 'p-retry';

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Number of retry attempts */
  retries: number;
  /** Minimum timeout between retries in milliseconds */
  minTimeout: number;
  /** Maximum timeout between retries in milliseconds */
  maxTimeout: number;
  /** Factor to multiply timeout by on each retry */
  factor?: number;
  /** Whether to randomize timeouts (add jitter) */
  randomize?: boolean;
  /** Callback on each retry attempt */
  onRetry?: (error: Error, attempt: number) => void;
  /** Custom function to determine if error should trigger retry */
  shouldRetry?: (error: Error) => boolean;
}

export interface RetryStats {
  attempts: number;
  totalTime: number;
  lastError?: Error;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  factor: 2,
  randomize: true,
};

// ============================================================================
// Retry Functions
// ============================================================================

/**
 * Execute a function with automatic retries using exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const mergedOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };

  return pRetry(fn, {
    retries: mergedOptions.retries,
    minTimeout: mergedOptions.minTimeout,
    maxTimeout: mergedOptions.maxTimeout,
    factor: mergedOptions.factor,
    randomize: mergedOptions.randomize,
    onFailedAttempt: (error) => {
      // Check if we should retry this error
      if (mergedOptions.shouldRetry && !mergedOptions.shouldRetry(error)) {
        throw new AbortError(error.message);
      }

      if (mergedOptions.onRetry) {
        mergedOptions.onRetry(error, error.attemptNumber);
      }
    },
  });
}

/**
 * Execute a function with retries and return stats
 */
export async function withRetryAndStats<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<{ result: T; stats: RetryStats }> {
  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | undefined;

  const result = await withRetry(
    async () => {
      attempts++;
      return fn();
    },
    {
      ...options,
      onRetry: (error, attempt) => {
        lastError = error;
        if (options.onRetry) {
          options.onRetry(error, attempt);
        }
      },
    }
  );

  return {
    result,
    stats: {
      attempts,
      totalTime: Date.now() - startTime,
      lastError,
    },
  };
}

// ============================================================================
// Jitter Functions
// ============================================================================

/**
 * Add jitter to a delay value
 * Full jitter: random value between 0 and delay
 */
export function addFullJitter(delay: number): number {
  return Math.random() * delay;
}

/**
 * Add equal jitter to a delay value
 * Equal jitter: delay/2 + random value between 0 and delay/2
 */
export function addEqualJitter(delay: number): number {
  return delay / 2 + Math.random() * (delay / 2);
}

/**
 * Add decorrelated jitter to a delay value
 * Decorrelated jitter: random value between minDelay and previousDelay * 3
 */
export function addDecorrelatedJitter(
  minDelay: number,
  previousDelay: number
): number {
  return Math.min(minDelay + Math.random() * (previousDelay * 3 - minDelay), 30000);
}

/**
 * Calculate exponential backoff delay with optional jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  options: {
    minTimeout: number;
    maxTimeout: number;
    factor?: number;
    jitter?: 'full' | 'equal' | 'none';
  }
): number {
  const { minTimeout, maxTimeout, factor = 2, jitter = 'full' } = options;

  // Calculate base exponential delay
  const exponentialDelay = minTimeout * Math.pow(factor, attempt - 1);

  // Cap at max timeout
  const cappedDelay = Math.min(exponentialDelay, maxTimeout);

  // Apply jitter
  switch (jitter) {
    case 'full':
      return addFullJitter(cappedDelay);
    case 'equal':
      return addEqualJitter(cappedDelay);
    case 'none':
    default:
      return cappedDelay;
  }
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Check if an error is retryable (transient)
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (error.message.includes('ECONNREFUSED') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('EAI_AGAIN')) {
    return true;
  }

  // HTTP status code based errors
  const statusCode = extractStatusCode(error);
  if (statusCode) {
    // Retry on server errors (5xx) and specific client errors
    if (statusCode >= 500 && statusCode < 600) return true;
    if (statusCode === 408) return true; // Request Timeout
    if (statusCode === 429) return true; // Too Many Requests
    if (statusCode === 503) return true; // Service Unavailable
    if (statusCode === 504) return true; // Gateway Timeout
  }

  // Abort errors should not be retried
  if (error instanceof AbortError || error.name === 'AbortError') {
    return false;
  }

  return false;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: Error): boolean {
  const statusCode = extractStatusCode(error);
  return statusCode === 429 || error.message.toLowerCase().includes('rate limit');
}

/**
 * Extract HTTP status code from error
 */
function extractStatusCode(error: Error & { response?: { status?: number }; statusCode?: number }): number | null {
  if ('response' in error && error.response?.status) {
    return error.response.status;
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  // Try to extract from message
  const match = error.message.match(/status[:\s]+(\d{3})/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

// ============================================================================
// Specialized Retry Strategies
// ============================================================================

/**
 * Retry strategy for API calls with rate limit handling
 */
export async function withApiRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  return withRetry(fn, {
    retries: options?.retries ?? 3,
    minTimeout: options?.minTimeout ?? 1000,
    maxTimeout: options?.maxTimeout ?? 30000,
    factor: 2,
    randomize: true,
    shouldRetry: (error) => {
      // Don't retry client errors (except rate limits)
      const statusCode = extractStatusCode(error as Error & { response?: { status?: number } });
      if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return false;
      }
      return isRetryableError(error);
    },
    onRetry: (error, attempt) => {
      if (isRateLimitError(error)) {
        console.warn(`Rate limit hit, retrying (attempt ${attempt})...`);
      } else {
        console.warn(`Request failed, retrying (attempt ${attempt}): ${error.message}`);
      }
      options?.onRetry?.(error, attempt);
    },
    ...options,
  });
}

/**
 * Retry strategy for webhook delivery
 */
export async function withWebhookRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  return withRetry(fn, {
    retries: options?.retries ?? 5,
    minTimeout: options?.minTimeout ?? 5000,
    maxTimeout: options?.maxTimeout ?? 60000,
    factor: 2,
    randomize: true,
    shouldRetry: isRetryableError,
    ...options,
  });
}

// ============================================================================
// Re-exports
// ============================================================================

export { AbortError };

/**
 * Create an abort error to stop retrying
 */
export function createAbortError(message: string): AbortError {
  return new AbortError(message);
}
