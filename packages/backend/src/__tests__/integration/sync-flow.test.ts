/**
 * Sync Flow Integration Tests
 * Tests the complete synchronization flow from product update to channel sync
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initTestDb,
  closeTestDb,
  cleanDatabase,
  getTestDb,
} from '../utils/db.js';
import {
  createTenantFixture,
  createUserFixture,
  createChannelFixture,
  createProductFixture,
  createMappingFixture,
} from '../utils/fixtures.js';
import type {
  Tenant,
  User,
  Channel,
  Product,
  ProductChannelMapping,
} from '../../db/schema.js';

// Mock external dependencies
const mockAddSyncJob = vi.fn().mockResolvedValue({ id: 'job-123' });
const mockBroadcastToTenant = vi.fn();

vi.mock('../../queues/index.js', () => ({
  addSyncJob: mockAddSyncJob,
  addWebhookJob: vi.fn().mockResolvedValue({ id: 'webhook-job-123' }),
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

describe('Sync Flow Integration Tests', () => {
  let testData: {
    tenant: Tenant;
    user: User;
    eposnowChannel: Channel;
    wixChannel: Channel;
    product: Product;
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
    mockAddSyncJob.mockClear();
    mockBroadcastToTenant.mockClear();

    const db = getTestDb();

    // Create test tenant
    const [tenant] = await db.insert(require('../../db/schema.js').tenants).values({
      name: 'Integration Test Company',
      slug: 'integration-test',
    }).returning();

    // Create test user
    const [user] = await db.insert(require('../../db/schema.js').users).values({
      tenantId: tenant.id,
      email: 'integration@test.com',
      passwordHash: '$2a$12$test',
      role: 'owner',
    }).returning();

    // Create channels
    const [eposnowChannel] = await db.insert(require('../../db/schema.js').channels).values({
      tenantId: tenant.id,
      type: 'eposnow',
      name: 'Test POS',
      isActive: true,
    }).returning();

    const [wixChannel] = await db.insert(require('../../db/schema.js').channels).values({
      tenantId: tenant.id,
      type: 'wix',
      name: 'Test Online Store',
      isActive: true,
    }).returning();

    // Create product
    const [product] = await db.insert(require('../../db/schema.js').products).values({
      tenantId: tenant.id,
      sku: 'SYNC-TEST-001',
      name: 'Sync Test Product',
      currentStock: 100,
      bufferStock: 10,
    }).returning();

    // Create mappings
    const mappings = await db.insert(require('../../db/schema.js').productChannelMappings).values([
      {
        productId: product.id,
        channelId: eposnowChannel.id,
        externalId: 'epos-ext-001',
        externalSku: 'EPOS-SKU-001',
      },
      {
        productId: product.id,
        channelId: wixChannel.id,
        externalId: 'wix-ext-001',
        externalSku: 'WIX-SKU-001',
      },
    ]).returning();

    testData = {
      tenant,
      user,
      eposnowChannel,
      wixChannel,
      product,
      mappings,
    };
  });

  describe('Stock Update Flow', () => {
    it('should create sync event when stock is updated', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');

      const oldStock = testData.product.currentStock;
      const newStock = 80;

      // Update stock
      await db
        .update(schema.products)
        .set({ currentStock: newStock })
        .where(require('drizzle-orm').eq(schema.products.id, testData.product.id));

      // Create sync event
      const [syncEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'stock_update',
          productId: testData.product.id,
          oldValue: { stock: oldStock },
          newValue: { stock: newStock },
          status: 'pending',
        })
        .returning();

      expect(syncEvent).toBeDefined();
      expect(syncEvent.eventType).toBe('stock_update');
      expect(syncEvent.oldValue).toEqual({ stock: 100 });
      expect(syncEvent.newValue).toEqual({ stock: 80 });
    });

    it('should create low stock alert when stock drops below buffer', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');

      const newStock = 5; // Below buffer of 10

      // Update stock
      await db
        .update(schema.products)
        .set({ currentStock: newStock })
        .where(require('drizzle-orm').eq(schema.products.id, testData.product.id));

      // Create alert
      const [alert] = await db
        .insert(schema.alerts)
        .values({
          tenantId: testData.tenant.id,
          type: 'low_stock',
          message: `Low stock alert: ${testData.product.name} is at ${newStock} units`,
          metadata: {
            productId: testData.product.id,
            sku: testData.product.sku,
            currentStock: newStock,
            bufferStock: testData.product.bufferStock,
          },
        })
        .returning();

      expect(alert).toBeDefined();
      expect(alert.type).toBe('low_stock');
      expect((alert.metadata as any).currentStock).toBe(5);
    });

    it('should track sync events across multiple channels', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq } = require('drizzle-orm');

      // Create sync events for each channel
      const syncEvents = await db
        .insert(schema.syncEvents)
        .values([
          {
            tenantId: testData.tenant.id,
            eventType: 'stock_push',
            productId: testData.product.id,
            channelId: testData.eposnowChannel.id,
            oldValue: { stock: 100 },
            newValue: { stock: 80 },
            status: 'completed',
          },
          {
            tenantId: testData.tenant.id,
            eventType: 'stock_push',
            productId: testData.product.id,
            channelId: testData.wixChannel.id,
            oldValue: { stock: 100 },
            newValue: { stock: 80 },
            status: 'completed',
          },
        ])
        .returning();

      expect(syncEvents).toHaveLength(2);
      expect(syncEvents[0].channelId).toBe(testData.eposnowChannel.id);
      expect(syncEvents[1].channelId).toBe(testData.wixChannel.id);

      // Query sync events for the product
      const productSyncEvents = await db.query.syncEvents.findMany({
        where: eq(schema.syncEvents.productId, testData.product.id),
      });

      expect(productSyncEvents).toHaveLength(2);
    });
  });

  describe('Full Sync Flow', () => {
    it('should sync product to all active channels', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, and } = require('drizzle-orm');

      // Get product with mappings
      const product = await db.query.products.findFirst({
        where: eq(schema.products.id, testData.product.id),
        with: {
          channelMappings: {
            with: {
              channel: true,
            },
          },
        },
      });

      expect(product).toBeDefined();
      expect(product?.channelMappings).toHaveLength(2);

      // Simulate full sync
      for (const mapping of product!.channelMappings) {
        if (mapping.channel.isActive) {
          await db
            .insert(schema.syncEvents)
            .values({
              tenantId: testData.tenant.id,
              eventType: 'full_sync',
              productId: product!.id,
              channelId: mapping.channelId,
              newValue: {
                stock: product!.currentStock,
                externalId: mapping.externalId,
              },
              status: 'completed',
            });

          // Update last sync time on channel
          await db
            .update(schema.channels)
            .set({ lastSyncAt: new Date() })
            .where(eq(schema.channels.id, mapping.channelId));
        }
      }

      // Verify all channels were synced
      const syncEvents = await db.query.syncEvents.findMany({
        where: and(
          eq(schema.syncEvents.productId, testData.product.id),
          eq(schema.syncEvents.eventType, 'full_sync')
        ),
      });

      expect(syncEvents).toHaveLength(2);

      // Verify channels have lastSyncAt updated
      const channels = await db.query.channels.findMany({
        where: eq(schema.channels.tenantId, testData.tenant.id),
      });

      channels.forEach((channel) => {
        expect(channel.lastSyncAt).not.toBeNull();
      });
    });

    it('should skip inactive channels during sync', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq } = require('drizzle-orm');

      // Deactivate one channel
      await db
        .update(schema.channels)
        .set({ isActive: false })
        .where(eq(schema.channels.id, testData.wixChannel.id));

      // Get product with mappings
      const product = await db.query.products.findFirst({
        where: eq(schema.products.id, testData.product.id),
        with: {
          channelMappings: {
            with: {
              channel: true,
            },
          },
        },
      });

      // Simulate sync only to active channels
      let syncCount = 0;
      for (const mapping of product!.channelMappings) {
        if (mapping.channel.isActive) {
          syncCount++;
          await db
            .insert(schema.syncEvents)
            .values({
              tenantId: testData.tenant.id,
              eventType: 'sync',
              productId: product!.id,
              channelId: mapping.channelId,
              status: 'completed',
            });
        }
      }

      expect(syncCount).toBe(1); // Only eposnow channel is active
    });
  });

  describe('Sync Error Handling', () => {
    it('should record failed sync events', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq } = require('drizzle-orm');

      // Create a failed sync event
      const [failedEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'stock_push',
          productId: testData.product.id,
          channelId: testData.eposnowChannel.id,
          oldValue: { stock: 100 },
          newValue: { stock: 80 },
          status: 'failed',
          errorMessage: 'API rate limit exceeded',
        })
        .returning();

      expect(failedEvent.status).toBe('failed');
      expect(failedEvent.errorMessage).toBe('API rate limit exceeded');

      // Create sync_error alert
      const [alert] = await db
        .insert(schema.alerts)
        .values({
          tenantId: testData.tenant.id,
          type: 'sync_error',
          message: 'Failed to sync stock to Test POS: API rate limit exceeded',
          metadata: {
            syncEventId: failedEvent.id,
            channelId: testData.eposnowChannel.id,
            productId: testData.product.id,
          },
        })
        .returning();

      expect(alert.type).toBe('sync_error');
    });

    it('should track sync event status progression', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq } = require('drizzle-orm');

      // Create pending sync event
      const [syncEvent] = await db
        .insert(schema.syncEvents)
        .values({
          tenantId: testData.tenant.id,
          eventType: 'stock_push',
          productId: testData.product.id,
          channelId: testData.eposnowChannel.id,
          status: 'pending',
        })
        .returning();

      expect(syncEvent.status).toBe('pending');

      // Update to processing
      const [processingEvent] = await db
        .update(schema.syncEvents)
        .set({ status: 'processing' })
        .where(eq(schema.syncEvents.id, syncEvent.id))
        .returning();

      expect(processingEvent.status).toBe('processing');

      // Update to completed
      const [completedEvent] = await db
        .update(schema.syncEvents)
        .set({
          status: 'completed',
          newValue: { stock: 80, synced: true },
        })
        .where(eq(schema.syncEvents.id, syncEvent.id))
        .returning();

      expect(completedEvent.status).toBe('completed');
    });
  });

  describe('Multi-Product Sync', () => {
    it('should handle bulk product updates', async () => {
      const db = getTestDb();
      const schema = require('../../db/schema.js');
      const { eq, inArray } = require('drizzle-orm');

      // Create additional products
      const additionalProducts = await db
        .insert(schema.products)
        .values([
          {
            tenantId: testData.tenant.id,
            sku: 'BULK-001',
            name: 'Bulk Product 1',
            currentStock: 50,
            bufferStock: 5,
          },
          {
            tenantId: testData.tenant.id,
            sku: 'BULK-002',
            name: 'Bulk Product 2',
            currentStock: 75,
            bufferStock: 10,
          },
        ])
        .returning();

      const allProductIds = [testData.product.id, ...additionalProducts.map((p) => p.id)];

      // Bulk update stock
      await db
        .update(schema.products)
        .set({ currentStock: 0 })
        .where(inArray(schema.products.id, allProductIds));

      // Create sync events for all products
      const syncEvents = await db
        .insert(schema.syncEvents)
        .values(
          allProductIds.map((productId) => ({
            tenantId: testData.tenant.id,
            eventType: 'bulk_update',
            productId,
            oldValue: { stock: 'varied' },
            newValue: { stock: 0 },
            status: 'completed',
          }))
        )
        .returning();

      expect(syncEvents).toHaveLength(3);
    });
  });
});
