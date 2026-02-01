/**
 * Sync Agent
 * Receives stock:change events from Watcher, performs multi-channel atomic updates,
 * applies buffer stock rules, handles conflict resolution, and creates audit trails.
 */

import { Worker, Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SyncEngineEventBus } from '../events.js';
import type {
  AgentStatus,
  AgentState,
  SyncJobData,
  SyncResult,
  SyncError,
  StockChange,
  StockConflict,
  ChannelStockState,
  SyncEventRecord,
  Channel,
  Product,
  ProductChannelMapping,
  SyncEngineConfig,
  ChannelType,
} from '../types.js';
import { calculateOnlineStock, isOnlineChannel } from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const QUEUE_NAME = 'stockclerk:sync';
const AGENT_NAME = 'sync';

// ============================================================================
// Sync Agent Dependencies
// ============================================================================

export interface SyncAgentDependencies {
  redis: Redis;
  eventBus: SyncEngineEventBus;
  config: SyncEngineConfig;
  /** Get all active channels for a tenant */
  getChannels: (tenantId: string) => Promise<Channel[]>;
  /** Get a single channel by ID */
  getChannel: (channelId: string) => Promise<Channel | null>;
  /** Get a product by ID */
  getProduct: (productId: string) => Promise<Product | null>;
  /** Get product by external ID and channel */
  getProductByExternalId: (
    tenantId: string,
    channelId: string,
    externalId: string
  ) => Promise<Product | null>;
  /** Get all channel mappings for a product */
  getProductMappings: (productId: string) => Promise<(ProductChannelMapping & { channel: Channel })[]>;
  /** Update product stock in database */
  updateProductStock: (productId: string, newStock: number) => Promise<void>;
  /** Update stock on external channel */
  updateChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string,
    quantity: number
  ) => Promise<void>;
  /** Create a sync event record */
  createSyncEvent: (event: SyncEventRecord) => Promise<string>;
  /** Update sync event status */
  updateSyncEventStatus: (
    eventId: string,
    status: SyncEventRecord['status'],
    errorMessage?: string
  ) => Promise<void>;
  /** Get current stock from channel */
  getChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string
  ) => Promise<number | null>;
}

// ============================================================================
// Sync Agent Class
// ============================================================================

export class SyncAgent {
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly config: SyncEngineConfig;
  private readonly deps: SyncAgentDependencies;

  private queue: Queue<SyncJobData> | null = null;
  private worker: Worker<SyncJobData> | null = null;
  private state: AgentState = 'stopped';
  private processedCount = 0;
  private errorCount = 0;
  private lastActivity: Date | null = null;
  private lastError: string | undefined;

  constructor(deps: SyncAgentDependencies) {
    this.redis = deps.redis;
    this.eventBus = deps.eventBus;
    this.config = deps.config;
    this.deps = deps;
  }

  /**
   * Start the Sync Agent
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.state = 'starting';
    this.log('Starting Sync Agent...');

    try {
      // Create the sync queue
      this.queue = new Queue<SyncJobData>(QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          attempts: this.config.maxRetries,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        },
      });

      // Create the worker
      this.worker = new Worker<SyncJobData>(
        QUEUE_NAME,
        this.processSyncJob.bind(this),
        {
          connection: this.redis,
          concurrency: this.config.concurrency,
        }
      );

      // Set up worker event handlers
      this.worker.on('completed', (job) => {
        this.processedCount++;
        this.lastActivity = new Date();
        this.log(`Sync job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        this.errorCount++;
        this.lastActivity = new Date();
        this.lastError = err.message;
        this.log(`Sync job ${job?.id} failed: ${err.message}`, 'error');
      });

      this.worker.on('error', (err) => {
        this.errorCount++;
        this.lastError = err.message;
        this.log(`Worker error: ${err.message}`, 'error');
      });

      // Subscribe to stock change events from Watcher
      this.eventBus.onStockChange(this.handleStockChange.bind(this));

      this.state = 'running';
      this.log('Sync Agent started successfully');
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Stop the Sync Agent
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.log('Stopping Sync Agent...');

    try {
      if (this.worker) {
        await this.worker.close();
        this.worker = null;
      }

      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }

      this.state = 'stopped';
      this.log('Sync Agent stopped');
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Get the current status of the agent
   */
  getStatus(): AgentStatus {
    return {
      name: AGENT_NAME,
      state: this.state,
      lastActivity: this.lastActivity,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      error: this.lastError,
    };
  }

  /**
   * Add a sync job to the queue
   */
  async addSyncJob(data: SyncJobData): Promise<string> {
    if (!this.queue) {
      throw new Error('Sync Agent not started');
    }

    const job = await this.queue.add('sync', data, {
      priority: data.priority ?? 5,
    });

    return job.id || '';
  }

  /**
   * Trigger a full sync for a tenant
   */
  async triggerFullSync(tenantId: string, initiatedBy = 'system'): Promise<string> {
    return this.addSyncJob({
      tenantId,
      operation: 'full_sync',
      initiatedBy,
      force: true,
    });
  }

  /**
   * Trigger a channel sync
   */
  async triggerChannelSync(
    tenantId: string,
    channelId: string,
    initiatedBy = 'system'
  ): Promise<string> {
    return this.addSyncJob({
      tenantId,
      operation: 'channel_sync',
      sourceChannelId: channelId,
      initiatedBy,
    });
  }

  /**
   * Trigger a product sync
   */
  async triggerProductSync(
    tenantId: string,
    productId: string,
    initiatedBy = 'system'
  ): Promise<string> {
    return this.addSyncJob({
      tenantId,
      operation: 'product_sync',
      productIds: [productId],
      initiatedBy,
    });
  }

  /**
   * Handle stock change event from Watcher
   */
  private async handleStockChange(event: { payload: StockChange }): Promise<void> {
    const { payload: stockChange } = event;

    this.log(
      `Received stock:change for ${stockChange.productId || stockChange.externalId} ` +
        `from channel ${stockChange.sourceChannelId}`
    );

    // Create a sync job to propagate the change
    await this.addSyncJob({
      tenantId: stockChange.tenantId,
      operation: 'stock_change',
      sourceChannelId: stockChange.sourceChannelId,
      productIds: stockChange.productId ? [stockChange.productId] : undefined,
      stockChange,
      priority: 1, // High priority for real-time changes
    });
  }

  /**
   * Process a sync job
   */
  private async processSyncJob(job: Job<SyncJobData>): Promise<SyncResult> {
    const startedAt = new Date();
    const { tenantId, operation, sourceChannelId, productIds, stockChange, force } = job.data;

    this.log(`Processing sync job: ${operation} for tenant ${tenantId}`);

    const errors: SyncError[] = [];
    let channelsUpdated = 0;
    let productsUpdated = 0;

    try {
      switch (operation) {
        case 'stock_change':
          if (stockChange) {
            const result = await this.processStockChange(stockChange);
            channelsUpdated = result.channelsUpdated;
            productsUpdated = result.productsUpdated;
            errors.push(...result.errors);
          }
          break;

        case 'product_sync':
          if (productIds && productIds.length > 0) {
            for (const productId of productIds) {
              const result = await this.syncProduct(tenantId, productId, sourceChannelId);
              channelsUpdated += result.channelsUpdated;
              productsUpdated += result.productsUpdated;
              errors.push(...result.errors);
            }
          }
          break;

        case 'channel_sync':
          if (sourceChannelId) {
            const result = await this.syncFromChannel(tenantId, sourceChannelId);
            channelsUpdated = result.channelsUpdated;
            productsUpdated = result.productsUpdated;
            errors.push(...result.errors);
          }
          break;

        case 'full_sync':
          const result = await this.fullSync(tenantId, force);
          channelsUpdated = result.channelsUpdated;
          productsUpdated = result.productsUpdated;
          errors.push(...result.errors);
          break;
      }

      const completedAt = new Date();
      const syncResult: SyncResult = {
        jobId: job.id || '',
        tenantId,
        operation,
        success: errors.length === 0,
        channelsUpdated,
        productsUpdated,
        errors,
        startedAt,
        completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
      };

      // Emit sync completed event
      this.eventBus.emitSyncCompleted(syncResult);

      return syncResult;
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Emit sync failed event
      this.eventBus.emitSyncFailed({
        jobId: job.id || '',
        tenantId,
        error: errorMessage,
        retryable: true,
      });

      throw error;
    }
  }

  /**
   * Process a single stock change and sync to all other channels
   */
  private async processStockChange(stockChange: StockChange): Promise<{
    channelsUpdated: number;
    productsUpdated: number;
    errors: SyncError[];
  }> {
    const errors: SyncError[] = [];
    let channelsUpdated = 0;
    let productsUpdated = 0;

    // Find the product if we don't have the ID
    let productId = stockChange.productId;
    let product: Product | null = null;

    if (productId) {
      product = await this.deps.getProduct(productId);
    } else {
      product = await this.deps.getProductByExternalId(
        stockChange.tenantId,
        stockChange.sourceChannelId,
        stockChange.externalId
      );
      productId = product?.id;
    }

    if (!product || !productId) {
      this.log(`Product not found for external ID: ${stockChange.externalId}`, 'warn');
      return { channelsUpdated, productsUpdated, errors };
    }

    // Get the actual stock value (new quantity from the change)
    const actualStock = stockChange.newQuantity;
    const oldStock = product.currentStock;

    // Create sync event record for audit
    const syncEventId = await this.deps.createSyncEvent({
      tenantId: stockChange.tenantId,
      eventType: `stock_change_${stockChange.changeType}`,
      channelId: stockChange.sourceChannelId,
      productId,
      oldValue: { stock: oldStock },
      newValue: { stock: actualStock },
      status: 'processing',
    });

    try {
      // Update the product stock in our database
      await this.deps.updateProductStock(productId, actualStock);
      productsUpdated++;

      // Get all channel mappings for this product
      const mappings = await this.deps.getProductMappings(productId);

      // Sync to all channels EXCEPT the source
      for (const mapping of mappings) {
        if (mapping.channelId === stockChange.sourceChannelId) {
          continue; // Skip the source channel
        }

        if (!mapping.channel.isActive) {
          continue; // Skip inactive channels
        }

        try {
          // Apply buffer stock rule for online channels
          const stockToSync = isOnlineChannel(mapping.channel.type)
            ? calculateOnlineStock(actualStock, product.bufferStock)
            : actualStock;

          await this.deps.updateChannelStock(
            mapping.channelId,
            mapping.channel.type,
            mapping.externalId,
            stockToSync
          );

          channelsUpdated++;
          this.log(
            `Synced stock to ${mapping.channel.name} (${mapping.channel.type}): ` +
              `${stockToSync} units (buffer applied: ${isOnlineChannel(mapping.channel.type)})`
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({
            channelId: mapping.channelId,
            productId,
            externalId: mapping.externalId,
            message: errorMessage,
            code: 'CHANNEL_UPDATE_FAILED',
            retryable: true,
          });

          // Emit channel disconnected if it's an auth error
          if (errorMessage.toLowerCase().includes('auth') || errorMessage.toLowerCase().includes('unauthorized')) {
            this.eventBus.emitChannelDisconnected({
              tenantId: stockChange.tenantId,
              channelId: mapping.channelId,
              channelType: mapping.channel.type,
              error: errorMessage,
            });
          }
        }
      }

      // Update sync event as completed
      await this.deps.updateSyncEventStatus(syncEventId, 'completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.deps.updateSyncEventStatus(syncEventId, 'failed', errorMessage);
      throw error;
    }

    return { channelsUpdated, productsUpdated, errors };
  }

  /**
   * Sync a specific product to all channels
   */
  private async syncProduct(
    tenantId: string,
    productId: string,
    excludeChannelId?: string
  ): Promise<{
    channelsUpdated: number;
    productsUpdated: number;
    errors: SyncError[];
  }> {
    const errors: SyncError[] = [];
    let channelsUpdated = 0;
    let productsUpdated = 0;

    const product = await this.deps.getProduct(productId);
    if (!product) {
      errors.push({
        productId,
        message: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
        retryable: false,
      });
      return { channelsUpdated, productsUpdated, errors };
    }

    const mappings = await this.deps.getProductMappings(productId);

    for (const mapping of mappings) {
      if (excludeChannelId && mapping.channelId === excludeChannelId) {
        continue;
      }

      if (!mapping.channel.isActive) {
        continue;
      }

      try {
        // Apply buffer stock rule for online channels
        const stockToSync = isOnlineChannel(mapping.channel.type)
          ? calculateOnlineStock(product.currentStock, product.bufferStock)
          : product.currentStock;

        await this.deps.updateChannelStock(
          mapping.channelId,
          mapping.channel.type,
          mapping.externalId,
          stockToSync
        );

        channelsUpdated++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          channelId: mapping.channelId,
          productId,
          externalId: mapping.externalId,
          message: errorMessage,
          code: 'CHANNEL_UPDATE_FAILED',
          retryable: true,
        });
      }
    }

    productsUpdated = channelsUpdated > 0 ? 1 : 0;
    return { channelsUpdated, productsUpdated, errors };
  }

  /**
   * Sync all products from a specific channel (pull)
   */
  private async syncFromChannel(
    tenantId: string,
    channelId: string
  ): Promise<{
    channelsUpdated: number;
    productsUpdated: number;
    errors: SyncError[];
  }> {
    const errors: SyncError[] = [];
    let channelsUpdated = 0;
    let productsUpdated = 0;

    const channel = await this.deps.getChannel(channelId);
    if (!channel || !channel.isActive) {
      errors.push({
        channelId,
        message: 'Channel not found or inactive',
        code: 'CHANNEL_NOT_FOUND',
        retryable: false,
      });
      return { channelsUpdated, productsUpdated, errors };
    }

    // This would typically involve:
    // 1. Fetching all products from the channel
    // 2. Updating our database
    // 3. Syncing to other channels
    // For now, we emit a placeholder implementation

    this.log(`Channel sync from ${channel.name} requested - implementation depends on channel API`);

    return { channelsUpdated, productsUpdated, errors };
  }

  /**
   * Full sync for all products across all channels
   */
  private async fullSync(
    tenantId: string,
    force = false
  ): Promise<{
    channelsUpdated: number;
    productsUpdated: number;
    errors: SyncError[];
  }> {
    const errors: SyncError[] = [];
    let channelsUpdated = 0;
    let productsUpdated = 0;

    const channels = await this.deps.getChannels(tenantId);
    const activeChannels = channels.filter((c) => c.isActive);

    if (activeChannels.length === 0) {
      this.log('No active channels found for full sync');
      return { channelsUpdated, productsUpdated, errors };
    }

    // Find the source of truth channel (Eposnow POS)
    const sourceOfTruth = activeChannels.find((c) => c.type === 'eposnow');

    if (!sourceOfTruth) {
      this.log('No Eposnow channel found - using first active channel as source of truth', 'warn');
    }

    // Sync from source of truth to all other channels
    // This is a simplified implementation - full sync would involve
    // fetching all products and their current stock levels

    this.log(`Full sync initiated for tenant ${tenantId} with ${activeChannels.length} active channels`);

    return { channelsUpdated, productsUpdated, errors };
  }

  /**
   * Resolve stock conflicts using most recent timestamp wins strategy
   */
  async resolveConflict(
    tenantId: string,
    productId: string,
    channelStates: ChannelStockState[]
  ): Promise<StockConflict> {
    // Sort by lastUpdated to find most recent
    const sorted = [...channelStates].sort(
      (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()
    );

    const winner = sorted[0];
    const resolvedValue = winner.quantity;

    // Create conflict record for audit
    const conflict: StockConflict = {
      tenantId,
      productId,
      sku: '', // Would be populated from product lookup
      conflicts: channelStates,
      resolvedValue,
      resolvedAt: new Date(),
      resolution: 'most_recent',
    };

    // Log the conflict for audit
    await this.deps.createSyncEvent({
      tenantId,
      eventType: 'conflict_resolved',
      productId,
      oldValue: { conflicts: channelStates },
      newValue: { resolvedValue, winner: winner.channelId },
      status: 'completed',
    });

    this.log(
      `Conflict resolved for product ${productId}: ` +
        `${winner.channelName} wins with value ${resolvedValue}`
    );

    return conflict;
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[SyncAgent]`;
    const timestamp = new Date().toISOString();

    switch (level) {
      case 'error':
        console.error(`${timestamp} ${prefix} ERROR: ${message}`);
        break;
      case 'warn':
        console.warn(`${timestamp} ${prefix} WARN: ${message}`);
        break;
      default:
        if (this.config.debug) {
          console.log(`${timestamp} ${prefix} ${message}`);
        }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSyncAgent(deps: SyncAgentDependencies): SyncAgent {
  return new SyncAgent(deps);
}
