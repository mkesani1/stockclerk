/**
 * Wix API Types
 * Based on Wix Stores and Inventory API specifications
 */

// ============================================================================
// OAuth Types
// ============================================================================

export interface WixOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface WixOAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope?: string;
}

export interface WixOAuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  instanceId: string;
  siteId?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface WixApiResponse<T> {
  data: T;
}

export interface WixPaginatedResponse<T> {
  items: T[];
  metadata: {
    count: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}

export interface WixErrorResponse {
  message: string;
  details?: {
    applicationError?: {
      code: string;
      description: string;
    };
  };
}

// ============================================================================
// Product Types (Wix Stores)
// ============================================================================

export interface WixProduct {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  productType: WixProductType;
  description: string | null;
  sku: string | null;
  weight: number | null;
  stock: WixProductStock;
  price: WixProductPrice;
  priceData: WixPriceData;
  costAndProfitData?: WixCostProfitData;
  ribbon?: string;
  brand?: string;
  discount?: WixDiscount;
  media: WixProductMedia;
  customTextFields?: WixCustomTextField[];
  manageVariants: boolean;
  productOptions?: WixProductOption[];
  variants?: WixProductVariant[];
  lastUpdated: string;
  createdDate: string;
  collectionIds?: string[];
  additionalInfoSections?: WixInfoSection[];
}

export type WixProductType = 'physical' | 'digital' | 'unspecified_product_type';

export interface WixProductStock {
  trackInventory: boolean;
  quantity: number | null;
  inStock: boolean;
  inventoryStatus: WixInventoryStatus;
}

export type WixInventoryStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'PARTIALLY_OUT_OF_STOCK';

export interface WixProductPrice {
  currency: string;
  price: number;
  discountedPrice?: number;
  formatted: {
    price: string;
    discountedPrice?: string;
  };
}

export interface WixPriceData {
  currency: string;
  price: number;
  discountedPrice?: number;
}

export interface WixCostProfitData {
  itemCost?: number;
  formattedItemCost?: string;
  profit?: number;
  formattedProfit?: string;
  profitMargin?: number;
}

export interface WixDiscount {
  type: 'PERCENT' | 'AMOUNT';
  value: number;
}

export interface WixProductMedia {
  mainMedia?: WixMediaItem;
  items: WixMediaItem[];
}

export interface WixMediaItem {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO';
  image?: {
    url: string;
    width: number;
    height: number;
  };
  video?: {
    url: string;
    stillFrameMediaId?: string;
  };
}

export interface WixCustomTextField {
  title: string;
  maxLength: number;
  mandatory: boolean;
}

export interface WixProductOption {
  name: string;
  optionType: 'drop_down' | 'color' | 'text';
  choices: WixProductOptionChoice[];
}

export interface WixProductOptionChoice {
  value: string;
  description?: string;
  media?: WixMediaItem;
  inStock?: boolean;
  visible?: boolean;
}

export interface WixInfoSection {
  title: string;
  description: string;
}

// ============================================================================
// Variant Types
// ============================================================================

export interface WixProductVariant {
  id: string;
  choices: Record<string, string>;
  variant: {
    priceData?: WixPriceData;
    weight?: number;
    sku?: string;
    visible?: boolean;
  };
  stock: {
    trackQuantity: boolean;
    quantity: number | null;
    inStock: boolean;
  };
}

// ============================================================================
// Inventory Types
// ============================================================================

export interface WixInventoryItem {
  id: string;
  productId: string;
  trackQuantity: boolean;
  variants: WixInventoryVariant[];
  lastUpdated: string;
}

export interface WixInventoryVariant {
  variantId: string;
  inStock: boolean;
  quantity: number | null;
}

export interface WixInventoryUpdateRequest {
  incrementBy?: number;
  decrementBy?: number;
  setQuantity?: number;
}

export interface WixInventoryBulkUpdate {
  variantId: string;
  productId?: string;
  incrementBy?: number;
  decrementBy?: number;
  setQuantity?: number;
}

// ============================================================================
// Collection Types
// ============================================================================

export interface WixCollection {
  id: string;
  name: string;
  description?: string;
  slug: string;
  visible: boolean;
  numberOfProducts: number;
  media?: WixProductMedia;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WixWebhookConfig {
  id?: string;
  uri: string;
  appId: string;
  eventType: WixWebhookEventType;
  status: 'ACTIVE' | 'PAUSED' | 'REMOVED';
}

export type WixWebhookEventType =
  | 'wix.stores.inventory.updated'
  | 'wix.stores.product.created'
  | 'wix.stores.product.updated'
  | 'wix.stores.product.deleted'
  | 'wix.stores.collection.created'
  | 'wix.stores.collection.updated'
  | 'wix.stores.collection.deleted'
  | 'wix.ecom.orders.created'
  | 'wix.ecom.orders.updated';

export interface WixWebhookPayload<T = unknown> {
  data: T;
  metadata: WixWebhookMetadata;
}

export interface WixWebhookMetadata {
  id: string;
  entityId: string;
  eventTime: string;
  triggeredByAnonymizeRequest: boolean;
  originatedFrom?: string;
  entityFqdn?: string;
}

export interface WixInventoryWebhookData {
  inventoryItemId: string;
  externalId?: string;
  productId: string;
  trackQuantity: boolean;
  variants: Array<{
    variantId: string;
    inStock: boolean;
    quantity: number | null;
  }>;
  lastUpdated: string;
}

export interface WixProductWebhookData {
  product: WixProduct;
}

export interface WixOrderWebhookData {
  order: {
    id: string;
    number: number;
    lineItems: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
      sku?: string;
    }>;
    status: string;
    createdDate: string;
  };
}

// ============================================================================
// Query Types
// ============================================================================

export interface WixProductQuery {
  limit?: number;
  offset?: number;
  includeVariants?: boolean;
  includeHiddenProducts?: boolean;
}

export interface WixInventoryQuery {
  limit?: number;
  offset?: number;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface WixClientConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  siteId?: string;
  instanceId?: string;
  timeout?: number;
  retryAttempts?: number;
}
