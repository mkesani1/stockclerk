/**
 * Shopify Integration
 * E-commerce platform integration for stock synchronization
 */

// Export types
export * from './types.js';

// Export client
export {
  ShopifyApiClient,
  ShopifyApiError,
  ShopifyNotFoundError,
  ShopifyAuthError,
  ShopifyRateLimitError,
  ShopifyServerError,
  createShopifyClient,
} from './client.js';

// Export webhook handler
export {
  ShopifyWebhookHandler,
  ShopifyWebhookError,
  createShopifyWebhookHandler,
  type StockChangeEvent,
  type WebhookValidationResult,
} from './webhooks.js';

// Re-export types for convenience
export type { ShopifyClientConfig } from './types.js';
