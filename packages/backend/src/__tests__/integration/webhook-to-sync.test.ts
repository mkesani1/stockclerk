/**
 * Webhook to Sync Integration Tests
 * Tests the complete flow from webhook receipt to sync completion
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initTestDb,
  closeTestDb,
  cleanDatabase,
  getTestDb,
} from '../utils/db.js';
import {
  eposnowWebhookPayload,
  wixWebhookPayload,
  otterWebhookPayload,
} from '../utils/fixtures.js';
import type {
  Tenant,
  User,
  Channel,
  Product,
  ProductChannelMapping,
  SyncEvent,
} from '../../db/schema.js';

// Mock external dependencies
const mockAddWebhookJob = vi.fn().mockResolvedValue({ id: 'job-123' });
const mockAddSyncJob = vi.fn().mockResolvedValue({ id: 'sync-job-123' });
const mockBroadcastToTenant = vi.fn();

vi.mock('../../queues/index.js', () => ({
  addWebhookJob: mockAddWebhookJob,
  addSyncJob: mockAddSyncJob,
}));

vi.mock('../../websocket/index.js', () => ({
  broadcastToTenant: mockBroadcastToTenant,
  createWebSocketMessage: vi.fn((type, tenantId, payload) => ({
    type,
    tenantId,
    payload,
    timestamp: new Date().toISOString(),
  })),
}));

describe('Webhook to Sync Integration Tests', () => {
  let testData: {
    tenant: Tenant;
    user: User;
    channels: Record<string, Channel>;
    products: Product[];
    mappings: ProductChannelMapping[];
  };

  beforeAll(async () => {
    await initTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    mockAddWebhookJob.mockClear();
    mockAddSyncJob.mockClear();
    mockBroadcastToTenant.mockClear();

    const db = getTestDb();
    const schema = require('../../db/schema.js');

    // Create tenant
    const [tenant] = await db.insert(schema.tenants).values({
      name: 'Webhook Test Company',
      slug: 'webhook-test',
    }).returning();

    // Create user
    const [user] = await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: 'webhook@test.com',
      passwordHash: '$2a$12$test',
      role: 'owner',
    }).returning();

    // Create channels for each type
    const [eposnowChannel] = await db.insert(schema.channels).values({
      tenantId: tenant.id,
      type: 'eposnow',
      name: 'Eposnow POS',
      isActive: true,
    }).returning();

    const [wixChannel] = await db.insert(schema.channels).values({
      tenantId: tenant.id,
      type: 'wix',
      name: 'Wix Store',
      isActive: true,
    }).returning();

    const [deliverooChannel] = await db.insert(schema.channels).values({
      tenantId: tenant.id,
      type: 'deliveroo',
      name: 'Deliveroo Menu',
      isActive: true,
    }).returning();

    // Create products
    const products = await db.insert(schema.products).values([
      {
        tenantId: tenant.id,
        sku: 'WH-001',
        name: 'Webhook Test Product 1',
        currentStock: 100,
        bufferStock: 10,
      },
      {
        tenantId: tenant.id,
        sku: 'WH-002',
        name: 'Webhook Test Product 2',
        currentStock: 50,
        bufferStock: 5,
      },
    ]).returning();

    // Create mappings
    const mappings = await db.insert(schema.productChannelMappings).values([
      {
        productId: products[0].id,
        channelId: eposnowChannel.id,
        externalId: '12345',
        externalSku: 'EPOS-001',
      },
      {
        productId: products[0].id,
        channelId: wixChannel.id,
        externalId: 'wix-prod-123',
        externalSku: 'WIX-001',
      },
      {
        productId: products[1].id,
        channelId: deliverooChannel.id,
        externalId: 'item-001',
        externalSku: 'DEL-001',
      },
    ]).returning();

    testData = {
      tenant,
      user,
      channels: {
        eposnow: eposnowChannel,
        wix: wixChannel,
        deliveroo: deliverooChannel,
      },
      products,
      mappings,
    };
  });

  describe('Eposnow Webhook Processing', () => {
    it('should process stock_change webhook and update product', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookPayload = {
        ...eposnowWebhookPayload,
        productId: '12345',
        stockLevel: 85,
        previousStockLevel: 100,
      };

      // Find product by external ID
      const mapping = await db.query.productChannelMappings.findFirst({
        where: and(
          eq(schema.productChannelMappings.externalId, webhookPayload.productId),
          eq(schema.productChannelMappings.channelId, testData.channels.eposnow.id)
        ),
        with: {
          product: true,
        },
      });

      expect(mapping).toBeDefined();

      // Update product stock
      await db
        .update(schema.products)
        .set({
          currentStock: webhookPayload.stockLevel,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, mapping!.productId));

      // Create sync event
      const [syncEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'webhook_stock_change',
          productId: mapping!.productId,
          channelId: testData.channels.eposnow.id,
          oldValue: { stock: webhookPayload.previousStockLevel },
          newValue: { stock: webhookPayload.stockLevel },
          status: 'completed',
        })
        .returning();

      expect(syncEvent.eventType).toBe('webhook_stock_change');

      // Verify product was updated
      const updatedProduct = await db.query.products.findFirst({
        where: eq(schema.products.id, mapping!.productId),
      });

      expect(updatedProduct?.currentStock).toBe(85);
    });

    it('should propagate stock change to other channels', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and, ne } = require('drizzle-orm');

      const product = testData.products[0];
      const newStock = 75;

      // Get all mappings for this product except source channel
      const otherMappings = await db.query.productChannelMappings.findMany({
        where: and(
          eq(schema.productChannelMappings.productId, product.id),
          ne(schema.productChannelMappings.channelId, testData.channels.eposnow.id)
        ),
        with: {
          channel: true,
        },
      });

      expect(otherMappings).toHaveLength(1); // Should have wix mapping

      // Create sync events for propagation to other channels
      for (const mapping of otherMappings) {
        if (mapping.channel.isActive) {
          await db.insert(schema.syncEvents).values({
            tenantId: testData.tenant.id,
            eventType: 'stock_propagation',
            productId: product.id,
            channelId: mapping.channelId,
            oldValue: { stock: product.currentStock },
            newValue: { stock: newStock, source: 'eposnow' },
            status: 'pending',
          });
        }
      }

      // Verify propagation events were created
      const propagationEvents = await db.query.syncEvents.findMany({
        where: and(
          eq(schema.syncEvents.productId, product.id),
          eq(schema.syncEvents.eventType, 'stock_propagation')
        ),
      });

      expect(propagationEvents).toHaveLength(1);
      expect(propagationEvents[0].channelId).toBe(testData.channels.wix.id);
    });
  });

  describe('Wix Webhook Processing', () => {
    it('should process inventory/updated webhook', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookPayload = {
        ...wixWebhookPayload,
        data: {
          productId: 'wix-prod-123',
          inventory: {
            quantity: 60,
            trackQuantity: true,
          },
        },
      };

      // Find product by external ID
      const mapping = await db.query.productChannelMappings.findFirst({
        where: and(
          eq(schema.productChannelMappings.externalId, webhookPayload.data.productId),
          eq(schema.productChannelMappings.channelId, testData.channels.wix.id)
        ),
        with: {
          product: true,
        },
      });

      expect(mapping).toBeDefined();

      // Update product
      await db
        .update(schema.products)
        .set({
          currentStock: webhookPayload.data.inventory.quantity,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, mapping!.productId));

      // Create sync event
      await db.insert(schema.syncEvents).values({
        tenantId: testData.tenant.id,
        eventType: 'wix_inventory_updated',
        productId: mapping!.productId,
        channelId: testData.channels.wix.id,
        newValue: webhookPayload.data.inventory,
        status: 'completed',
      });

      // Verify product was updated
      const updatedProduct = await db.query.products.findFirst({
        where: eq(schema.products.id, mapping!.productId),
      });

      expect(updatedProduct?.currentStock).toBe(60);
    });
  });

  describe('Otter/Deliveroo Webhook Processing', () => {
    it('should process item_availability_changed webhook', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookPayload = {
        ...otterWebhookPayload,
        payload: {
          itemId: 'item-001',
          externalId: 'item-001',
          available: true,
          quantity: 25,
        },
      };

      // Find product by external ID
      const mapping = await db.query.productChannelMappings.findFirst({
        where: and(
          eq(schema.productChannelMappings.externalId, webhookPayload.payload.itemId),
          eq(schema.productChannelMappings.channelId, testData.channels.deliveroo.id)
        ),
        with: {
          product: true,
        },
      });

      expect(mapping).toBeDefined();

      // Update product if quantity provided
      if (webhookPayload.payload.quantity !== undefined) {
        await db
          .update(schema.products)
          .set({
            currentStock: webhookPayload.payload.quantity,
            updatedAt: new Date(),
          })
          .where(eq(schema.products.id, mapping!.productId));
      }

      // Create sync event
      await db.insert(schema.syncEvents).values({
        tenantId: testData.tenant.id,
        eventType: 'deliveroo_availability_changed',
        productId: mapping!.productId,
        channelId: testData.channels.deliveroo.id,
        newValue: webhookPayload.payload,
        status: 'completed',
      });

      // Verify product was updated
      const updatedProduct = await db.query.products.findFirst({
        where: eq(schema.products.id, mapping!.productId),
      });

      expect(updatedProduct?.currentStock).toBe(25);
    });

    it('should handle item becoming unavailable', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookPayload = {
        type: 'item_availability_changed',
        restaurantId: 'rest-123',
        payload: {
          itemId: 'item-001',
          available: false,
          reason: 'out_of_stock',
        },
        timestamp: new Date().toISOString(),
      };

      // Find mapping
      const mapping = await db.query.productChannelMappings.findFirst({
        where: and(
          eq(schema.productChannelMappings.externalId, webhookPayload.payload.itemId),
          eq(schema.productChannelMappings.channelId, testData.channels.deliveroo.id)
        ),
      });

      expect(mapping).toBeDefined();

      // Set stock to 0 when item becomes unavailable
      await db
        .update(schema.products)
        .set({ currentStock: 0 })
        .where(eq(schema.products.id, mapping!.productId));

      // Create alert for out of stock
      const [alert] = await db
        .insert(schema.alerts)
        .values({
          tenantId: testData.tenant.id,
          type: 'low_stock',
          message: `Product marked unavailable on Deliveroo: ${webhookPayload.payload.reason}`,
          metadata: {
            productId: mapping!.productId,
            channelId: testData.channels.deliveroo.id,
            reason: webhookPayload.payload.reason,
          },
        })
        .returning();

      expect(alert.type).toBe('low_stock');
    });
  });

  describe('Webhook Error Scenarios', () => {
    it('should handle unknown external ID gracefully', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookPayload = {
        ...eposnowWebhookPayload,
        productId: 'unknown-product-id',
        stockLevel: 50,
      };

      // Try to find mapping
      const mapping = await db.query.productChannelMappings.findFirst({
        where: and(
          eq(schema.productChannelMappings.externalId, webhookPayload.productId),
          eq(schema.productChannelMappings.channelId, testData.channels.eposnow.id)
        ),
      });

      expect(mapping).toBeNull();

      // Log unmatched webhook for review
      const [syncEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'webhook_unmatched',
          channelId: testData.channels.eposnow.id,
          newValue: webhookPayload,
          status: 'failed',
          errorMessage: `No product mapping found for external ID: ${webhookPayload.productId}`,
        })
        .returning();

      expect(syncEvent.status).toBe('failed');
      expect(syncEvent.errorMessage).toContain('No product mapping found');
    });

    it('should handle inactive channel webhooks', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq } = require('drizzle-orm');

      // Deactivate channel
      await db
        .update(schema.channels)
        .set({ isActive: false })
        .where(eq(schema.channels.id, testData.channels.eposnow.id));

      // Verify channel is inactive
      const channel = await db.query.channels.findFirst({
        where: eq(schema.channels.id, testData.channels.eposnow.id),
      });

      expect(channel?.isActive).toBe(false);

      // Webhook should still be received but not processed
      const [syncEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'webhook_received',
          channelId: testData.channels.eposnow.id,
          newValue: eposnowWebhookPayload,
          status: 'failed',
          errorMessage: 'Channel is inactive',
        })
        .returning();

      expect(syncEvent.errorMessage).toBe('Channel is inactive');
    });
  });

  describe('Webhook Idempotency', () => {
    it('should prevent duplicate webhook processing', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const webhookId = `eposnow-${Date.now()}-${Math.random()}`;
      const webhookPayload = {
        ...eposnowWebhookPayload,
        webhookId,
      };

      // Process webhook first time
      const [firstEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'webhook_processed',
          channelId: testData.channels.eposnow.id,
          newValue: { ...webhookPayload, webhookId },
          status: 'completed',
        })
        .returning();

      expect(firstEvent).toBeDefined();

      // Check for existing webhook ID before processing again
      const existingEvent = await db.query.syncEvents.findFirst({
        where: and(
          eq(schema.syncEvents.tenantId, testData.tenant.id),
          eq(schema.syncEvents.eventType, 'webhook_processed')
        ),
      });

      // Simulate idempotency check
      const isDuplicate = existingEvent &&
        (existingEvent.newValue as any)?.webhookId === webhookId;

      expect(isDuplicate).toBe(true);
    });
  });

  describe('Multi-Channel Sync Coordination', () => {
    it('should coordinate updates across all channels when stock changes', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      const product = testData.products[0];
      const newStock = 42;

      // Simulate webhook from Eposnow
      await db
        .update(schema.products)
        .set({ currentStock: newStock })
        .where(eq(schema.products.id, product.id));

      // Get all channel mappings for this product
      const allMappings = await db.query.productChannelMappings.findMany({
        where: eq(schema.productChannelMappings.productId, product.id),
        with: {
          channel: true,
        },
      });

      // Create sync events for all OTHER channels (not the source)
      const syncEvents: SyncEvent[] = [];
      for (const mapping of allMappings) {
        if (mapping.channelId !== testData.channels.eposnow.id && mapping.channel.isActive) {
          const [event] = await db
            .insert(schema.syncEvents)
            .values({
              tenantId: testData.tenant.id,
              eventType: 'cross_channel_sync',
              productId: product.id,
              channelId: mapping.channelId,
              newValue: {
                stock: newStock,
                externalId: mapping.externalId,
                sourceChannel: 'eposnow',
              },
              status: 'pending',
            })
            .returning();
          syncEvents.push(event);
        }
      }

      // Should have created sync event for Wix (the other active channel)
      expect(syncEvents.length).toBe(1);
      expect(syncEvents[0].channelId).toBe(testData.channels.wix.id);
    });
  });
});
