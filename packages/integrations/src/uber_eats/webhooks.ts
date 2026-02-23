/**
 * Uber Eats Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import crypto from 'crypto';
import type { UberEatsWebhookPayload, UberEatsOrder, UberEatsWebhookConfig } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface UberEatsStockChangeEvent {
  source: 'uber_eats';
  type: 'availability_change' | 'order';
  itemId: string;
  newQuantity: number;
  isAvailable: boolean;
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface UberEatsWebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Webhook Handler Class
// ============================================================================

export class UberEatsWebhookHandler {
  private readonly webhookSecret?: string;

  constructor(config?: UberEatsWebhookConfig) {
    this.webhookSecret = config?.secret;
  }

  /**
   * Validate webhook signature
   * Uber Eats uses HMAC-SHA256 for webhook signatures
   */
  validateSignature(
    payload: string | Buffer,
    signature: string
  ): UberEatsWebhookValidationResult {
    if (!this.webhookSecret) {
      // No secret configured, skip validation
      return { valid: true };
    }

    try {
      const expectedSignature = this.computeSignature(payload);

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
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
  parsePayload(rawPayload: string | Record<string, unknown>): UberEatsWebhookPayload {
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as UberEatsWebhookPayload
      : rawPayload as unknown as UberEatsWebhookPayload;

    // Validate required fields
    if (!payload.event_type || !payload.event_id || !payload.event_time || !payload.meta) {
      throw new UberEatsWebhookError('Invalid webhook payload: missing required fields');
    }

    // Validate event type
    if (!this.isValidEvent(payload.event_type)) {
      throw new UberEatsWebhookError(`Unknown webhook event: ${payload.event_type}`);
    }

    return payload;
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(payload: UberEatsWebhookPayload): UberEatsStockChangeEvent[] | null {
    switch (payload.event_type) {
      case 'orders.notification':
        return this.handleOrderNotification(payload);

      case 'eats.store.status_update':
        return this.handleStoreStatusUpdate(payload);

      default:
        return null;
    }
  }

  /**
   * Handle orders.notification webhook event
   * Extract items from order and mark as sold
   */
  private handleOrderNotification(payload: UberEatsWebhookPayload): UberEatsStockChangeEvent[] | null {
    // Parse order data from webhook
    // The order data would typically come from the resource_href or embedded in meta
    const events: UberEatsStockChangeEvent[] = [];

    if (payload.meta?.resource_id) {
      // Extract resource type and ID from meta.resource_id
      // Format is typically "order_id:order_uuid"
      const resourceId = payload.meta.resource_id;

      // Create a generic order event - actual order details would be fetched via API
      // This allows webhook processing without needing full order object
      events.push({
        source: 'uber_eats' as const,
        type: 'order' as const,
        itemId: resourceId,
        newQuantity: -1, // Indicates stock reduction (exact quantity from API)
        isAvailable: true, // Will be determined by inventory service
        timestamp: new Date(payload.event_time),
        metadata: {
          orderId: resourceId,
          eventId: payload.event_id,
          resourceHref: payload.resource_href,
          orderStatus: payload.meta.status,
        },
      });
    }

    return events.length > 0 ? events : null;
  }

  /**
   * Handle eats.store.status_update webhook event
   * Store status changes may affect item availability
   */
  private handleStoreStatusUpdate(payload: UberEatsWebhookPayload): UberEatsStockChangeEvent[] | null {
    const status = payload.meta?.status;
    const storeId = payload.meta?.resource_id;

    if (!storeId) {
      return null;
    }

    // If store is inactive, mark all items as unavailable
    if (status === 'INACTIVE') {
      return [{
        source: 'uber_eats' as const,
        type: 'availability_change' as const,
        itemId: storeId,
        newQuantity: 0,
        isAvailable: false,
        reason: 'Store status: INACTIVE',
        timestamp: new Date(payload.event_time),
        metadata: {
          storeId,
          eventId: payload.event_id,
          status,
          requiresRefresh: true,
        },
      }];
    }

    return null;
  }

  /**
   * Check if event type is valid
   */
  private isValidEvent(event: string): boolean {
    const validEvents = [
      'orders.notification',
      'eats.order.status_update',
      'eats.store.status_update',
    ];
    return validEvents.includes(event);
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class UberEatsWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UberEatsWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createUberEatsWebhookHandler(config?: UberEatsWebhookConfig): UberEatsWebhookHandler {
  return new UberEatsWebhookHandler(config);
}
