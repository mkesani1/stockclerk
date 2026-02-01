/**
 * Otter Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import crypto from 'crypto';
import type {
  OtterWebhookPayload,
  OtterWebhookEvent,
  OtterItemAvailabilityWebhookData,
  OtterStockWebhookData,
  OtterOrderWebhookData,
  OtterMenuWebhookData,
  OtterAvailabilityStatus,
} from './types.js';
import type { StockUpdate } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface OtterStockChangeEvent {
  source: 'otter';
  type: 'availability_change' | 'stock_update' | 'order';
  itemId: string;
  sku?: string;
  previousQuantity?: number;
  newQuantity?: number;
  isAvailable: boolean;
  availabilityStatus?: OtterAvailabilityStatus;
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface OtterWebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Webhook Handler Class
// ============================================================================

export class OtterWebhookHandler {
  private readonly webhookSecret?: string;

  constructor(webhookSecret?: string) {
    this.webhookSecret = webhookSecret;
  }

  /**
   * Validate webhook signature
   * Otter uses HMAC-SHA256 for webhook signatures
   */
  validateSignature(
    payload: string | Buffer,
    signature: string
  ): OtterWebhookValidationResult {
    if (!this.webhookSecret) {
      // No secret configured, skip validation
      return { valid: true };
    }

    try {
      const expectedSignature = this.computeSignature(payload);

      // Handle both prefixed and non-prefixed signatures
      const normalizedSignature = signature.startsWith('sha256=')
        ? signature.substring(7)
        : signature;

      const isValid = crypto.timingSafeEqual(
        Buffer.from(normalizedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
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
    return hmac.digest('hex');
  }

  /**
   * Parse and validate webhook payload
   */
  parsePayload<T = unknown>(rawPayload: string | Record<string, unknown>): OtterWebhookPayload<T> {
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as OtterWebhookPayload<T>
      : rawPayload as unknown as OtterWebhookPayload<T>;

    // Validate required fields
    if (!payload.id || !payload.event || !payload.timestamp || !payload.data) {
      throw new OtterWebhookError('Invalid webhook payload: missing required fields');
    }

    if (!payload.restaurantId) {
      throw new OtterWebhookError('Invalid webhook payload: missing restaurantId');
    }

    // Validate event type
    if (!this.isValidEvent(payload.event)) {
      throw new OtterWebhookError(`Unknown webhook event: ${payload.event}`);
    }

    return payload;
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(payload: OtterWebhookPayload): OtterStockChangeEvent | OtterStockChangeEvent[] | null {
    switch (payload.event) {
      case 'item.availability_changed':
        return this.handleAvailabilityChanged(payload as OtterWebhookPayload<OtterItemAvailabilityWebhookData>);

      case 'item.stock_updated':
        return this.handleStockUpdated(payload as OtterWebhookPayload<OtterStockWebhookData>);

      case 'order.created':
      case 'order.updated':
        return this.handleOrderEvent(payload as OtterWebhookPayload<OtterOrderWebhookData>);

      case 'order.cancelled':
        return this.handleOrderCancelled(payload as OtterWebhookPayload<OtterOrderWebhookData>);

      case 'menu.updated':
        return this.handleMenuUpdated(payload as OtterWebhookPayload<OtterMenuWebhookData>);

      case 'restaurant.status_changed':
        // Restaurant status changes don't affect stock
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle item.availability_changed webhook event
   */
  private handleAvailabilityChanged(
    payload: OtterWebhookPayload<OtterItemAvailabilityWebhookData>
  ): OtterStockChangeEvent {
    const data = payload.data;

    // Determine quantity based on availability status
    let newQuantity: number | undefined;
    if (data.newStatus === 'sold_out' || data.newStatus === 'unavailable') {
      newQuantity = 0;
    }

    return {
      source: 'otter',
      type: 'availability_change',
      itemId: data.itemId,
      sku: data.sku,
      newQuantity,
      isAvailable: data.newStatus === 'available',
      availabilityStatus: data.newStatus,
      reason: data.reason,
      timestamp: new Date(payload.timestamp),
      metadata: {
        itemName: data.itemName,
        previousStatus: data.previousStatus,
        platform: data.platform,
        restaurantId: payload.restaurantId,
      },
    };
  }

  /**
   * Handle item.stock_updated webhook event
   */
  private handleStockUpdated(
    payload: OtterWebhookPayload<OtterStockWebhookData>
  ): OtterStockChangeEvent {
    const data = payload.data;

    return {
      source: 'otter',
      type: 'stock_update',
      itemId: data.itemId,
      sku: data.sku,
      previousQuantity: data.previousQuantity,
      newQuantity: data.newQuantity,
      isAvailable: data.newQuantity > 0,
      reason: data.reason,
      timestamp: new Date(payload.timestamp),
      metadata: {
        itemName: data.itemName,
        operation: data.operation,
        restaurantId: payload.restaurantId,
      },
    };
  }

  /**
   * Handle order.created/updated webhook events
   * Orders affect stock when items are sold
   */
  private handleOrderEvent(
    payload: OtterWebhookPayload<OtterOrderWebhookData>
  ): OtterStockChangeEvent[] {
    const data = payload.data;

    // Only process orders that would affect inventory
    if (!['pending', 'accepted', 'preparing'].includes(data.status)) {
      return [];
    }

    return data.items.map((item) => ({
      source: 'otter' as const,
      type: 'order' as const,
      itemId: item.menuItemId,
      newQuantity: -item.quantity, // Negative indicates stock reduction
      isAvailable: true, // Will be determined by inventory service
      timestamp: new Date(payload.timestamp),
      metadata: {
        itemName: item.name,
        orderId: data.orderId,
        externalOrderId: data.externalOrderId,
        platform: data.platform,
        orderStatus: data.status,
        quantity: item.quantity,
        restaurantId: payload.restaurantId,
      },
    }));
  }

  /**
   * Handle order.cancelled webhook event
   * Cancelled orders may restore stock
   */
  private handleOrderCancelled(
    payload: OtterWebhookPayload<OtterOrderWebhookData>
  ): OtterStockChangeEvent[] {
    const data = payload.data;

    return data.items.map((item) => ({
      source: 'otter' as const,
      type: 'order' as const,
      itemId: item.menuItemId,
      newQuantity: item.quantity, // Positive indicates stock restoration
      isAvailable: true,
      reason: 'Order cancelled',
      timestamp: new Date(payload.timestamp),
      metadata: {
        itemName: item.name,
        orderId: data.orderId,
        externalOrderId: data.externalOrderId,
        platform: data.platform,
        orderStatus: data.status,
        quantity: item.quantity,
        restaurantId: payload.restaurantId,
        isCancellation: true,
      },
    }));
  }

  /**
   * Handle menu.updated webhook event
   * Menu updates may indicate item availability changes
   */
  private handleMenuUpdated(
    payload: OtterWebhookPayload<OtterMenuWebhookData>
  ): OtterStockChangeEvent[] | null {
    const data = payload.data;

    // Only process updates that affect items
    if (!data.affectedItems?.length || data.changeType === 'deleted') {
      return null;
    }

    // For menu updates, we don't have detailed stock info
    // Just flag items for refresh
    return data.affectedItems.map((itemId) => ({
      source: 'otter' as const,
      type: 'availability_change' as const,
      itemId,
      isAvailable: true, // Unknown, will need refresh
      timestamp: new Date(payload.timestamp),
      metadata: {
        menuId: data.menuId,
        menuName: data.menuName,
        changeType: data.changeType,
        requiresRefresh: true,
        restaurantId: payload.restaurantId,
      },
    }));
  }

  /**
   * Convert webhook event to stock update format
   */
  toStockUpdate(event: OtterStockChangeEvent): StockUpdate | null {
    // Cannot create stock update without quantity information
    if (event.newQuantity === undefined) {
      return null;
    }

    return {
      productId: event.itemId,
      sku: event.sku || `OTTER-${event.itemId}`,
      quantity: event.newQuantity,
      source: 'otter',
      timestamp: event.timestamp,
    };
  }

  /**
   * Convert multiple webhook events to stock updates
   */
  toStockUpdates(events: OtterStockChangeEvent | OtterStockChangeEvent[] | null): StockUpdate[] {
    if (!events) {
      return [];
    }

    const eventArray = Array.isArray(events) ? events : [events];
    return eventArray
      .map((event) => this.toStockUpdate(event))
      .filter((update): update is StockUpdate => update !== null);
  }

  /**
   * Check if event type is valid
   */
  private isValidEvent(event: string): event is OtterWebhookEvent {
    const validEvents: OtterWebhookEvent[] = [
      'menu.updated',
      'item.availability_changed',
      'item.stock_updated',
      'order.created',
      'order.updated',
      'order.cancelled',
      'restaurant.status_changed',
    ];
    return validEvents.includes(event as OtterWebhookEvent);
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class OtterWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtterWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOtterWebhookHandler(webhookSecret?: string): OtterWebhookHandler {
  return new OtterWebhookHandler(webhookSecret);
}
