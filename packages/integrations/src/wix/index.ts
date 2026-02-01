/**
 * Wix Integration
 * E-commerce platform integration for inventory synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  WixApiClient,
  WixApiError,
  WixNotFoundError,
  WixAuthError,
  WixRateLimitError,
  WixServerError,
} from './client.js';

// Export webhook handler
export {
  WixWebhookHandler,
  WixWebhookError,
  createWixWebhookHandler,
  type WixStockChangeEvent,
  type WixWebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { WixClientConfig, WixOAuthState, WixOAuthTokens } from './types.js';

// Factory function for creating client
import { WixApiClient } from './client.js';
import type { WixClientConfig } from './types.js';

export function createWixClient(config: WixClientConfig): WixApiClient {
  return new WixApiClient(config);
}
