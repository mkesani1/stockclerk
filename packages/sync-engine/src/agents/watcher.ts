/**
 * Watcher Agent
 * Listens for webhook events from all channels, detects stock changes in real-time,
 * classifies changes (sale, restock, adjustment, return), and emits stock:change events.
 */

import { Worker, Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SyncEngineEventBus } from '../events.js';
import type {
  AgentStatus,
  AgentState,
  WebhookProcessJobData,
  StockChange,
  StockChangeType,
  ChannelType,
  SyncEngineConfig,
} from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const QUEUE_NAME = 'stockclerk:webhook:process';
const AGENT_NAME = 'watcher';

// ============================================================================
// Watcher Agent Class
// ============================================================================

export interface WatcherAgentDependencies {
  redis: Redis;
  eventBus: SyncEngineEventBus;
  config: SyncEngineConfig;
  /** Database accessor for looking up product mappings */
  getProductMapping: (
    tenantId: string,
    channelId: string,
    externalId: string
  ) => Promise<{ productId: string; sku: string; currentStock: number } | null>;
  /** Get channel info */
  getChannel: (channelId: string) => Promise<{ type: ChannelType; name: string } | null>;
}

export class WatcherAgent {
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly config: SyncEngineConfig;
  private readonly getProductMapping: WatcherAgentDependencies['getProductMapping'];
  private readonly getChannel: WatcherAgentDependencies['getChannel'];

  private queue: Queue<WebhookProcessJobData> | null = null;
  private worker: Worker<WebhookProcessJobData> | null = null;
  private state: AgentState = 'stopped';
  private processedCount = 0;
  private errorCount = 0;
  private lastActivity: Date | null = null;
  private lastError: string | undefined;

  constructor(deps: WatcherAgentDependencies) {
    this.redis = deps.redis;
    this.eventBus = deps.eventBus;
    this.config = deps.config;
    this.getProductMapping = deps.getProductMapping;
    this.getChannel = deps.getChannel;
  }

  /**
   * Start the Watcher Agent
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.state = 'starting';
    this.log('Starting Watcher Agent...');

    try {
      // Create the webhook processing queue
      this.queue = new Queue<WebhookProcessJobData>(QUEUE_NAME, {
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

      // Create the worker to process webhooks
      this.worker = new Worker<WebhookProcessJobData>(
        QUEUE_NAME,
        this.processWebhook.bind(this),
        {
          connection: this.redis,
          concurrency: this.config.concurrency,
        }
      );

      // Set up worker event handlers
      this.worker.on('completed', (job) => {
        this.processedCount++;
        this.lastActivity = new Date();
        this.log(`Webhook job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        this.errorCount++;
        this.lastActivity = new Date();
        this.lastError = err.message;
        this.log(`Webhook job ${job?.id} failed: ${err.message}`, 'error');
      });

      this.worker.on('error', (err) => {
        this.errorCount++;
        this.lastError = err.message;
        this.log(`Worker error: ${err.message}`, 'error');
      });

      this.state = 'running';
      this.log('Watcher Agent started successfully');
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Stop the Watcher Agent
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.log('Stopping Watcher Agent...');

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
      this.log('Watcher Agent stopped');
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
   * Add a webhook job to the processing queue
   */
  async addWebhookJob(data: WebhookProcessJobData): Promise<string> {
    if (!this.queue) {
      throw new Error('Watcher Agent not started');
    }

    const job = await this.queue.add('webhook', data, {
      priority: 1, // High priority for webhooks
    });

    return job.id || '';
  }

  /**
   * Process a webhook job
   */
  private async processWebhook(job: Job<WebhookProcessJobData>): Promise<void> {
    const { tenantId, channelId, channelType, eventType, payload, receivedAt } = job.data;

    this.log(`Processing webhook: ${eventType} from ${channelType} (tenant: ${tenantId})`);

    try {
      // Parse the webhook payload based on channel type
      const stockChanges = await this.parseWebhookPayload(
        tenantId,
        channelId,
        channelType,
        eventType,
        payload
      );

      if (stockChanges.length === 0) {
        this.log(`No stock changes detected in webhook ${job.id}`);
        return;
      }

      // Emit stock change events for each detected change
      for (const stockChange of stockChanges) {
        this.eventBus.emitStockChange(stockChange);
        this.log(
          `Emitted stock:change for product ${stockChange.productId || stockChange.externalId}: ` +
            `${stockChange.previousQuantity ?? '?'} -> ${stockChange.newQuantity} (${stockChange.changeType})`
        );
      }
    } catch (error) {
      this.log(`Error processing webhook: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
      throw error;
    }
  }

  /**
   * Parse webhook payload and extract stock changes
   */
  private async parseWebhookPayload(
    tenantId: string,
    channelId: string,
    channelType: ChannelType,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<StockChange[]> {
    const stockChanges: StockChange[] = [];

    switch (channelType) {
      case 'eposnow':
        stockChanges.push(...(await this.parseEposnowWebhook(tenantId, channelId, eventType, payload)));
        break;

      case 'wix':
        stockChanges.push(...(await this.parseWixWebhook(tenantId, channelId, eventType, payload)));
        break;

      case 'deliveroo':
        stockChanges.push(...(await this.parseOtterWebhook(tenantId, channelId, eventType, payload)));
        break;

      default:
        this.log(`Unknown channel type: ${channelType}`, 'warn');
    }

    return stockChanges;
  }

  /**
   * Parse Eposnow webhook payload
   */
  private async parseEposnowWebhook(
    tenantId: string,
    channelId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<StockChange[]> {
    const stockChanges: StockChange[] = [];

    // Handle different Eposnow event types
    if (eventType === 'stock.updated' || eventType === 'product.updated') {
      const productId = payload.ProductId as string;
      const newQuantity = payload.CurrentStockLevel as number ?? payload.StockLevel as number;

      if (productId && typeof newQuantity === 'number') {
        const mapping = await this.getProductMapping(tenantId, channelId, productId);
        const changeType = this.classifyStockChange(
          mapping?.currentStock,
          newQuantity,
          eventType,
          payload
        );

        stockChanges.push({
          productId: mapping?.productId,
          externalId: productId,
          sku: mapping?.sku ?? (payload.Sku as string),
          sourceChannelId: channelId,
          sourceChannelType: 'eposnow',
          tenantId,
          previousQuantity: mapping?.currentStock,
          newQuantity,
          changeAmount: mapping?.currentStock !== undefined ? newQuantity - mapping.currentStock : 0,
          changeType,
          timestamp: new Date(),
          rawPayload: payload,
        });
      }
    }

    // Handle transaction/sale events
    if (eventType === 'transaction.created' || eventType === 'sale.completed') {
      const items = (payload.Items || payload.TransactionItems) as Array<{
        ProductId: string;
        Quantity: number;
        Sku?: string;
      }> | undefined;

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const mapping = await this.getProductMapping(tenantId, channelId, item.ProductId);
          const soldQuantity = item.Quantity;
          const newQuantity = mapping?.currentStock !== undefined
            ? mapping.currentStock - soldQuantity
            : 0;

          stockChanges.push({
            productId: mapping?.productId,
            externalId: item.ProductId,
            sku: mapping?.sku ?? item.Sku,
            sourceChannelId: channelId,
            sourceChannelType: 'eposnow',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity: Math.max(0, newQuantity),
            changeAmount: -soldQuantity,
            changeType: 'sale',
            timestamp: new Date(),
            rawPayload: payload,
            metadata: { soldQuantity },
          });
        }
      }
    }

    return stockChanges;
  }

  /**
   * Parse Wix webhook payload
   */
  private async parseWixWebhook(
    tenantId: string,
    channelId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<StockChange[]> {
    const stockChanges: StockChange[] = [];

    // Handle inventory update events
    if (eventType === 'inventory/inventory_item_updated' || eventType === 'wix.stores.inventory.updated') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const productId = data.productId as string ?? data.externalId as string;
      const newQuantity = data.quantity as number ?? data.trackQuantity as number;

      if (productId && typeof newQuantity === 'number') {
        const mapping = await this.getProductMapping(tenantId, channelId, productId);
        const changeType = this.classifyStockChange(
          mapping?.currentStock,
          newQuantity,
          eventType,
          payload
        );

        stockChanges.push({
          productId: mapping?.productId,
          externalId: productId,
          sku: mapping?.sku ?? (data.sku as string),
          sourceChannelId: channelId,
          sourceChannelType: 'wix',
          tenantId,
          previousQuantity: mapping?.currentStock,
          newQuantity,
          changeAmount: mapping?.currentStock !== undefined ? newQuantity - mapping.currentStock : 0,
          changeType,
          timestamp: new Date(),
          rawPayload: payload,
        });
      }
    }

    // Handle order events
    if (eventType === 'wix.stores.order.created' || eventType === 'order/order_paid') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const lineItems = (data.lineItems || data.items) as Array<{
        productId: string;
        quantity: number;
        sku?: string;
      }> | undefined;

      if (lineItems && Array.isArray(lineItems)) {
        for (const item of lineItems) {
          const mapping = await this.getProductMapping(tenantId, channelId, item.productId);
          const orderedQuantity = item.quantity;
          const newQuantity = mapping?.currentStock !== undefined
            ? mapping.currentStock - orderedQuantity
            : 0;

          stockChanges.push({
            productId: mapping?.productId,
            externalId: item.productId,
            sku: mapping?.sku ?? item.sku,
            sourceChannelId: channelId,
            sourceChannelType: 'wix',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity: Math.max(0, newQuantity),
            changeAmount: -orderedQuantity,
            changeType: 'order',
            timestamp: new Date(),
            rawPayload: payload,
            metadata: { orderedQuantity },
          });
        }
      }
    }

    return stockChanges;
  }

  /**
   * Parse Otter (Deliveroo) webhook payload
   */
  private async parseOtterWebhook(
    tenantId: string,
    channelId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<StockChange[]> {
    const stockChanges: StockChange[] = [];

    // Handle menu item availability updates
    if (eventType === 'menu.item.availability.updated' || eventType === 'item_availability_changed') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const itemId = data.itemId as string ?? data.menuItemId as string;
      const available = data.available as boolean ?? data.isAvailable as boolean;
      // Otter typically uses availability rather than quantity
      // We treat available=true as stock=1, available=false as stock=0
      const newQuantity = available ? 1 : 0;

      if (itemId) {
        const mapping = await this.getProductMapping(tenantId, channelId, itemId);

        stockChanges.push({
          productId: mapping?.productId,
          externalId: itemId,
          sku: mapping?.sku,
          sourceChannelId: channelId,
          sourceChannelType: 'deliveroo',
          tenantId,
          previousQuantity: mapping?.currentStock,
          newQuantity,
          changeAmount: mapping?.currentStock !== undefined ? newQuantity - mapping.currentStock : 0,
          changeType: 'adjustment',
          timestamp: new Date(),
          rawPayload: payload,
          metadata: { available },
        });
      }
    }

    // Handle order events from Otter
    if (eventType === 'order.created' || eventType === 'order.accepted') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const items = (data.items || data.orderItems) as Array<{
        id: string;
        menuItemId?: string;
        quantity: number;
      }> | undefined;

      if (items && Array.isArray(items)) {
        for (const item of items) {
          const itemId = item.menuItemId || item.id;
          const mapping = await this.getProductMapping(tenantId, channelId, itemId);
          const orderedQuantity = item.quantity;
          const newQuantity = mapping?.currentStock !== undefined
            ? mapping.currentStock - orderedQuantity
            : 0;

          stockChanges.push({
            productId: mapping?.productId,
            externalId: itemId,
            sku: mapping?.sku,
            sourceChannelId: channelId,
            sourceChannelType: 'deliveroo',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity: Math.max(0, newQuantity),
            changeAmount: -orderedQuantity,
            changeType: 'order',
            timestamp: new Date(),
            rawPayload: payload,
            metadata: { orderedQuantity },
          });
        }
      }
    }

    return stockChanges;
  }

  /**
   * Classify the type of stock change
   */
  private classifyStockChange(
    previousQuantity: number | undefined,
    newQuantity: number,
    eventType: string,
    payload: Record<string, unknown>
  ): StockChangeType {
    // Check event type hints
    const eventLower = eventType.toLowerCase();
    if (eventLower.includes('sale') || eventLower.includes('transaction')) {
      return 'sale';
    }
    if (eventLower.includes('order')) {
      return 'order';
    }
    if (eventLower.includes('return') || eventLower.includes('refund')) {
      return 'return';
    }
    if (eventLower.includes('restock') || eventLower.includes('receive')) {
      return 'restock';
    }

    // Check payload hints
    const reason = (payload.reason || payload.adjustmentReason || payload.Reason) as string | undefined;
    if (reason) {
      const reasonLower = reason.toLowerCase();
      if (reasonLower.includes('sale') || reasonLower.includes('sold')) {
        return 'sale';
      }
      if (reasonLower.includes('return') || reasonLower.includes('refund')) {
        return 'return';
      }
      if (reasonLower.includes('restock') || reasonLower.includes('receive') || reasonLower.includes('purchase')) {
        return 'restock';
      }
    }

    // Classify based on quantity change
    if (previousQuantity !== undefined) {
      const change = newQuantity - previousQuantity;
      if (change < 0) {
        // Stock decreased - could be sale or adjustment
        return 'sale';
      }
      if (change > 0) {
        // Stock increased - could be restock or return
        return 'restock';
      }
    }

    return 'adjustment';
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[WatcherAgent]`;
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

export function createWatcherAgent(deps: WatcherAgentDependencies): WatcherAgent {
  return new WatcherAgent(deps);
}
