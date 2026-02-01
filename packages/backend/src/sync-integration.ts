/**
 * Sync Engine Integration
 * Wires the sync-engine package to the backend, connecting:
 * - Database operations
 * - WebSocket broadcasts
 * - Queue processors
 * - Webhook routes
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from './db/index.js';
import {
  channels,
  products,
  productChannelMappings,
  syncEvents,
  alerts,
  tenants,
} from './db/schema.js';
import type { ChannelType, AlertType, SyncEventStatus } from './types/index.js';
import {
  emitSyncStarted,
  emitSyncCompleted,
  emitSyncError,
  emitStockUpdated,
  emitAlertNew,
  emitChannelStatus,
} from './websocket/index.js';
import {
  addWebhookJob,
  addSyncJob,
  registerWebhookWorker,
  registerSyncWorker,
  registerAlertWorker,
} from './queues/index.js';
import { getAlertRulesForTenant, getLowStockThresholds } from './routes/alerts.js';
import { updateAgentStatus } from './routes/dashboard.js';
import { createProvider } from '@stockclerk/integrations';
import type { ChannelCredentials as IntegrationCredentials } from '@stockclerk/integrations';
import { config } from './config/index.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncEngineDependencies {
  getProductMapping: (
    tenantId: string,
    channelId: string,
    externalId: string
  ) => Promise<{ productId: string; sku: string; currentStock: number } | null>;
  getChannel: (channelId: string) => Promise<Channel | null>;
  getChannels: (tenantId: string) => Promise<Channel[]>;
  getProduct: (productId: string) => Promise<Product | null>;
  getProductByExternalId: (
    tenantId: string,
    channelId: string,
    externalId: string
  ) => Promise<Product | null>;
  getProducts: (tenantId: string) => Promise<Product[]>;
  getProductMappings: (productId: string) => Promise<(ProductChannelMapping & { channel: Channel })[]>;
  updateProductStock: (productId: string, newStock: number) => Promise<void>;
  updateChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string,
    quantity: number
  ) => Promise<void>;
  getChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string
  ) => Promise<number | null>;
  createSyncEvent: (event: SyncEventRecord) => Promise<string>;
  updateSyncEventStatus: (
    eventId: string,
    status: SyncEventStatus,
    errorMessage?: string
  ) => Promise<void>;
  createAlert: (
    tenantId: string,
    type: AlertType,
    message: string,
    metadata?: Record<string, unknown>
  ) => Promise<string>;
  alertExists: (
    tenantId: string,
    type: AlertType,
    productId?: string,
    channelId?: string
  ) => Promise<boolean>;
  getAlertRules: (tenantId: string) => Promise<AlertRule[]>;
  checkChannelHealth: (channelId: string) => Promise<{
    connected: boolean;
    lastChecked: Date;
    error?: string;
  }>;
  getAllTenantIds: () => Promise<string[]>;
}

interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  credentialsEncrypted: string | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
}

interface Product {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  currentStock: number;
  bufferStock: number;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
  createdAt: Date;
}

interface ProductChannelMapping {
  id: string;
  productId: string;
  channelId: string;
  externalId: string;
  externalSku: string | null;
  createdAt: Date;
}

interface SyncEventRecord {
  id?: string;
  tenantId: string;
  eventType: string;
  channelId?: string;
  productId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  status: SyncEventStatus;
  errorMessage?: string;
  createdAt?: Date;
}

interface AlertRule {
  id: string;
  tenantId: string;
  type: AlertType;
  productId?: string;
  channelId?: string;
  threshold?: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Get a product-channel mapping by external ID
 */
async function getProductMapping(
  tenantId: string,
  channelId: string,
  externalId: string
): Promise<{ productId: string; sku: string; currentStock: number } | null> {
  const result = await db
    .select({
      productId: productChannelMappings.productId,
      sku: products.sku,
      currentStock: products.currentStock,
    })
    .from(productChannelMappings)
    .innerJoin(products, eq(productChannelMappings.productId, products.id))
    .where(
      and(
        eq(productChannelMappings.channelId, channelId),
        eq(productChannelMappings.externalId, externalId),
        eq(products.tenantId, tenantId)
      )
    )
    .limit(1);

  return result[0] || null;
}

/**
 * Get a channel by ID
 */
async function getChannel(channelId: string): Promise<Channel | null> {
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get all active channels for a tenant
 */
async function getChannels(tenantId: string): Promise<Channel[]> {
  return db
    .select()
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.isActive, true)));
}

/**
 * Get a product by ID
 */
async function getProduct(productId: string): Promise<Product | null> {
  const result = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get a product by external ID
 */
async function getProductByExternalId(
  tenantId: string,
  channelId: string,
  externalId: string
): Promise<Product | null> {
  const result = await db
    .select({
      product: products,
    })
    .from(productChannelMappings)
    .innerJoin(products, eq(productChannelMappings.productId, products.id))
    .where(
      and(
        eq(productChannelMappings.channelId, channelId),
        eq(productChannelMappings.externalId, externalId),
        eq(products.tenantId, tenantId)
      )
    )
    .limit(1);

  return result[0]?.product || null;
}

/**
 * Get all products for a tenant
 */
async function getProducts(tenantId: string): Promise<Product[]> {
  return db.select().from(products).where(eq(products.tenantId, tenantId));
}

/**
 * Get all channel mappings for a product
 */
async function getProductMappings(
  productId: string
): Promise<(ProductChannelMapping & { channel: Channel })[]> {
  const result = await db
    .select({
      id: productChannelMappings.id,
      productId: productChannelMappings.productId,
      channelId: productChannelMappings.channelId,
      externalId: productChannelMappings.externalId,
      externalSku: productChannelMappings.externalSku,
      createdAt: productChannelMappings.createdAt,
      channel: channels,
    })
    .from(productChannelMappings)
    .innerJoin(channels, eq(productChannelMappings.channelId, channels.id))
    .where(eq(productChannelMappings.productId, productId));

  return result.map((r) => ({
    id: r.id,
    productId: r.productId,
    channelId: r.channelId,
    externalId: r.externalId,
    externalSku: r.externalSku,
    createdAt: r.createdAt,
    channel: r.channel,
  }));
}

/**
 * Update product stock in the database
 */
async function updateProductStock(productId: string, newStock: number): Promise<void> {
  const product = await getProduct(productId);
  if (!product) return;

  const oldStock = product.currentStock;

  await db
    .update(products)
    .set({
      currentStock: newStock,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  // Emit WebSocket event
  emitStockUpdated(product.tenantId, {
    productId,
    sku: product.sku,
    productName: product.name,
    oldStock,
    newStock,
  });
}

/**
 * Update stock on an external channel
 */
async function updateChannelStock(
  channelId: string,
  channelType: ChannelType,
  externalId: string,
  quantity: number
): Promise<void> {
  const channel = await getChannel(channelId);
  if (!channel || !channel.credentialsEncrypted) {
    throw new Error(`Channel ${channelId} not found or has no credentials`);
  }

  try {
    // Decrypt credentials (simplified - in production use proper encryption)
    const credentials = JSON.parse(channel.credentialsEncrypted) as IntegrationCredentials;
    credentials.type = channelType;

    // Create provider and update stock
    const provider = createProvider(channelType);
    await provider.connect(credentials);
    await provider.updateStock(externalId, quantity);
    await provider.disconnect();

    // Update last sync time
    await db
      .update(channels)
      .set({ lastSyncAt: new Date() })
      .where(eq(channels.id, channelId));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to update channel stock: ${errorMessage}`);
    throw error;
  }
}

/**
 * Get current stock from an external channel
 */
async function getChannelStock(
  channelId: string,
  channelType: ChannelType,
  externalId: string
): Promise<number | null> {
  const channel = await getChannel(channelId);
  if (!channel || !channel.credentialsEncrypted) {
    return null;
  }

  try {
    const credentials = JSON.parse(channel.credentialsEncrypted) as IntegrationCredentials;
    credentials.type = channelType;

    const provider = createProvider(channelType);
    await provider.connect(credentials);
    const product = await provider.getProduct(externalId);
    await provider.disconnect();

    return product?.quantity ?? null;
  } catch (error) {
    console.error(`Failed to get channel stock: ${error}`);
    return null;
  }
}

/**
 * Create a sync event record
 */
async function createSyncEvent(event: SyncEventRecord): Promise<string> {
  const result = await db
    .insert(syncEvents)
    .values({
      tenantId: event.tenantId,
      eventType: event.eventType,
      channelId: event.channelId,
      productId: event.productId,
      oldValue: event.oldValue,
      newValue: event.newValue,
      status: event.status,
      errorMessage: event.errorMessage,
    })
    .returning({ id: syncEvents.id });

  return result[0].id;
}

/**
 * Update sync event status
 */
async function updateSyncEventStatus(
  eventId: string,
  status: SyncEventStatus,
  errorMessage?: string
): Promise<void> {
  await db
    .update(syncEvents)
    .set({
      status,
      errorMessage,
    })
    .where(eq(syncEvents.id, eventId));
}

/**
 * Create an alert
 */
async function createAlert(
  tenantId: string,
  type: AlertType,
  message: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const result = await db
    .insert(alerts)
    .values({
      tenantId,
      type,
      message,
      metadata,
    })
    .returning({ id: alerts.id });

  // Emit WebSocket event
  emitAlertNew(tenantId, {
    alertId: result[0].id,
    type,
    message,
    metadata,
  });

  return result[0].id;
}

/**
 * Check if an alert already exists
 */
async function alertExists(
  tenantId: string,
  type: AlertType,
  productId?: string,
  channelId?: string
): Promise<boolean> {
  const conditions = [eq(alerts.tenantId, tenantId), eq(alerts.type, type), eq(alerts.isRead, false)];

  const result = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(...conditions))
    .limit(1);

  if (result.length === 0) return false;

  // Check metadata for product/channel match
  if (productId || channelId) {
    const alertResult = await db
      .select()
      .from(alerts)
      .where(and(...conditions));

    return alertResult.some((alert) => {
      const meta = alert.metadata as Record<string, unknown> | null;
      if (productId && meta?.productId !== productId) return false;
      if (channelId && meta?.channelId !== channelId) return false;
      return true;
    });
  }

  return true;
}

/**
 * Get alert rules for a tenant
 */
async function getAlertRules(tenantId: string): Promise<AlertRule[]> {
  try {
    const rules = await getAlertRulesForTenant(tenantId);
    return rules;
  } catch {
    // Return default rules if none exist
    const thresholds = await getLowStockThresholds(tenantId);
    return thresholds.map((t) => ({
      id: `default-${t.productId || 'all'}`,
      tenantId,
      type: 'low_stock' as AlertType,
      productId: t.productId,
      threshold: t.threshold,
      enabled: true,
    }));
  }
}

/**
 * Check channel health
 */
async function checkChannelHealth(
  channelId: string
): Promise<{ connected: boolean; lastChecked: Date; error?: string }> {
  const channel = await getChannel(channelId);
  if (!channel) {
    return {
      connected: false,
      lastChecked: new Date(),
      error: 'Channel not found',
    };
  }

  if (!channel.isActive) {
    return {
      connected: false,
      lastChecked: new Date(),
      error: 'Channel is inactive',
    };
  }

  if (!channel.credentialsEncrypted) {
    return {
      connected: false,
      lastChecked: new Date(),
      error: 'No credentials configured',
    };
  }

  try {
    const credentials = JSON.parse(channel.credentialsEncrypted) as IntegrationCredentials;
    credentials.type = channel.type;

    const provider = createProvider(channel.type);
    await provider.connect(credentials);
    const health = await provider.healthCheck();
    await provider.disconnect();

    return {
      connected: health.connected,
      lastChecked: health.lastChecked,
      error: health.error,
    };
  } catch (error) {
    return {
      connected: false,
      lastChecked: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get all tenant IDs
 */
async function getAllTenantIds(): Promise<string[]> {
  const result = await db.select({ id: tenants.id }).from(tenants);
  return result.map((t) => t.id);
}

// ============================================================================
// Sync Engine Dependencies Export
// ============================================================================

export const syncEngineDependencies: SyncEngineDependencies = {
  getProductMapping,
  getChannel,
  getChannels,
  getProduct,
  getProductByExternalId,
  getProducts,
  getProductMappings,
  updateProductStock,
  updateChannelStock,
  getChannelStock,
  createSyncEvent,
  updateSyncEventStatus,
  createAlert,
  alertExists,
  getAlertRules,
  checkChannelHealth,
  getAllTenantIds,
};

// ============================================================================
// Queue Job Processors
// ============================================================================

/**
 * Process webhook jobs
 */
export async function processWebhookJob(job: {
  data: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    eventType: string;
    payload: Record<string, unknown>;
  };
}): Promise<void> {
  const { tenantId, channelId, channelType, eventType, payload } = job.data;

  console.log(`[WebhookProcessor] Processing webhook for tenant ${tenantId}, channel ${channelId}`);

  try {
    // Get channel and validate
    const channel = await getChannel(channelId);
    if (!channel) {
      console.error(`Channel ${channelId} not found`);
      return;
    }

    // Create provider and handle webhook
    const provider = createProvider(channelType);
    const stockChanges = await provider.handleWebhook(payload);

    if (!stockChanges) {
      console.log(`No stock changes detected from webhook`);
      return;
    }

    const changes = Array.isArray(stockChanges) ? stockChanges : [stockChanges];

    // Process each stock change
    for (const change of changes) {
      const mapping = await getProductMapping(tenantId, channelId, change.externalId);

      if (mapping) {
        // Update product stock
        await updateProductStock(mapping.productId, change.newQuantity);

        // Create sync event
        await createSyncEvent({
          tenantId,
          eventType: 'stock_update',
          channelId,
          productId: mapping.productId,
          oldValue: { stock: mapping.currentStock },
          newValue: { stock: change.newQuantity },
          status: 'completed',
        });

        // Add sync job to propagate to other channels
        await addSyncJob({
          tenantId,
          channelId,
          channelType,
          operation: 'push_update',
          productIds: [mapping.productId],
        });
      }
    }
  } catch (error) {
    console.error(`[WebhookProcessor] Error:`, error);
    throw error;
  }
}

/**
 * Process sync jobs
 */
export async function processSyncJob(job: {
  data: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    operation: string;
    productIds?: string[];
  };
}): Promise<void> {
  const { tenantId, channelId, channelType, operation, productIds } = job.data;

  console.log(`[SyncProcessor] Processing ${operation} for tenant ${tenantId}`);

  const channel = await getChannel(channelId);
  if (!channel) {
    console.error(`Channel ${channelId} not found`);
    return;
  }

  // Emit sync started
  emitSyncStarted(tenantId, {
    channelId,
    channelName: channel.name,
    channelType,
    operation,
  });

  const startTime = Date.now();
  let productsUpdated = 0;

  try {
    if (operation === 'push_update' && productIds) {
      // Get all mappings for products and update each channel
      for (const productId of productIds) {
        const product = await getProduct(productId);
        if (!product) continue;

        const mappings = await getProductMappings(productId);
        for (const mapping of mappings) {
          // Skip the source channel
          if (mapping.channelId === channelId) continue;

          try {
            // Calculate stock for online channels (apply buffer)
            let stockToSync = product.currentStock;
            if (mapping.channel.type === 'wix' || mapping.channel.type === 'deliveroo') {
              stockToSync = Math.max(0, product.currentStock - product.bufferStock);
            }

            await updateChannelStock(
              mapping.channelId,
              mapping.channel.type,
              mapping.externalId,
              stockToSync
            );
            productsUpdated++;
          } catch (error) {
            console.error(`Failed to update channel ${mapping.channelId}:`, error);
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    // Emit sync completed
    emitSyncCompleted(tenantId, {
      syncEventId: job.data.tenantId,
      channelId,
      channelName: channel.name,
      channelType,
      productsUpdated,
      duration,
    });

    // Update agent status
    updateAgentStatus('sync', {
      state: 'running',
      lastActivity: new Date(),
      processedCount: productsUpdated,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    emitSyncError(tenantId, {
      channelId,
      channelName: channel.name,
      channelType,
      error: errorMessage,
      retryable: true,
    });

    throw error;
  }
}

/**
 * Process alert jobs
 */
export async function processAlertJob(job: {
  data: {
    tenantId: string;
    checkType: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
    productId?: string;
    channelId?: string;
    threshold?: number;
  };
}): Promise<void> {
  const { tenantId, checkType, productId, threshold } = job.data;

  console.log(`[AlertProcessor] Checking ${checkType} for tenant ${tenantId}`);

  if (checkType === 'low_stock' || checkType === 'all') {
    const productList = productId
      ? [await getProduct(productId)].filter(Boolean)
      : await getProducts(tenantId);

    for (const product of productList) {
      if (!product) continue;

      const lowThreshold = threshold ?? product.bufferStock + 5;

      if (product.currentStock <= lowThreshold) {
        const exists = await alertExists(tenantId, 'low_stock', product.id);
        if (!exists) {
          await createAlert(tenantId, 'low_stock', `Low stock alert: ${product.name} has only ${product.currentStock} units`, {
            productId: product.id,
            sku: product.sku,
            currentStock: product.currentStock,
            threshold: lowThreshold,
          });
        }
      }
    }
  }

  if (checkType === 'channel_status' || checkType === 'all') {
    const channelList = await getChannels(tenantId);

    for (const channel of channelList) {
      const health = await checkChannelHealth(channel.id);

      if (!health.connected) {
        const exists = await alertExists(tenantId, 'channel_disconnected', undefined, channel.id);
        if (!exists) {
          await createAlert(tenantId, 'channel_disconnected', `Channel disconnected: ${channel.name}`, {
            channelId: channel.id,
            channelType: channel.type,
            error: health.error,
          });

          emitChannelStatus(tenantId, {
            channelId: channel.id,
            channelName: channel.name,
            channelType: channel.type,
            status: 'disconnected',
            message: health.error,
          });
        }
      }
    }
  }

  updateAgentStatus('alert', {
    state: 'running',
    lastActivity: new Date(),
  });
}

// ============================================================================
// Worker Registration
// ============================================================================

let workersInitialized = false;

/**
 * Initialize queue workers for sync engine
 */
export function initializeSyncEngineWorkers(): void {
  if (workersInitialized) {
    console.log('[SyncIntegration] Workers already initialized');
    return;
  }

  try {
    registerWebhookWorker(async (job) => {
      await processWebhookJob(job);
    });

    registerSyncWorker(async (job) => {
      await processSyncJob(job);
    });

    registerAlertWorker(async (job) => {
      await processAlertJob(job);
    });

    workersInitialized = true;
    console.log('[SyncIntegration] Queue workers initialized');
  } catch (error) {
    console.error('[SyncIntegration] Failed to initialize workers:', error);
  }
}

// ============================================================================
// Guardian Reconciliation Scheduler
// ============================================================================

let reconciliationInterval: NodeJS.Timeout | null = null;

/**
 * Start the guardian reconciliation schedule
 */
export function startGuardianSchedule(intervalMs = 15 * 60 * 1000): void {
  if (reconciliationInterval) {
    console.log('[SyncIntegration] Guardian schedule already running');
    return;
  }

  console.log(`[SyncIntegration] Starting guardian schedule (interval: ${intervalMs}ms)`);

  reconciliationInterval = setInterval(async () => {
    console.log('[Guardian] Running scheduled reconciliation');

    try {
      const tenantIds = await getAllTenantIds();

      for (const tenantId of tenantIds) {
        const channelList = await getChannels(tenantId);
        const productList = await getProducts(tenantId);

        for (const product of productList) {
          const mappings = await getProductMappings(product.id);

          for (const mapping of mappings) {
            const channelStock = await getChannelStock(
              mapping.channelId,
              mapping.channel.type,
              mapping.externalId
            );

            if (channelStock !== null) {
              // Calculate expected stock
              let expectedStock = product.currentStock;
              if (mapping.channel.type === 'wix' || mapping.channel.type === 'deliveroo') {
                expectedStock = Math.max(0, product.currentStock - product.bufferStock);
              }

              // Check for drift
              const drift = Math.abs(channelStock - expectedStock);
              if (drift > 0) {
                console.log(
                  `[Guardian] Drift detected for product ${product.sku} on ${mapping.channel.name}: expected ${expectedStock}, got ${channelStock}`
                );

                // Auto-repair small drifts
                if (drift <= 5) {
                  await updateChannelStock(
                    mapping.channelId,
                    mapping.channel.type,
                    mapping.externalId,
                    expectedStock
                  );
                  console.log(`[Guardian] Auto-repaired drift for ${product.sku}`);
                } else {
                  // Create alert for large drifts
                  await createAlert(tenantId, 'sync_error', `Large stock drift detected for ${product.name} on ${mapping.channel.name}`, {
                    productId: product.id,
                    channelId: mapping.channelId,
                    expectedStock,
                    actualStock: channelStock,
                    drift,
                  });
                }
              }
            }
          }
        }
      }

      updateAgentStatus('guardian', {
        state: 'running',
        lastActivity: new Date(),
      });
    } catch (error) {
      console.error('[Guardian] Reconciliation error:', error);
    }
  }, intervalMs);
}

/**
 * Stop the guardian reconciliation schedule
 */
export function stopGuardianSchedule(): void {
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
    console.log('[SyncIntegration] Guardian schedule stopped');
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the sync engine integration
 */
export function initializeSyncEngineIntegration(): void {
  console.log('[SyncIntegration] Initializing...');

  // Initialize workers
  initializeSyncEngineWorkers();

  // Start guardian schedule
  startGuardianSchedule();

  console.log('[SyncIntegration] Initialization complete');
}

/**
 * Cleanup the sync engine integration
 */
export function cleanupSyncEngineIntegration(): void {
  stopGuardianSchedule();
  console.log('[SyncIntegration] Cleanup complete');
}

export default {
  syncEngineDependencies,
  initializeSyncEngineIntegration,
  cleanupSyncEngineIntegration,
  processWebhookJob,
  processSyncJob,
  processAlertJob,
};
