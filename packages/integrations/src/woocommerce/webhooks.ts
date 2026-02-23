/**
 * WooCommerce Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import crypto from 'crypto';
import type {
  WooCommerceWebhookPayload,
  WooCommerceProduct,
  WooCommerceOrder,
} from './types.js';
import type { StockChangeEvent } from '../unified.js';

// ============================================================================
// Types
// ============================================================================

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Webhook Handler Class
// ============================================================================

export class WooCommerceWebhookHandler {
  private readonly secret?: string;

  constructor(secret?: string) {
    this.secret = secret;
  }

  /**
   * Validate webhook signature via X-WC-Webhook-Signature header
   * Uses HMAC-SHA256 with base64 digest
   */
  validateSignature(
    payload: string | Buffer,
    signature: string
  ): WebhookValidationResult {
    if (!this.secret) {
      // No secret configured, skip validation
      return { valid: true };
    }

    try {
      const expectedSignature = this.computeSignature(payload);
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
   * Compute HMAC-SHA256 signature for payload
   */
  private computeSignature(payload: string | Buffer): string {
    if (!this.secret) {
      throw new Error('Secret key not configured');
    }

    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(typeof payload === 'string' ? payload : payload.toString('utf8'));
    return hmac.digest('base64');
  }

  /**
   * Parse webhook payload
   */
  parsePayload(rawPayload: string | Record<string, unknown>): WooCommerceWebhookPayload {
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as WooCommerceWebhookPayload
      : rawPayload as unknown as WooCommerceWebhookPayload;

    // Validate required fields
    if (!payload.id || !payload.data) {
      throw new WooCommerceWebhookError('Invalid webhook payload: missing required fields');
    }

    return payload;
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(
    payload: WooCommerceWebhookPayload,
    topic: string
  ): StockChangeEvent | null {
    if (topic.startsWith('product.')) {
      return this.handleProductWebhook(payload.data as WooCommerceProduct, topic);
    }

    if (topic.startsWith('order.')) {
      return this.handleOrderWebhook(payload.data as WooCommerceOrder, topic);
    }

    return null;
  }

  /**
   * Handle product webhook events
   */
  private handleProductWebhook(
    data: WooCommerceProduct,
    topic: string
  ): StockChangeEvent | null {
    // For variable products, we handle variations separately
    if (data.type === 'variable') {
      return null;
    }

    // For simple products
    if (topic === 'product.updated' || topic === 'product.created') {
      return {
        source: 'woocommerce',
        type: 'product_update',
        externalId: data.id.toString(),
        sku: data.sku,
        newQuantity: data.stock_quantity ?? 0,
        isAvailable: data.stock_status === 'instock',
        timestamp: new Date(data.date_modified),
        metadata: {
          productName: data.name,
          productType: data.type,
          manageStock: data.manage_stock,
          stockStatus: data.stock_status,
        },
      };
    }

    if (topic === 'product.deleted') {
      return null;
    }

    return null;
  }

  /**
   * Handle order webhook events (order.completed indicates a sale)
   */
  private handleOrderWebhook(
    data: WooCommerceOrder,
    topic: string
  ): StockChangeEvent | null {
    if (topic !== 'order.completed' && topic !== 'order.updated') {
      return null;
    }

    if (!data.line_items || data.line_items.length === 0) {
      return null;
    }

    // For orders with multiple items, we return the first item
    // In practice, you'd want to handle each item separately
    const firstItem = data.line_items[0];

    // Determine externalId based on whether it's a variation
    const externalId = firstItem.variation_id
      ? `${firstItem.product_id}:${firstItem.variation_id}`
      : firstItem.product_id.toString();

    return {
      source: 'woocommerce',
      type: 'sale',
      externalId,
      sku: firstItem.sku,
      newQuantity: -firstItem.quantity, // Negative indicates stock reduction
      timestamp: new Date(),
      metadata: {
        orderId: data.id,
        orderStatus: data.status,
        lineItems: data.line_items.map((item) => ({
          productId: item.product_id,
          variationId: item.variation_id,
          quantity: item.quantity,
          name: item.name,
        })),
      },
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class WooCommerceWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WooCommerceWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWooCommerceWebhookHandler(secret?: string): WooCommerceWebhookHandler {
  return new WooCommerceWebhookHandler(secret);
}
