/**
 * WooCommerce API Types
 * Based on WooCommerce REST API specification
 */

// ============================================================================
// Client Configuration
// ============================================================================

export interface WooCommerceClientConfig {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  version?: string;
  timeout?: number;
  retryAttempts?: number;
}

// ============================================================================
// Product Types
// ============================================================================

export interface WooCommerceProduct {
  id: number;
  name: string;
  slug: string;
  type: 'simple' | 'variable' | 'grouped' | 'external';
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  variations: number[];
  parent_id: number;
  date_modified: string;
}

export interface WooCommerceVariation {
  id: number;
  sku: string;
  price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  attributes: Array<{
    id: number;
    name: string;
    option: string;
  }>;
}

// ============================================================================
// Order Types
// ============================================================================

export interface WooCommerceOrder {
  id: number;
  status: string;
  line_items: WooCommerceLineItem[];
}

export interface WooCommerceLineItem {
  id: number;
  product_id: number;
  variation_id: number;
  quantity: number;
  sku: string;
  name: string;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WooCommerceWebhookPayload {
  id: number;
  webhook_id: number;
  data: unknown;
}

export type WooCommerceWebhookEvent =
  | 'product.updated'
  | 'product.created'
  | 'product.deleted'
  | 'order.created'
  | 'order.updated'
  | 'order.completed';

export interface WooCommerceWebhookConfig {
  secret: string;
}

// ============================================================================
// Stock Update Types
// ============================================================================

export interface WooCommerceStockUpdate {
  product_id: number;
  stock_quantity: number;
  manage_stock?: boolean;
}

// ============================================================================
// Query Types
// ============================================================================

export interface WooCommerceProductQuery {
  per_page?: number;
  page?: number;
  search?: string;
  sku?: string;
  type?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface WooCommercePaginatedResponse<T> {
  items: T[];
  total: number;
  totalPages: number;
}
