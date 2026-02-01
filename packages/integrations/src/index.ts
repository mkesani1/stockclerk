/**
 * StockClerk - Integrations Package
 * Third-party API connectors for EposNow, Wix, and Otter (Deliveroo)
 *
 * @packageDocumentation
 */

// ============================================================================
// Unified Interface & Base Types
// ============================================================================

export {
  type InventoryProvider,
  type ChannelType,
  type ChannelCredentials,
  type UnifiedProduct,
  type StockChangeEvent,
  type WebhookValidationResult,
  type ProviderHealth,
  BaseInventoryProvider,
  ProviderError,
  ProviderNotConnectedError,
  ProviderAuthError,
  ProviderSyncError,
} from './unified.js';

// ============================================================================
// Factory & Registry
// ============================================================================

export {
  createProvider,
  createConnectedProvider,
  ProviderRegistry,
  createProviderRegistry,
  ProviderManager,
  createProviderManager,
  UnknownProviderError,
  type ProviderFactoryOptions,
} from './factory.js';

// ============================================================================
// Provider Implementations
// ============================================================================

export {
  EposnowProvider,
  createEposnowProvider,
  WixProvider,
  createWixProvider,
  OtterProvider,
  DeliverooProvider,
  createOtterProvider,
  createDeliverooProvider,
} from './providers/index.js';

// ============================================================================
// Eposnow Integration
// ============================================================================

export {
  // Client
  EposnowApiClient,
  createEposnowClient,
  EposnowApiError,
  EposnowNotFoundError,
  EposnowAuthError,
  EposnowRateLimitError,
  EposnowServerError,
  // Webhooks
  EposnowWebhookHandler,
  EposnowWebhookError,
  createEposnowWebhookHandler,
  type StockChangeEvent as EposnowStockChangeEvent,
  // Types (namespace to avoid conflicts)
} from './eposnow/index.js';

export type {
  EposnowClientConfig,
  EposnowProduct,
  EposnowProductQuery,
  EposnowStockUpdate,
  EposnowStockAdjustmentReason,
  EposnowLocation,
  EposnowWebhookConfig,
  EposnowWebhookEvent,
  EposnowWebhookPayload,
} from './eposnow/types.js';

// ============================================================================
// Wix Integration
// ============================================================================

export {
  // Client
  WixApiClient,
  createWixClient,
  WixApiError,
  WixNotFoundError,
  WixAuthError,
  WixRateLimitError,
  WixServerError,
  // Webhooks
  WixWebhookHandler,
  WixWebhookError,
  createWixWebhookHandler,
  type WixStockChangeEvent,
} from './wix/index.js';

export type {
  WixClientConfig,
  WixOAuthState,
  WixOAuthTokens,
  WixProduct,
  WixProductQuery,
  WixInventoryItem,
  WixInventoryUpdateRequest,
  WixWebhookConfig,
  WixWebhookEventType,
  WixWebhookPayload,
} from './wix/types.js';

// ============================================================================
// Otter/Deliveroo Integration
// ============================================================================

export {
  // Client
  OtterApiClient,
  createOtterClient,
  OtterApiError,
  OtterNotFoundError,
  OtterAuthError,
  OtterRateLimitError,
  OtterServerError,
  // Webhooks
  OtterWebhookHandler,
  OtterWebhookError,
  createOtterWebhookHandler,
  type OtterStockChangeEvent,
} from './otter/index.js';

export type {
  OtterClientConfig,
  OtterMenu,
  OtterMenuItem,
  OtterCategory,
  OtterAvailabilityUpdate,
  OtterAvailabilityStatus,
  OtterStockLevel,
  OtterWebhookConfig,
  OtterWebhookEvent,
  OtterWebhookPayload,
  OtterPlatform,
} from './otter/types.js';

// ============================================================================
// Common Types
// ============================================================================

export type {
  IntegrationConfig,
  Product,
  StockUpdate,
  SyncResult,
  SyncError,
  IntegrationSource,
  WebhookPayload,
  IntegrationClient,
} from './types.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  // Rate Limiter
  RateLimiter,
  createRateLimiter,
  createApiRateLimiter,
  createAllRateLimiters,
  RateLimitExceededError,
  API_RATE_LIMITS,
  type RateLimiterOptions,
  type RateLimiterStats,
  type ApiProvider,
  // Retry
  withRetry,
  withRetryAndStats,
  withApiRetry,
  withWebhookRetry,
  addFullJitter,
  addEqualJitter,
  addDecorrelatedJitter,
  calculateBackoffDelay,
  isRetryableError,
  isRateLimitError,
  createAbortError,
  AbortError,
  DEFAULT_RETRY_OPTIONS,
  type RetryOptions,
  type RetryStats,
} from './utils/index.js';
