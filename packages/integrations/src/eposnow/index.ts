/**
 * EposNow Integration
 * Point of Sale system integration for stock synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  EposnowApiClient,
  EposnowApiError,
  EposnowNotFoundError,
  EposnowAuthError,
  EposnowRateLimitError,
  EposnowServerError,
} from './client.js';

// Export webhook handler
export {
  EposnowWebhookHandler,
  EposnowWebhookError,
  createEposnowWebhookHandler,
  type StockChangeEvent,
  type WebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { EposnowClientConfig } from './types.js';

// Factory function for creating client
import { EposnowApiClient } from './client.js';
import type { EposnowClientConfig } from './types.js';

export function createEposnowClient(config: EposnowClientConfig): EposnowApiClient {
  return new EposnowApiClient(config);
}
