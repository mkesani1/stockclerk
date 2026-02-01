/**
 * Otter Integration (Deliveroo)
 * Restaurant delivery platform integration for menu and stock synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  OtterApiClient,
  OtterApiError,
  OtterNotFoundError,
  OtterAuthError,
  OtterRateLimitError,
  OtterServerError,
} from './client.js';

// Export webhook handler
export {
  OtterWebhookHandler,
  OtterWebhookError,
  createOtterWebhookHandler,
  type OtterStockChangeEvent,
  type OtterWebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { OtterClientConfig } from './types.js';

// Factory function for creating client
import { OtterApiClient } from './client.js';
import type { OtterClientConfig } from './types.js';

export function createOtterClient(config: OtterClientConfig): OtterApiClient {
  return new OtterApiClient(config);
}
