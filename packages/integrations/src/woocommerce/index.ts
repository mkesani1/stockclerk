/**
 * WooCommerce Integration
 * E-commerce platform integration for stock synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  WooCommerceApiClient,
  WooCommerceApiError,
  WooCommerceNotFoundError,
  WooCommerceAuthError,
  WooCommerceRateLimitError,
  WooCommerceServerError,
  createWooCommerceClient,
} from './client.js';

// Export webhook handler
export {
  WooCommerceWebhookHandler,
  WooCommerceWebhookError,
  createWooCommerceWebhookHandler,
  type WebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { WooCommerceClientConfig } from './types.js';
