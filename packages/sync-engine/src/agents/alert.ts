/**
 * Alert Agent
 * Monitors stock levels against thresholds, creates alerts for low stock,
 * sync failures, and channel disconnects. Handles notification dispatch.
 */

import { Worker, Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SyncEngineEventBus } from '../events.js';
import type {
  AgentStatus,
  AgentState,
  AlertCheckJobData,
  AlertNotification,
  AlertRule,
  AlertType,
  Channel,
  Product,
  SyncEngineConfig,
} from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const QUEUE_NAME = 'stockclerk:alert:check';
const AGENT_NAME = 'alert';

// ============================================================================
// Alert Agent Dependencies
// ============================================================================

export interface AlertAgentDependencies {
  redis: Redis;
  eventBus: SyncEngineEventBus;
  config: SyncEngineConfig;
  /** Get all tenants */
  getAllTenantIds: () => Promise<string[]>;
  /** Get all active channels for a tenant */
  getChannels: (tenantId: string) => Promise<Channel[]>;
  /** Get all products for a tenant */
  getProducts: (tenantId: string) => Promise<Product[]>;
  /** Get a specific product */
  getProduct: (productId: string) => Promise<Product | null>;
  /** Get alert rules for a tenant */
  getAlertRules: (tenantId: string) => Promise<AlertRule[]>;
  /** Create an alert in the database */
  createAlert: (
    tenantId: string,
    type: AlertType,
    message: string,
    metadata?: Record<string, unknown>
  ) => Promise<string>;
  /** Check if an alert already exists (to prevent duplicates) */
  alertExists: (
    tenantId: string,
    type: AlertType,
    productId?: string,
    channelId?: string
  ) => Promise<boolean>;
  /** Check channel health */
  checkChannelHealth: (channelId: string) => Promise<{
    connected: boolean;
    lastChecked: Date;
    error?: string;
  }>;
}

// ============================================================================
// Alert Agent Class
// ============================================================================

export class AlertAgent {
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly config: SyncEngineConfig;
  private readonly deps: AlertAgentDependencies;

  private queue: Queue<AlertCheckJobData> | null = null;
  private worker: Worker<AlertCheckJobData> | null = null;
  private state: AgentState = 'stopped';
  private processedCount = 0;
  private errorCount = 0;
  private lastActivity: Date | null = null;
  private lastError: string | undefined;

  constructor(deps: AlertAgentDependencies) {
    this.redis = deps.redis;
    this.eventBus = deps.eventBus;
    this.config = deps.config;
    this.deps = deps;
  }

  /**
   * Start the Alert Agent
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.state = 'starting';
    this.log('Starting Alert Agent...');

    try {
      // Create the alert check queue
      this.queue = new Queue<AlertCheckJobData>(QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          attempts: this.config.maxRetries,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 500,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        },
      });

      // Create the worker
      this.worker = new Worker<AlertCheckJobData>(
        QUEUE_NAME,
        this.processAlertCheck.bind(this),
        {
          connection: this.redis,
          concurrency: this.config.concurrency,
        }
      );

      // Set up worker event handlers
      this.worker.on('completed', (job) => {
        this.processedCount++;
        this.lastActivity = new Date();
        this.log(`Alert check job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        this.errorCount++;
        this.lastActivity = new Date();
        this.lastError = err.message;
        this.log(`Alert check job ${job?.id} failed: ${err.message}`, 'error');
      });

      this.worker.on('error', (err) => {
        this.errorCount++;
        this.lastError = err.message;
        this.log(`Worker error: ${err.message}`, 'error');
      });

      // Subscribe to events that might trigger alerts
      this.eventBus.onSyncFailed(this.handleSyncFailed.bind(this));
      this.eventBus.onChannelDisconnected(this.handleChannelDisconnected.bind(this));
      this.eventBus.onDriftDetected(this.handleDriftDetected.bind(this));
      this.eventBus.onStockChange(this.handleStockChange.bind(this));

      // Add repeatable job for periodic alert checks
      await this.queue.add(
        'periodic-check',
        {
          tenantId: '*',
          checkType: 'all',
        },
        {
          repeat: {
            every: 5 * 60 * 1000, // Every 5 minutes
          },
          jobId: 'alert-periodic',
        }
      );

      this.state = 'running';
      this.log('Alert Agent started successfully');
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Stop the Alert Agent
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.log('Stopping Alert Agent...');

    try {
      // Remove repeatable job
      if (this.queue) {
        await this.queue.removeRepeatableByKey('periodic-check:alert-periodic');
      }

      if (this.worker) {
        await this.worker.close();
        this.worker = null;
      }

      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }

      this.state = 'stopped';
      this.log('Alert Agent stopped');
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
   * Add an alert check job
   */
  async addAlertCheck(data: AlertCheckJobData): Promise<string> {
    if (!this.queue) {
      throw new Error('Alert Agent not started');
    }

    const job = await this.queue.add('alert-check', data, {
      priority: 5,
    });

    return job.id || '';
  }

  /**
   * Process an alert check job
   */
  private async processAlertCheck(job: Job<AlertCheckJobData>): Promise<void> {
    const { tenantId, checkType, productId, channelId, threshold } = job.data;

    this.log(`Processing alert check: type=${checkType}, tenant=${tenantId}`);

    // Get tenants to check
    const tenantIds = tenantId === '*' ? await this.deps.getAllTenantIds() : [tenantId];

    for (const tid of tenantIds) {
      try {
        switch (checkType) {
          case 'low_stock':
            await this.checkLowStock(tid, productId, threshold);
            break;

          case 'sync_health':
            // Sync health is typically monitored via events
            break;

          case 'channel_status':
            await this.checkChannelStatus(tid, channelId);
            break;

          case 'all':
            await this.checkLowStock(tid, productId, threshold);
            await this.checkChannelStatus(tid, channelId);
            break;
        }
      } catch (error) {
        this.log(`Error checking alerts for tenant ${tid}: ${error}`, 'error');
      }
    }
  }

  /**
   * Check for low stock alerts
   */
  private async checkLowStock(
    tenantId: string,
    productId?: string,
    threshold?: number
  ): Promise<void> {
    const effectiveThreshold = threshold ?? this.config.lowStockThreshold;

    // Get products to check
    let products: Product[];
    if (productId) {
      const product = await this.deps.getProduct(productId);
      products = product ? [product] : [];
    } else {
      products = await this.deps.getProducts(tenantId);
    }

    // Get any custom alert rules for this tenant
    const rules = await this.deps.getAlertRules(tenantId);
    const lowStockRules = rules.filter((r) => r.type === 'low_stock' && r.enabled);

    for (const product of products) {
      // Find applicable rule or use default threshold
      const rule = lowStockRules.find((r) => r.productId === product.id);
      const productThreshold = rule?.threshold ?? effectiveThreshold;

      if (product.currentStock <= productThreshold) {
        // Check if alert already exists to prevent duplicates
        const exists = await this.deps.alertExists(tenantId, 'low_stock', product.id);
        if (!exists) {
          await this.createLowStockAlert(tenantId, product, productThreshold);
        }
      }
    }
  }

  /**
   * Check channel connection status
   */
  private async checkChannelStatus(tenantId: string, channelId?: string): Promise<void> {
    const channels = await this.deps.getChannels(tenantId);
    const channelsToCheck = channelId
      ? channels.filter((c) => c.id === channelId)
      : channels.filter((c) => c.isActive);

    for (const channel of channelsToCheck) {
      try {
        const health = await this.deps.checkChannelHealth(channel.id);

        if (!health.connected) {
          // Check if alert already exists
          const exists = await this.deps.alertExists(
            tenantId,
            'channel_disconnected',
            undefined,
            channel.id
          );

          if (!exists) {
            await this.createChannelDisconnectedAlert(tenantId, channel, health.error);
          }
        }
      } catch (error) {
        this.log(`Error checking channel ${channel.name}: ${error}`, 'error');
      }
    }
  }

  /**
   * Handle sync failed event
   */
  private async handleSyncFailed(event: {
    payload: { jobId: string; tenantId: string; error: string; retryable: boolean };
  }): Promise<void> {
    const { tenantId, jobId, error, retryable } = event.payload;

    // Only alert on non-retryable failures or after max retries
    if (!retryable) {
      const exists = await this.deps.alertExists(tenantId, 'sync_error');
      if (!exists) {
        const alertId = await this.deps.createAlert(
          tenantId,
          'sync_error',
          `Sync job failed: ${error}`,
          { jobId, error, retryable }
        );

        this.emitAlertTriggered({
          alertId,
          tenantId,
          type: 'sync_error',
          message: `Sync job failed: ${error}`,
          metadata: { jobId, error },
          channels: ['in_app'],
          createdAt: new Date(),
        });
      }
    }
  }

  /**
   * Handle channel disconnected event
   */
  private async handleChannelDisconnected(event: {
    payload: { tenantId: string; channelId: string; channelType: string; error?: string };
  }): Promise<void> {
    const { tenantId, channelId, channelType, error } = event.payload;

    const exists = await this.deps.alertExists(
      tenantId,
      'channel_disconnected',
      undefined,
      channelId
    );

    if (!exists) {
      const alertId = await this.deps.createAlert(
        tenantId,
        'channel_disconnected',
        `Channel ${channelType} disconnected${error ? `: ${error}` : ''}`,
        { channelId, channelType, error }
      );

      this.emitAlertTriggered({
        alertId,
        tenantId,
        type: 'channel_disconnected',
        message: `Channel ${channelType} disconnected`,
        metadata: { channelId, channelType, error },
        channels: ['in_app', 'email'],
        createdAt: new Date(),
      });
    }
  }

  /**
   * Handle drift detected event (for severe drifts)
   */
  private async handleDriftDetected(event: {
    payload: { tenantId: string; productId: string; sku: string; maxDrift: number; severity: string };
  }): Promise<void> {
    const { tenantId, productId, sku, maxDrift, severity } = event.payload;

    // Only create alert for high severity drifts
    if (severity === 'high') {
      const exists = await this.deps.alertExists(tenantId, 'sync_error', productId);
      if (!exists) {
        const alertId = await this.deps.createAlert(
          tenantId,
          'sync_error',
          `High stock drift detected for ${sku}: ${maxDrift} units difference`,
          { productId, sku, maxDrift, severity }
        );

        this.emitAlertTriggered({
          alertId,
          tenantId,
          type: 'sync_error',
          message: `High stock drift detected for ${sku}`,
          metadata: { productId, sku, maxDrift, severity },
          channels: ['in_app', 'email'],
          createdAt: new Date(),
        });
      }
    }
  }

  /**
   * Handle stock change event (for low stock detection)
   */
  private async handleStockChange(event: {
    payload: { tenantId: string; productId?: string; newQuantity: number; sku?: string };
  }): Promise<void> {
    const { tenantId, productId, newQuantity, sku } = event.payload;

    if (!productId) {
      return;
    }

    // Check if stock is now below threshold
    if (newQuantity <= this.config.lowStockThreshold) {
      const exists = await this.deps.alertExists(tenantId, 'low_stock', productId);
      if (!exists) {
        const product = await this.deps.getProduct(productId);
        if (product) {
          await this.createLowStockAlert(tenantId, product, this.config.lowStockThreshold);
        }
      }
    }
  }

  /**
   * Create a low stock alert
   */
  private async createLowStockAlert(
    tenantId: string,
    product: Product,
    threshold: number
  ): Promise<void> {
    const message =
      `Low stock alert: ${product.name} (${product.sku}) has ${product.currentStock} units ` +
      `(threshold: ${threshold})`;

    const alertId = await this.deps.createAlert(tenantId, 'low_stock', message, {
      productId: product.id,
      sku: product.sku,
      currentStock: product.currentStock,
      threshold,
    });

    this.emitAlertTriggered({
      alertId,
      tenantId,
      type: 'low_stock',
      message,
      metadata: {
        productId: product.id,
        sku: product.sku,
        currentStock: product.currentStock,
        threshold,
      },
      channels: ['in_app'],
      createdAt: new Date(),
    });

    this.log(`Created low stock alert for ${product.sku}: ${product.currentStock} units`);
  }

  /**
   * Create a channel disconnected alert
   */
  private async createChannelDisconnectedAlert(
    tenantId: string,
    channel: Channel,
    error?: string
  ): Promise<void> {
    const message = `Channel ${channel.name} (${channel.type}) is disconnected${error ? `: ${error}` : ''}`;

    const alertId = await this.deps.createAlert(tenantId, 'channel_disconnected', message, {
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.name,
      error,
    });

    this.emitAlertTriggered({
      alertId,
      tenantId,
      type: 'channel_disconnected',
      message,
      metadata: {
        channelId: channel.id,
        channelType: channel.type,
        channelName: channel.name,
        error,
      },
      channels: ['in_app', 'email'],
      createdAt: new Date(),
    });

    this.log(`Created channel disconnected alert for ${channel.name}`);
  }

  /**
   * Emit alert triggered event and prepare notification
   */
  private emitAlertTriggered(notification: AlertNotification): void {
    this.eventBus.emitAlertTriggered(notification);

    // In a real implementation, this would dispatch to notification services
    // For now, we log the notification intent
    if (notification.channels.includes('email')) {
      this.log(`[EMAIL NOTIFICATION PREPARED] ${notification.type}: ${notification.message}`);
      // TODO: Integrate with email service
    }

    if (notification.channels.includes('in_app')) {
      this.log(`[IN-APP NOTIFICATION] ${notification.type}: ${notification.message}`);
      // In-app notifications are handled via the eventBus subscription
    }
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[AlertAgent]`;
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

export function createAlertAgent(deps: AlertAgentDependencies): AlertAgent {
  return new AlertAgent(deps);
}
