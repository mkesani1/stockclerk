/**
 * Shopify Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import * as crypto from 'crypto';
import type { ShopifyWebhookEvent, ShopifyInventoryLevelWebhookData } from './types.js';
import type { StockUpdate } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface StockChangeEvent {
  source: 'shopify';
  type: 'stock_update' | 'product_update' | 'order';
  productId: string;
  sku?: string;
  previousQuantity?: number;
  newQuantity: number;
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Webhook Handler Class
// ============================================================================

export class ShopifyWebhookHandler {
  private readonly secret: string;
  private readonly processedEventIds = new Set<string>();
  private readonly maxEventIdCache = 1000;

  constructor(secret: string) {
    this.secret = secret;
  }

  /**
   * Validate webhook signature using HMAC-SHA256 with base64 digest
   * Shopify sends the signature in X-Shopify-Hmac-SHA256 header as base64
   */
  validateSignature(
    payload: string | Buffer,
    signature: string
  ): WebhookValidationResult {
    try {
      const hmac = crypto.createHmac('sha256', this.secret);
      const payloadData = typeof payload === 'string' ? payload : payload.toString('utf8');
      hmac.update(payloadData);

      // Shopify uses base64 digest, NOT hex
      const expectedSignature = hmac.digest('base64');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Signature validation failed',
      };
    }
  }

  /**
   * Check for duplicate events using X-Shopify-Event-Id
   */
  isDuplicate(eventId: string): boolean {
    if (this.processedEventIds.has(eventId)) {
      return true;
    }

    // Add to cache
    this.processedEventIds.add(eventId);

    // Cleanup cache if it gets too large
    if (this.processedEventIds.size > this.maxEventIdCache) {
      const idsToDelete = Array.from(this.processedEventIds).slice(0, 100);
      idsToDelete.forEach((id) => this.processedEventIds.delete(id));
    }

    return false;
  }

  /**
   * Parse and validate webhook payload
   */
  parsePayload(rawPayload: string | Record<string, unknown>): {
    topic: string;
    data: unknown;
    timestamp: string;
  } {
    const payload = typeof rawPayload === 'string'
      ? (JSON.parse(rawPayload) as Record<string, unknown>)
      : (rawPayload as Record<string, unknown>);

    if (!payload.topic || typeof payload.topic !== 'string') {
      throw new ShopifyWebhookError('Invalid webhook payload: missing topic');
    }

    if (!payload.created_at || typeof payload.created_at !== 'string') {
      throw new ShopifyWebhookError('Invalid webhook payload: missing created_at');
    }

    return {
      topic: payload.topic,
      data: payload,
      timestamp: payload.created_at,
    };
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(topic: string, data: unknown, timestamp: string): StockChangeEvent | null {
    switch (topic) {
      case 'inventory_levels/update':
        return this.handleInventoryUpdate(data as ShopifyInventoryLevelWebhookData, timestamp);

      case 'products/update':
        return this.handleProductUpdate(data as Record<string, unknown>, timestamp);

      case 'products/create':
        return this.handleProductCreate(data as Record<string, unknown>, timestamp);

      case 'orders/create':
        return this.handleOrderCreate(data as Record<string, unknown>, timestamp);

      case 'products/delete':
        // Product deletion doesn't affect stock we need to track
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle inventory_levels/update webhook event
   */
  private handleInventoryUpdate(
    data: ShopifyInventoryLevelWebhookData,
    timestamp: string
  ): StockChangeEvent {
    return {
      source: 'shopify',
      type: 'stock_update',
      productId: data.inventory_item_id.toString(),
      newQuantity: data.available,
      timestamp: new Date(timestamp),
      metadata: {
        inventoryItemId: data.inventory_item_id,
        locationId: data.location_id,
      },
    };
  }

  /**
   * Handle products/update webhook event
   */
  private handleProductUpdate(
    data: Record<string, unknown>,
    timestamp: string
  ): StockChangeEvent | null {
    const product = data as {
      id?: number;
      title?: string;
      variants?: Array<{ id?: number; inventory_quantity?: number }>;
    };

    if (!product.id || !product.variants || product.variants.length === 0) {
      return null;
    }

    // Return event for first variant
    const firstVariant = product.variants[0];
    if (!firstVariant.id) {
      return null;
    }

    return {
      source: 'shopify',
      type: 'product_update',
      productId: firstVariant.id.toString(),
      newQuantity: firstVariant.inventory_quantity || 0,
      timestamp: new Date(timestamp),
      metadata: {
        productId: product.id,
        productTitle: product.title,
        variantId: firstVariant.id,
      },
    };
  }

  /**
   * Handle products/create webhook event
   */
  private handleProductCreate(
    data: Record<string, unknown>,
    timestamp: string
  ): StockChangeEvent | null {
    const product = data as {
      id?: number;
      title?: string;
      variants?: Array<{ id?: number; inventory_quantity?: number }>;
    };

    if (!product.id || !product.variants || product.variants.length === 0) {
      return null;
    }

    // Return event for first variant
    const firstVariant = product.variants[0];
    if (!firstVariant.id) {
      return null;
    }

    return {
      source: 'shopify',
      type: 'product_update',
      productId: firstVariant.id.toString(),
      previousQuantity: 0,
      newQuantity: firstVariant.inventory_quantity || 0,
      timestamp: new Date(timestamp),
      metadata: {
        productId: product.id,
        productTitle: product.title,
        variantId: firstVariant.id,
        isNew: true,
      },
    };
  }

  /**
   * Handle orders/create webhook event
   * This indicates a sale which affects stock
   */
  private handleOrderCreate(
    data: Record<string, unknown>,
    timestamp: string
  ): StockChangeEvent | null {
    const order = data as {
      id?: number;
      line_items?: Array<{
        product_id?: number;
        variant_id?: number;
        quantity?: number;
      }>;
    };

    if (!order.id || !order.line_items || order.line_items.length === 0) {
      return null;
    }

    // Return event for first line item
    const firstItem = order.line_items[0];
    if (!firstItem.variant_id) {
      return null;
    }

    return {
      source: 'shopify',
      type: 'order',
      productId: firstItem.variant_id.toString(),
      newQuantity: -(firstItem.quantity || 0), // Negative indicates stock reduction
      timestamp: new Date(timestamp),
      metadata: {
        orderId: order.id,
        variantId: firstItem.variant_id,
        productId: firstItem.product_id,
        allLineItems: order.line_items.map((item) => ({
          variantId: item.variant_id,
          productId: item.product_id,
          quantity: item.quantity,
        })),
      },
    };
  }

  /**
   * Convert webhook event to stock update format
   */
  toStockUpdate(event: StockChangeEvent): StockUpdate {
    return {
      productId: event.productId,
      sku: event.sku || `SHOPIFY-${event.productId}`,
      quantity: event.newQuantity,
      source: 'shopify',
      timestamp: event.timestamp,
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class ShopifyWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createShopifyWebhookHandler(secret: string): ShopifyWebhookHandler {
  return new ShopifyWebhookHandler(secret);
}
