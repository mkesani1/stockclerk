/**
 * Watcher Agent
 * Listens for webhook events from all channels, detects stock changes in real-time,
 * classifies changes (sale, restock, adjustment, return), and emits stock:change events.
 */

import { Worker, Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SyncEngineEventBus } from '../events.js';
import { EposnowApiClient } from '@stockclerk/integrations';
import { WixApiClient } from '@stockclerk/integrations';
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

export interface ChannelCredentials {
  type: ChannelType;
  // Eposnow
  apiKey?: string;
  apiSecret?: string;
  locationId?: number;
  // Wix
  clientId?: string;
  clientSecret?: string;
  instanceId?: string;
  accessToken?: string;
  refreshToken?: string;
  siteId?: string;
  authMode?: 'basic' | 'advanced';
}

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
  getChannel: (channelId: string) => Promise<{ type: ChannelType; name: string; credentialsEncrypted?: string } | null>;
  /** Decrypt channel credentials */
  decryptCredentials?: (encrypted: string) => ChannelCredentials;
}

export class WatcherAgent {
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly config: SyncEngineConfig;
  private readonly getProductMapping: WatcherAgentDependencies['getProductMapping'];
  private readonly getChannel: WatcherAgentDependencies['getChannel'];
  private readonly decryptCredentials: WatcherAgentDependencies['decryptCredentials'];

  private queue: Queue<WebhookProcessJobData> | null = null;
  private worker: Worker<WebhookProcessJobData> | null = null;
  private state: AgentState = 'stopped';
  private processedCount = 0;
  private errorCount = 0;
  private lastActivity: Date | null = null;
  private lastError: string | undefined;

  // Eposnow polling
  private eposnowPollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastEposnowPollTimestamp: Map<string, Date> = new Map();
  private readonly EPOSNOW_POLL_INTERVAL_MS = 30000; // 30 seconds

  constructor(deps: WatcherAgentDependencies) {
    this.redis = deps.redis;
    this.eventBus = deps.eventBus;
    this.config = deps.config;
    this.getProductMapping = deps.getProductMapping;
    this.getChannel = deps.getChannel;
    this.decryptCredentials = deps.decryptCredentials || ((encrypted) => {
      // Default no-op decryption if not provided
      try {
        return JSON.parse(Buffer.from(encrypted, 'base64').toString());
      } catch {
        return {};
      }
    });
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
      // Stop all Eposnow polling intervals
      const channelIds = Array.from(this.eposnowPollIntervals.keys());
      for (const channelId of channelIds) {
        this.stopEposnowPolling(channelId);
      }
      this.eposnowPollIntervals.clear();
      this.lastEposnowPollTimestamp.clear();

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

    // Extract Wix instance ID from webhook headers (stored in metadata)
    const instanceId = (payload.metadata as Record<string, unknown>)?.instanceId as string | undefined;
    const webhookInstanceId = (payload.wix_instance as string) || instanceId;

    // Handle inventory update events from Wix webhooks
    if (eventType === 'inventory/variant/changed' || eventType === 'wix.stores.inventory.updated') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const inventoryWebhookData = data as Record<string, unknown>;

      // Extract product/inventory info
      const productId = inventoryWebhookData.productId as string ?? (inventoryWebhookData as Record<string, unknown>).externalId as string;
      const variants = inventoryWebhookData.variants as Array<{ variantId: string; quantity: number | null; inStock: boolean }> | undefined;

      if (productId && variants && Array.isArray(variants)) {
        for (const variant of variants) {
          const newQuantity = variant.quantity ?? (variant.inStock ? 1 : 0);
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
            sku: mapping?.sku ?? (inventoryWebhookData.sku as string),
            sourceChannelId: channelId,
            sourceChannelType: 'wix',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity,
            changeAmount: mapping?.currentStock !== undefined ? newQuantity - mapping.currentStock : 0,
            changeType,
            timestamp: new Date(),
            rawPayload: payload,
            metadata: { variantId: variant.variantId, webhookInstanceId },
          });
        }
      }
    }

    // Handle catalog/product/changed events
    if (eventType === 'catalog/product/changed' || eventType === 'wix.stores.product.updated') {
      const data = (payload.data || payload) as Record<string, unknown>;
      const productData = (data.product || data) as Record<string, unknown>;
      const productId = productData.id as string;

      // Stock information might be in product.stock or variants
      const stock = productData.stock as Record<string, unknown> | undefined;
      if (stock && productId) {
        const trackInventory = stock.trackInventory as boolean | undefined;
        const quantity = stock.quantity as number | null ?? 0;

        if (trackInventory) {
          const mapping = await this.getProductMapping(tenantId, channelId, productId);
          const changeType = this.classifyStockChange(
            mapping?.currentStock,
            quantity,
            eventType,
            payload
          );

          stockChanges.push({
            productId: mapping?.productId,
            externalId: productId,
            sku: mapping?.sku ?? (productData.sku as string),
            sourceChannelId: channelId,
            sourceChannelType: 'wix',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity: quantity,
            changeAmount: mapping?.currentStock !== undefined ? quantity - mapping.currentStock : 0,
            changeType,
            timestamp: new Date(),
            rawPayload: payload,
            metadata: { eventType, webhookInstanceId },
          });
        }
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
            metadata: { orderedQuantity, webhookInstanceId },
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
   * Poll Eposnow for recent transactions and detect stock changes
   * Called periodically for Eposnow channels to detect POS sales
   */
  private async pollEposnowTransactions(channelId: string, tenantId: string): Promise<void> {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        this.log(`Channel ${channelId} not found`, 'warn');
        return;
      }

      if (channel.type !== 'eposnow') {
        return;
      }

      // Get credentials for this channel
      let credentials: ChannelCredentials;
      try {
        if (channel.credentialsEncrypted) {
          credentials = this.decryptCredentials(channel.credentialsEncrypted);
        } else {
          this.log(`No credentials for Eposnow channel ${channelId}`, 'warn');
          return;
        }
      } catch (error) {
        this.log(`Failed to decrypt credentials for channel ${channelId}: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
        return;
      }

      // Initialize Eposnow client
      if (!credentials.apiKey || !credentials.apiSecret) {
        this.log(`Missing Eposnow API credentials for channel ${channelId}`, 'warn');
        return;
      }

      const eposnowClient = new EposnowApiClient({
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        locationId: credentials.locationId,
      });

      await eposnowClient.connect();

      // Get last poll timestamp
      const lastPollKey = `eposnow:last-poll:${channelId}`;
      const lastPollStr = await this.redis.get(lastPollKey);
      const lastPollTimestamp = lastPollStr ? new Date(lastPollStr) : new Date(Date.now() - 5 * 60 * 1000); // Default to 5 minutes ago

      this.log(`Polling Eposnow transactions since ${lastPollTimestamp.toISOString()} for channel ${channelId}`);

      // Fetch transactions since last poll
      const transactions = await eposnowClient.getTransactionsSince(lastPollTimestamp, credentials.locationId);

      this.log(`Found ${transactions.length} transactions since last poll for channel ${channelId}`);

      // Process each transaction to detect stock changes
      for (const transaction of transactions) {
        if (!transaction.Items || transaction.Items.length === 0) {
          continue;
        }

        for (const item of transaction.Items) {
          const mapping = await this.getProductMapping(tenantId, channelId, item.ProductId.toString());
          const soldQuantity = item.Quantity;
          const newQuantity = mapping?.currentStock !== undefined
            ? mapping.currentStock - soldQuantity
            : 0;

          const stockChange: StockChange = {
            productId: mapping?.productId,
            externalId: item.ProductId.toString(),
            sku: mapping?.sku,
            sourceChannelId: channelId,
            sourceChannelType: 'eposnow',
            tenantId,
            previousQuantity: mapping?.currentStock,
            newQuantity: Math.max(0, newQuantity),
            changeAmount: -soldQuantity,
            changeType: 'sale',
            timestamp: new Date(transaction.CompletedDate || transaction.CreatedDate),
            rawPayload: {
              transactionId: transaction.Id,
              transactionNumber: transaction.TransactionNumber,
              itemId: item.Id,
              productId: item.ProductId,
            },
            metadata: { soldQuantity, transactionId: transaction.Id },
          };

          this.eventBus.emitStockChange(stockChange);
          this.log(
            `Emitted stock:change from Eposnow transaction for product ${stockChange.productId || stockChange.externalId}: ` +
              `${stockChange.previousQuantity ?? '?'} -> ${stockChange.newQuantity} (${stockChange.changeType})`
          );
        }
      }

      // Update last poll timestamp
      const nowStr = new Date().toISOString();
      await this.redis.set(lastPollKey, nowStr);
      this.lastEposnowPollTimestamp.set(channelId, new Date());

      await eposnowClient.disconnect();
    } catch (error) {
      this.errorCount++;
      this.log(
        `Error polling Eposnow transactions for channel ${channelId}: ${error instanceof Error ? error.message : 'Unknown'}`,
        'error'
      );
    }
  }

  /**
   * Start polling Eposnow channels for transaction changes
   * Called when the agent starts to initiate polling for all Eposnow channels
   */
  private startEposnowPolling(channelId: string, tenantId: string): void {
    // Clear any existing interval
    const existingInterval = this.eposnowPollIntervals.get(channelId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Set up polling interval
    const interval = setInterval(() => {
      this.pollEposnowTransactions(channelId, tenantId).catch((error) => {
        this.log(`Unhandled error in Eposnow polling: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
      });
    }, this.EPOSNOW_POLL_INTERVAL_MS);

    this.eposnowPollIntervals.set(channelId, interval);
    this.log(`Started polling Eposnow channel ${channelId} every ${this.EPOSNOW_POLL_INTERVAL_MS}ms`);

    // Run first poll immediately
    this.pollEposnowTransactions(channelId, tenantId).catch((error) => {
      this.log(`Initial Eposnow poll failed: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
    });
  }

  /**
   * Stop polling a specific Eposnow channel
   */
  private stopEposnowPolling(channelId: string): void {
    const interval = this.eposnowPollIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.eposnowPollIntervals.delete(channelId);
      this.lastEposnowPollTimestamp.delete(channelId);
      this.log(`Stopped polling Eposnow channel ${channelId}`);
    }
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
