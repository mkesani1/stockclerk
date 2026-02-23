/**
 * Uber Eats Integration
 * Food delivery platform integration for menu and stock synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  UberEatsApiClient,
  UberEatsApiError,
  UberEatsNotFoundError,
  UberEatsAuthError,
  UberEatsRateLimitError,
  UberEatsServerError,
  createUberEatsClient,
} from './client.js';

// Export webhook handler
export {
  UberEatsWebhookHandler,
  UberEatsWebhookError,
  createUberEatsWebhookHandler,
  type UberEatsStockChangeEvent,
  type UberEatsWebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { UberEatsClientConfig } from './types.js';
