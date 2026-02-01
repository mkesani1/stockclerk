/**
 * Eposnow Webhook Handler
 * Processes incoming webhook payloads and transforms them to unified events
 */

import crypto from 'crypto';
import type {
  EposnowWebhookPayload,
  EposnowWebhookEvent,
  EposnowProductWebhookData,
  EposnowStockWebhookData,
  EposnowTransactionWebhookData,
} from './types.js';
import type { StockUpdate } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface StockChangeEvent {
  source: 'eposnow';
  type: 'stock_update' | 'product_update' | 'sale';
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

export class EposnowWebhookHandler {
  private readonly secretKey?: string;

  constructor(secretKey?: string) {
    this.secretKey = secretKey;
  }

  /**
   * Validate webhook signature
   */
  validateSignature(
    payload: string | Buffer,
    signature: string
  ): WebhookValidationResult {
    if (!this.secretKey) {
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
   * Compute HMAC signature for payload
   */
  private computeSignature(payload: string | Buffer): string {
    if (!this.secretKey) {
      throw new Error('Secret key not configured');
    }

    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(typeof payload === 'string' ? payload : payload.toString('utf8'));
    return hmac.digest('hex');
  }

  /**
   * Parse and validate webhook payload
   */
  parsePayload(rawPayload: string | Record<string, unknown>): EposnowWebhookPayload {
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as EposnowWebhookPayload
      : rawPayload as unknown as EposnowWebhookPayload;

    // Validate required fields
    if (!payload.Event || !payload.Timestamp || !payload.Data) {
      throw new EposnowWebhookError('Invalid webhook payload: missing required fields');
    }

    // Validate event type
    if (!this.isValidEvent(payload.Event)) {
      throw new EposnowWebhookError(`Unknown webhook event: ${payload.Event}`);
    }

    return payload;
  }

  /**
   * Handle webhook payload and extract stock change event
   */
  handleWebhook(payload: EposnowWebhookPayload): StockChangeEvent | null {
    switch (payload.Event) {
      case 'stock.updated':
        return this.handleStockUpdated(payload.Data as EposnowStockWebhookData, payload.Timestamp);

      case 'product.updated':
        return this.handleProductUpdated(payload.Data as EposnowProductWebhookData, payload.Timestamp);

      case 'product.created':
        return this.handleProductCreated(payload.Data as EposnowProductWebhookData, payload.Timestamp);

      case 'transaction.completed':
        return this.handleTransactionCompleted(payload.Data as EposnowTransactionWebhookData, payload.Timestamp);

      case 'product.deleted':
      case 'transaction.created':
      case 'transaction.voided':
        // These events don't result in stock changes we need to process
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle stock.updated webhook event
   */
  private handleStockUpdated(
    data: EposnowStockWebhookData,
    timestamp: string
  ): StockChangeEvent {
    return {
      source: 'eposnow',
      type: 'stock_update',
      productId: data.ProductId.toString(),
      previousQuantity: data.PreviousQuantity,
      newQuantity: data.NewQuantity,
      reason: data.Reason,
      timestamp: new Date(timestamp),
      metadata: {
        locationId: data.LocationId,
        adjustmentAmount: data.NewQuantity - data.PreviousQuantity,
      },
    };
  }

  /**
   * Handle product.updated webhook event
   */
  private handleProductUpdated(
    data: EposnowProductWebhookData,
    timestamp: string
  ): StockChangeEvent | null {
    if (!data.Product) {
      return null;
    }

    return {
      source: 'eposnow',
      type: 'product_update',
      productId: data.ProductId.toString(),
      sku: data.Product.SKU || undefined,
      newQuantity: data.Product.CurrentStockLevel,
      timestamp: new Date(timestamp),
      metadata: {
        productName: data.Product.Name,
        changeType: data.ChangeType,
      },
    };
  }

  /**
   * Handle product.created webhook event
   */
  private handleProductCreated(
    data: EposnowProductWebhookData,
    timestamp: string
  ): StockChangeEvent | null {
    if (!data.Product) {
      return null;
    }

    return {
      source: 'eposnow',
      type: 'product_update',
      productId: data.ProductId.toString(),
      sku: data.Product.SKU || undefined,
      previousQuantity: 0,
      newQuantity: data.Product.CurrentStockLevel,
      timestamp: new Date(timestamp),
      metadata: {
        productName: data.Product.Name,
        changeType: 'Created',
        isNew: true,
      },
    };
  }

  /**
   * Handle transaction.completed webhook event
   * This indicates a sale which affects stock
   */
  private handleTransactionCompleted(
    data: EposnowTransactionWebhookData,
    timestamp: string
  ): StockChangeEvent | null {
    if (!data.Transaction || !data.Transaction.Items?.length) {
      return null;
    }

    // For transactions with multiple items, we return the first item
    // In practice, you'd want to handle each item separately
    const firstItem = data.Transaction.Items[0];

    return {
      source: 'eposnow',
      type: 'sale',
      productId: firstItem.ProductId.toString(),
      newQuantity: -firstItem.Quantity, // Negative indicates stock reduction
      timestamp: new Date(timestamp),
      metadata: {
        transactionId: data.TransactionId,
        transactionNumber: data.Transaction.TransactionNumber,
        allItems: data.Transaction.Items.map((item) => ({
          productId: item.ProductId.toString(),
          productName: item.ProductName,
          quantity: item.Quantity,
          unitPrice: item.UnitPrice,
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
      sku: event.sku || `EPOS-${event.productId}`,
      quantity: event.newQuantity,
      source: 'eposnow',
      timestamp: event.timestamp,
    };
  }

  /**
   * Check if event type is valid
   */
  private isValidEvent(event: string): event is EposnowWebhookEvent {
    const validEvents: EposnowWebhookEvent[] = [
      'product.created',
      'product.updated',
      'product.deleted',
      'stock.updated',
      'transaction.created',
      'transaction.completed',
      'transaction.voided',
    ];
    return validEvents.includes(event as EposnowWebhookEvent);
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class EposnowWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EposnowWebhookError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createEposnowWebhookHandler(secretKey?: string): EposnowWebhookHandler {
  return new EposnowWebhookHandler(secretKey);
}
