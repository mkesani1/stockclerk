/**
 * Watcher Tests
 * Tests webhook parsing and event emission functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock types for webhook payloads
interface EposnowWebhookPayload {
  event: string;
  productId: string;
  sku?: string;
  stockLevel: number;
  previousStockLevel: number;
  timestamp: string;
  locationId?: string;
}

interface WixWebhookPayload {
  eventType: string;
  instanceId: string;
  data: {
    productId: string;
    inventory: {
      quantity: number;
      trackQuantity: boolean;
    };
  };
  timestamp: string;
}

interface OtterWebhookPayload {
  type: string;
  restaurantId: string;
  payload: {
    itemId: string;
    available: boolean;
    quantity?: number;
    reason?: string;
  };
  timestamp: string;
}

// WebhookWatcher class for testing
class WebhookWatcher extends EventEmitter {
  private channelType: 'eposnow' | 'wix' | 'deliveroo';

  constructor(channelType: 'eposnow' | 'wix' | 'deliveroo') {
    super();
    this.channelType = channelType;
  }

  parseEposnowWebhook(payload: EposnowWebhookPayload): {
    eventType: string;
    externalId: string;
    stockLevel: number;
    previousStockLevel: number;
    metadata: Record<string, unknown>;
  } {
    return {
      eventType: payload.event,
      externalId: payload.productId,
      stockLevel: payload.stockLevel,
      previousStockLevel: payload.previousStockLevel,
      metadata: {
        sku: payload.sku,
        timestamp: payload.timestamp,
        locationId: payload.locationId,
      },
    };
  }

  parseWixWebhook(payload: WixWebhookPayload): {
    eventType: string;
    externalId: string;
    stockLevel: number;
    metadata: Record<string, unknown>;
  } {
    return {
      eventType: payload.eventType,
      externalId: payload.data.productId,
      stockLevel: payload.data.inventory.quantity,
      metadata: {
        instanceId: payload.instanceId,
        trackQuantity: payload.data.inventory.trackQuantity,
        timestamp: payload.timestamp,
      },
    };
  }

  parseOtterWebhook(payload: OtterWebhookPayload): {
    eventType: string;
    externalId: string;
    available: boolean;
    stockLevel?: number;
    metadata: Record<string, unknown>;
  } {
    return {
      eventType: payload.type,
      externalId: payload.payload.itemId,
      available: payload.payload.available,
      stockLevel: payload.payload.quantity,
      metadata: {
        restaurantId: payload.restaurantId,
        reason: payload.payload.reason,
        timestamp: payload.timestamp,
      },
    };
  }

  processWebhook(rawPayload: unknown): void {
    let parsed;

    try {
      switch (this.channelType) {
        case 'eposnow':
          parsed = this.parseEposnowWebhook(rawPayload as EposnowWebhookPayload);
          break;
        case 'wix':
          parsed = this.parseWixWebhook(rawPayload as WixWebhookPayload);
          break;
        case 'deliveroo':
          parsed = this.parseOtterWebhook(rawPayload as OtterWebhookPayload);
          break;
      }

      this.emit('webhook', {
        channelType: this.channelType,
        ...parsed,
      });

      // Emit specific event types
      if (parsed.eventType) {
        this.emit(parsed.eventType, parsed);
      }
    } catch (error) {
      this.emit('error', error);
    }
  }
}

describe('WebhookWatcher', () => {
  describe('Eposnow Webhook Parsing', () => {
    let watcher: WebhookWatcher;

    beforeEach(() => {
      watcher = new WebhookWatcher('eposnow');
    });

    it('should parse stock_change event correctly', () => {
      const payload: EposnowWebhookPayload = {
        event: 'stock_change',
        productId: '12345',
        sku: 'SKU-001',
        stockLevel: 85,
        previousStockLevel: 100,
        timestamp: '2024-01-15T10:30:00Z',
        locationId: 'loc-001',
      };

      const parsed = watcher.parseEposnowWebhook(payload);

      expect(parsed.eventType).toBe('stock_change');
      expect(parsed.externalId).toBe('12345');
      expect(parsed.stockLevel).toBe(85);
      expect(parsed.previousStockLevel).toBe(100);
      expect(parsed.metadata.sku).toBe('SKU-001');
      expect(parsed.metadata.locationId).toBe('loc-001');
    });

    it('should emit webhook event when processing', () => {
      const webhookHandler = vi.fn();
      watcher.on('webhook', webhookHandler);

      const payload: EposnowWebhookPayload = {
        event: 'stock_change',
        productId: '12345',
        stockLevel: 85,
        previousStockLevel: 100,
        timestamp: new Date().toISOString(),
      };

      watcher.processWebhook(payload);

      expect(webhookHandler).toHaveBeenCalledWith(expect.objectContaining({
        channelType: 'eposnow',
        eventType: 'stock_change',
        externalId: '12345',
      }));
    });

    it('should emit specific event type', () => {
      const stockChangeHandler = vi.fn();
      watcher.on('stock_change', stockChangeHandler);

      const payload: EposnowWebhookPayload = {
        event: 'stock_change',
        productId: '12345',
        stockLevel: 85,
        previousStockLevel: 100,
        timestamp: new Date().toISOString(),
      };

      watcher.processWebhook(payload);

      expect(stockChangeHandler).toHaveBeenCalled();
    });

    it('should handle product_update event', () => {
      const payload: EposnowWebhookPayload = {
        event: 'product_update',
        productId: '12345',
        sku: 'SKU-001-NEW',
        stockLevel: 100,
        previousStockLevel: 100,
        timestamp: new Date().toISOString(),
      };

      const parsed = watcher.parseEposnowWebhook(payload);

      expect(parsed.eventType).toBe('product_update');
    });
  });

  describe('Wix Webhook Parsing', () => {
    let watcher: WebhookWatcher;

    beforeEach(() => {
      watcher = new WebhookWatcher('wix');
    });

    it('should parse inventory/updated event correctly', () => {
      const payload: WixWebhookPayload = {
        eventType: 'inventory/updated',
        instanceId: 'wix-instance-123',
        data: {
          productId: 'wix-prod-456',
          inventory: {
            quantity: 50,
            trackQuantity: true,
          },
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const parsed = watcher.parseWixWebhook(payload);

      expect(parsed.eventType).toBe('inventory/updated');
      expect(parsed.externalId).toBe('wix-prod-456');
      expect(parsed.stockLevel).toBe(50);
      expect(parsed.metadata.instanceId).toBe('wix-instance-123');
      expect(parsed.metadata.trackQuantity).toBe(true);
    });

    it('should emit webhook event for Wix', () => {
      const webhookHandler = vi.fn();
      watcher.on('webhook', webhookHandler);

      const payload: WixWebhookPayload = {
        eventType: 'inventory/updated',
        instanceId: 'wix-instance-123',
        data: {
          productId: 'wix-prod-456',
          inventory: {
            quantity: 50,
            trackQuantity: true,
          },
        },
        timestamp: new Date().toISOString(),
      };

      watcher.processWebhook(payload);

      expect(webhookHandler).toHaveBeenCalledWith(expect.objectContaining({
        channelType: 'wix',
        eventType: 'inventory/updated',
      }));
    });
  });

  describe('Otter/Deliveroo Webhook Parsing', () => {
    let watcher: WebhookWatcher;

    beforeEach(() => {
      watcher = new WebhookWatcher('deliveroo');
    });

    it('should parse item_availability_changed event correctly', () => {
      const payload: OtterWebhookPayload = {
        type: 'item_availability_changed',
        restaurantId: 'rest-123',
        payload: {
          itemId: 'item-001',
          available: true,
          quantity: 25,
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const parsed = watcher.parseOtterWebhook(payload);

      expect(parsed.eventType).toBe('item_availability_changed');
      expect(parsed.externalId).toBe('item-001');
      expect(parsed.available).toBe(true);
      expect(parsed.stockLevel).toBe(25);
      expect(parsed.metadata.restaurantId).toBe('rest-123');
    });

    it('should handle unavailable item with reason', () => {
      const payload: OtterWebhookPayload = {
        type: 'item_availability_changed',
        restaurantId: 'rest-123',
        payload: {
          itemId: 'item-001',
          available: false,
          reason: 'out_of_stock',
        },
        timestamp: new Date().toISOString(),
      };

      const parsed = watcher.parseOtterWebhook(payload);

      expect(parsed.available).toBe(false);
      expect(parsed.metadata.reason).toBe('out_of_stock');
      expect(parsed.stockLevel).toBeUndefined();
    });

    it('should emit webhook event for Otter', () => {
      const webhookHandler = vi.fn();
      watcher.on('webhook', webhookHandler);

      const payload: OtterWebhookPayload = {
        type: 'item_availability_changed',
        restaurantId: 'rest-123',
        payload: {
          itemId: 'item-001',
          available: true,
          quantity: 25,
        },
        timestamp: new Date().toISOString(),
      };

      watcher.processWebhook(payload);

      expect(webhookHandler).toHaveBeenCalledWith(expect.objectContaining({
        channelType: 'deliveroo',
        eventType: 'item_availability_changed',
      }));
    });
  });

  describe('Error Handling', () => {
    it('should emit error event for invalid payload', () => {
      const watcher = new WebhookWatcher('eposnow');
      const errorHandler = vi.fn();
      watcher.on('error', errorHandler);

      // Process with invalid payload that will cause parsing to throw
      const originalParse = watcher.parseEposnowWebhook;
      watcher.parseEposnowWebhook = () => {
        throw new Error('Invalid payload structure');
      };

      watcher.processWebhook({ invalid: 'data' });

      expect(errorHandler).toHaveBeenCalled();
      watcher.parseEposnowWebhook = originalParse;
    });

    it('should handle missing required fields gracefully', () => {
      const watcher = new WebhookWatcher('eposnow');

      const incompletePayload = {
        event: 'stock_change',
        // Missing productId, stockLevel, previousStockLevel
      } as EposnowWebhookPayload;

      const parsed = watcher.parseEposnowWebhook(incompletePayload);

      expect(parsed.externalId).toBeUndefined();
      expect(parsed.stockLevel).toBeUndefined();
    });
  });

  describe('Event Aggregation', () => {
    it('should allow multiple listeners for same event', () => {
      const watcher = new WebhookWatcher('eposnow');

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      watcher.on('webhook', handler1);
      watcher.on('webhook', handler2);

      watcher.processWebhook({
        event: 'stock_change',
        productId: '12345',
        stockLevel: 85,
        previousStockLevel: 100,
        timestamp: new Date().toISOString(),
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should support once listeners', () => {
      const watcher = new WebhookWatcher('eposnow');
      const onceHandler = vi.fn();

      watcher.once('webhook', onceHandler);

      // Process twice
      const payload = {
        event: 'stock_change',
        productId: '12345',
        stockLevel: 85,
        previousStockLevel: 100,
        timestamp: new Date().toISOString(),
      };

      watcher.processWebhook(payload);
      watcher.processWebhook(payload);

      expect(onceHandler).toHaveBeenCalledTimes(1);
    });
  });
});
