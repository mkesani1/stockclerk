/**
 * Shopify API Types
 * Based on Shopify GraphQL and REST API specification
 */

// ============================================================================
// Client Configuration
// ============================================================================

export interface ShopifyClientConfig {
  shop: string;
  accessToken: string;
  apiVersion?: string;
  timeout?: number;
  retryAttempts?: number;
}

// ============================================================================
// Product/Variant Types
// ============================================================================

export interface ShopifyProduct {
  id: number;
  title: string;
  variants: ShopifyVariant[];
  status: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string;
  price: string;
  inventory_item_id: number;
  inventory_quantity: number;
  barcode?: string;
  position: number;
}

// ============================================================================
// Inventory Types
// ============================================================================

export interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export interface ShopifyInventoryItem {
  id: number;
  sku: string;
  tracked: boolean;
  cost?: string;
}

export interface ShopifyLocation {
  id: number;
  name: string;
  active: boolean;
  address1?: string;
  city?: string;
  country?: string;
}

// ============================================================================
// Stock Update Types
// ============================================================================

export interface ShopifyStockUpdate {
  inventory_item_id: number;
  location_id: number;
  available: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface ShopifyWebhookPayload {
  id: number;
  topic: string;
  shop_domain: string;
  body: unknown;
  created_at: string;
}

export type ShopifyWebhookEvent =
  | 'inventory_levels/update'
  | 'products/update'
  | 'products/create'
  | 'products/delete'
  | 'orders/create';

export interface ShopifyWebhookConfig {
  secret: string;
}

export interface ShopifyInventoryLevelWebhookData {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

// ============================================================================
// API Query Types
// ============================================================================

export interface ShopifyProductQuery {
  limit?: number;
  since_id?: number;
  fields?: string;
}

// ============================================================================
// API Response Wrapper Types
// ============================================================================

export interface ShopifyApiResponse<T> {
  data: T;
}

export interface ShopifyErrorResponse {
  errors: Array<{
    code: string;
    message: string;
  }>;
}
