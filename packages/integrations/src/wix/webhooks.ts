/**
 * Wix Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import crypto from 'crypto';
import type {
  WixWebhookPayload,
  WixWebhookEventType,
  WixInventoryWebhookData,
  WixProductWebhookData,
  WixOrderWebhookData,
} from './types.js';
import type { StockUpdate } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface WixStockChangeEvent {
  source: 'wix';
  type: 'inventory_update' | 'product_update' | 'order';
  productId: string;
  variantId?: string;
  sku?: string;
  previousQuantity?: number;
  newQuantity: number;
  inStock: boolean;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WixWebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Webhook Handler Class
// ============================================================================

export class WixWebhookHandler {
  private readonly webhookSecret?: string;

  constructor(webhookSecret?: string) {
    this.webhookSecret = webhookSecret;
  }

  /**
   * Validate Wix webhook signature
   * Wix uses a JWT-based signature system
   */
  validateSignature(
    payload: string | Buffer,
    signature: string,
    publicKey?: string
  ): WixWebhookValidationResult {
    if (!this.webhookSecret && !publicKey) {
      // No secret configured, skip validation
      return { valid: true };
    }

    try {
      // Wix uses HMAC-SHA256 for webhook signatures
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
   * Compute HMAC signature for payload
   */
  private computeSignature(payload: string | Buffer): string {
    if (!this.webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(typeof payload === 'string' ? payload : payload.toString('utf8'));
    return hmac.digest('base64');
  }

  /**
   * Parse and validate webhook payload
   */
  parsePayload<T = unknown>(rawPayload: string | Record<string, unknown>): WixWebhookPayload<T> {
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as WixWebhookPayload<T>
      : rawPayload as unknown as WixWebhookPayload<T>;

    // Validate required fields
    if (!payload.data || !payload.metadata) {
      throw new WixWebhookError('Invalid webhook payload: missing required fields');
    }

    if (!payload.metadata.entityId || !payload.metadata.eventTime) {
      throw new WixWebhookError('Invalid webhook metadata: missing entityId or eventTime');
    }

    return payload;
  }

  /**
   * Determine event type from webhook metadata
   */
  getEventType(payload: WixWebhookPayload): WixWebhookEventType | null {
    const fqdn = payload.metadata.entityFqdn;

    if (!fqdn) {
      return null;
    }

    // Parse FQDN to determine event type
    if (fqdn.includes('inventory')) {
      return 'wix.stores.inventory.updated';
    }

    if (fqdn.includes('product')) {
      // Check originated action
      const origin = payload.metadata.originatedFrom;
      if (origin === 'create') return 'wix.stores.product.created';
      if (origin === 'delete') return 'wix.stores.product.deleted';
      return 'wix.stores.product.updated';
    }

    if (fqdn.includes('order')) {
      const origin = payload.metadata.originatedFrom;
      if (origin === 'create') return 'wix.ecom.orders.created';
      return 'wix.ecom.orders.updated';
    }

    return null;
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(
    payload: WixWebhookPayload,
    eventType?: WixWebhookEventType
  ): WixStockChangeEvent | WixStockChangeEvent[] | null {
    const type = eventType || this.getEventType(payload);

    if (!type) {
      return null;
    }

    switch (type) {
      case 'wix.stores.inventory.updated':
        return this.handleInventoryUpdated(payload as WixWebhookPayload<WixInventoryWebhookData>);

      case 'wix.stores.product.created':
      case 'wix.stores.product.updated':
        return this.handleProductUpdated(payload as WixWebhookPayload<WixProductWebhookData>);

      case 'wix.ecom.orders.created':
      case 'wix.ecom.orders.updated':
        return this.handleOrderCreated(payload as WixWebhookPayload<WixOrderWebhookData>);

      case 'wix.stores.product.deleted':
      case 'wix.stores.collection.created':
      case 'wix.stores.collection.updated':
      case 'wix.stores.collection.deleted':
        // These events don't result in stock changes we need to process
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle inventory.updated webhook event
   */
  private handleInventoryUpdated(
    payload: WixWebhookPayload<WixInventoryWebhookData>
  ): WixStockChangeEvent[] {
    const data = payload.data;
    const events: WixStockChangeEvent[] = [];

    for (const variant of data.variants) {
      events.push({
        source: 'wix',
        type: 'inventory_update',
        productId: data.productId,
        variantId: variant.variantId,
        newQuantity: variant.quantity ?? 0,
        inStock: variant.inStock,
        timestamp: new Date(payload.metadata.eventTime),
        metadata: {
          inventoryItemId: data.inventoryItemId,
          externalId: data.externalId,
          trackQuantity: data.trackQuantity,
        },
      });
    }

    return events;
  }

  /**
   * Handle product.created/updated webhook event
   */
  private handleProductUpdated(
    payload: WixWebhookPayload<WixProductWebhookData>
  ): WixStockChangeEvent | WixStockChangeEvent[] | null {
    const product = payload.data.product;

    if (!product) {
      return null;
    }

    // If product has variants, create events for each
    if (product.variants && product.variants.length > 0) {
      return product.variants.map((variant) => ({
        source: 'wix' as const,
        type: 'product_update' as const,
        productId: product.id,
        variantId: variant.id,
        sku: variant.variant.sku || product.sku || undefined,
        newQuantity: variant.stock.quantity ?? 0,
        inStock: variant.stock.inStock,
        timestamp: new Date(payload.metadata.eventTime),
        metadata: {
          productName: product.name,
          variantChoices: variant.choices,
          visible: product.visible,
        },
      }));
    }

    // Single product without variants
    return {
      source: 'wix',
      type: 'product_update',
      productId: product.id,
      sku: product.sku || undefined,
      newQuantity: product.stock.quantity ?? 0,
      inStock: product.stock.inStock,
      timestamp: new Date(payload.metadata.eventTime),
      metadata: {
        productName: product.name,
        visible: product.visible,
        inventoryStatus: product.stock.inventoryStatus,
      },
    };
  }

  /**
   * Handle order created/updated webhook event
   * Orders affect stock when items are purchased
   */
  private handleOrderCreated(
    payload: WixWebhookPayload<WixOrderWebhookData>
  ): WixStockChangeEvent[] {
    const order = payload.data.order;

    if (!order || !order.lineItems?.length) {
      return [];
    }

    return order.lineItems.map((item) => ({
      source: 'wix' as const,
      type: 'order' as const,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      newQuantity: -item.quantity, // Negative indicates stock reduction
      inStock: true, // Will be determined by inventory service
      timestamp: new Date(payload.metadata.eventTime),
      metadata: {
        orderId: order.id,
        orderNumber: order.number,
        orderStatus: order.status,
        quantity: item.quantity,
      },
    }));
  }

  /**
   * Convert webhook event to stock update format
   */
  toStockUpdate(event: WixStockChangeEvent): StockUpdate {
    return {
      productId: event.productId,
      sku: event.sku || `WIX-${event.productId}`,
      quantity: event.newQuantity,
      source: 'wix',
      timestamp: event.timestamp,
    };
  }

  /**
   * Convert multiple webhook events to stock updates
   */
  toStockUpdates(events: WixStockChangeEvent | WixStockChangeEvent[] | null): StockUpdate[] {
    if (!events) {
      return [];
    }

    const eventArray = Array.isArray(events) ? events : [events];
    return eventArray.map((event) => this.toStockUpdate(event));
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class WixWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WixWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWixWebhookHandler(webhookSecret?: string): WixWebhookHandler {
  return new WixWebhookHandler(webhookSecret);
}
