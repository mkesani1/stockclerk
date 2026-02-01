/**
 * Guardian Agent
 * Runs scheduled reconciliation every 15 minutes, compares stock across all channels,
 * detects drift (mismatches), auto-repairs small discrepancies, flags large ones for review.
 */

import { Worker, Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SyncEngineEventBus } from '../events.js';
import type {
  AgentStatus,
  AgentState,
  ReconciliationJobData,
  ReconciliationResult,
  DriftDetection,
  DriftingChannel,
  ChannelStockState,
  Channel,
  Product,
  ProductChannelMapping,
  SyncEngineConfig,
  ChannelType,
  AlertType,
} from '../types.js';
import { calculateOnlineStock, isOnlineChannel } from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const QUEUE_NAME = 'stockclerk:guardian:reconcile';
const AGENT_NAME = 'guardian';

// ============================================================================
// Guardian Agent Dependencies
// ============================================================================

export interface GuardianAgentDependencies {
  redis: Redis;
  eventBus: SyncEngineEventBus;
  config: SyncEngineConfig;
  /** Get all tenants for reconciliation */
  getAllTenantIds: () => Promise<string[]>;
  /** Get all active channels for a tenant */
  getChannels: (tenantId: string) => Promise<Channel[]>;
  /** Get all products for a tenant */
  getProducts: (tenantId: string) => Promise<Product[]>;
  /** Get all channel mappings for a product */
  getProductMappings: (productId: string) => Promise<(ProductChannelMapping & { channel: Channel })[]>;
  /** Get current stock from external channel */
  getChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string
  ) => Promise<number | null>;
  /** Update product stock in database */
  updateProductStock: (productId: string, newStock: number) => Promise<void>;
  /** Update stock on external channel */
  updateChannelStock: (
    channelId: string,
    channelType: ChannelType,
    externalId: string,
    quantity: number
  ) => Promise<void>;
  /** Create an alert */
  createAlert: (
    tenantId: string,
    type: AlertType,
    message: string,
    metadata?: Record<string, unknown>
  ) => Promise<string>;
}

// ============================================================================
// Guardian Agent Class
// ============================================================================

export class GuardianAgent {
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly config: SyncEngineConfig;
  private readonly deps: GuardianAgentDependencies;

  private queue: Queue<ReconciliationJobData> | null = null;
  private worker: Worker<ReconciliationJobData> | null = null;
  private state: AgentState = 'stopped';
  private processedCount = 0;
  private errorCount = 0;
  private lastActivity: Date | null = null;
  private lastError: string | undefined;
  private reconciliationTimer: NodeJS.Timeout | null = null;

  constructor(deps: GuardianAgentDependencies) {
    this.redis = deps.redis;
    this.eventBus = deps.eventBus;
    this.config = deps.config;
    this.deps = deps;
  }

  /**
   * Start the Guardian Agent
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.state = 'starting';
    this.log('Starting Guardian Agent...');

    try {
      // Create the reconciliation queue
      this.queue = new Queue<ReconciliationJobData>(QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          attempts: this.config.maxRetries,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 100,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        },
      });

      // Create the worker
      this.worker = new Worker<ReconciliationJobData>(
        QUEUE_NAME,
        this.processReconciliation.bind(this),
        {
          connection: this.redis,
          concurrency: 1, // Run reconciliation serially
        }
      );

      // Set up worker event handlers
      this.worker.on('completed', (job) => {
        this.processedCount++;
        this.lastActivity = new Date();
        this.log(`Reconciliation job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        this.errorCount++;
        this.lastActivity = new Date();
        this.lastError = err.message;
        this.log(`Reconciliation job ${job?.id} failed: ${err.message}`, 'error');
      });

      this.worker.on('error', (err) => {
        this.errorCount++;
        this.lastError = err.message;
        this.log(`Worker error: ${err.message}`, 'error');
      });

      // Add repeatable job for scheduled reconciliation
      await this.queue.add(
        'scheduled-reconciliation',
        {
          tenantId: '*', // Special marker for all tenants
          scope: 'full',
          autoRepair: true,
        },
        {
          repeat: {
            every: this.config.reconciliationIntervalMs,
          },
          jobId: 'guardian-scheduled',
        }
      );

      this.state = 'running';
      this.log(
        `Guardian Agent started - reconciliation every ${this.config.reconciliationIntervalMs / 1000 / 60} minutes`
      );
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Stop the Guardian Agent
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.log('Stopping Guardian Agent...');

    try {
      // Clear the scheduled timer
      if (this.reconciliationTimer) {
        clearInterval(this.reconciliationTimer);
        this.reconciliationTimer = null;
      }

      // Remove repeatable job
      if (this.queue) {
        await this.queue.removeRepeatableByKey('scheduled-reconciliation:guardian-scheduled');
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
      this.log('Guardian Agent stopped');
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
   * Trigger an immediate reconciliation
   */
  async triggerReconciliation(
    tenantId: string,
    scope: 'full' | 'channel' | 'product' = 'full',
    options?: {
      channelId?: string;
      productId?: string;
      autoRepair?: boolean;
    }
  ): Promise<string> {
    if (!this.queue) {
      throw new Error('Guardian Agent not started');
    }

    const job = await this.queue.add('manual-reconciliation', {
      tenantId,
      scope,
      channelId: options?.channelId,
      productId: options?.productId,
      autoRepair: options?.autoRepair ?? true,
    });

    return job.id || '';
  }

  /**
   * Process a reconciliation job
   */
  private async processReconciliation(job: Job<ReconciliationJobData>): Promise<ReconciliationResult> {
    const startedAt = new Date();
    const { tenantId, scope, channelId, productId, autoRepair } = job.data;

    this.log(`Processing reconciliation: scope=${scope}, tenant=${tenantId}`);

    let productsChecked = 0;
    let driftsDetected = 0;
    let driftsRepaired = 0;
    let driftsFlagged = 0;
    const errors: string[] = [];

    try {
      // Get tenants to reconcile
      const tenantIds =
        tenantId === '*' ? await this.deps.getAllTenantIds() : [tenantId];

      for (const tid of tenantIds) {
        const result = await this.reconcileTenant(
          tid,
          scope,
          { channelId, productId, autoRepair }
        );

        productsChecked += result.productsChecked;
        driftsDetected += result.driftsDetected;
        driftsRepaired += result.driftsRepaired;
        driftsFlagged += result.driftsFlagged;
        errors.push(...result.errors);
      }

      const completedAt = new Date();

      return {
        tenantId,
        productsChecked,
        driftsDetected,
        driftsRepaired,
        driftsFlagged,
        errors,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);
      throw error;
    }
  }

  /**
   * Reconcile a single tenant's inventory
   */
  private async reconcileTenant(
    tenantId: string,
    scope: 'full' | 'channel' | 'product',
    options: {
      channelId?: string;
      productId?: string;
      autoRepair: boolean;
    }
  ): Promise<ReconciliationResult> {
    const startedAt = new Date();
    let productsChecked = 0;
    let driftsDetected = 0;
    let driftsRepaired = 0;
    let driftsFlagged = 0;
    const errors: string[] = [];

    const channels = await this.deps.getChannels(tenantId);
    const activeChannels = channels.filter((c) => c.isActive);

    if (activeChannels.length < 2) {
      this.log(`Tenant ${tenantId} has less than 2 active channels - skipping reconciliation`);
      return {
        tenantId,
        productsChecked,
        driftsDetected,
        driftsRepaired,
        driftsFlagged,
        errors,
        startedAt,
        completedAt: new Date(),
      };
    }

    // Find the source of truth (Eposnow POS)
    const sourceOfTruth = activeChannels.find((c) => c.type === 'eposnow');
    if (!sourceOfTruth) {
      this.log(`Tenant ${tenantId} has no Eposnow channel - using first channel as source of truth`, 'warn');
    }
    const truthChannel = sourceOfTruth || activeChannels[0];

    // Get products to check
    let products: Product[];
    if (options.productId) {
      const product = await this.getProductById(tenantId, options.productId);
      products = product ? [product] : [];
    } else {
      products = await this.deps.getProducts(tenantId);
    }

    // Check each product
    for (const product of products) {
      try {
        productsChecked++;
        const driftResult = await this.checkProductDrift(
          tenantId,
          product,
          activeChannels,
          truthChannel
        );

        if (driftResult) {
          driftsDetected++;

          // Emit drift detected event
          this.eventBus.emitDriftDetected(driftResult);

          // Handle based on severity
          if (driftResult.maxDrift < this.config.driftAutoRepairThreshold && options.autoRepair) {
            // Auto-repair small drifts
            const repaired = await this.repairDrift(tenantId, product, driftResult, truthChannel);
            if (repaired) {
              driftsRepaired++;
            } else {
              driftsFlagged++;
            }
          } else {
            // Flag large drifts for human review
            driftsFlagged++;
            await this.flagDriftForReview(tenantId, product, driftResult);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Product ${product.id}: ${errorMessage}`);
        this.log(`Error checking drift for product ${product.id}: ${errorMessage}`, 'error');
      }
    }

    return {
      tenantId,
      productsChecked,
      driftsDetected,
      driftsRepaired,
      driftsFlagged,
      errors,
      startedAt,
      completedAt: new Date(),
    };
  }

  /**
   * Check if a product has drift across channels
   */
  private async checkProductDrift(
    tenantId: string,
    product: Product,
    channels: Channel[],
    sourceOfTruth: Channel
  ): Promise<DriftDetection | null> {
    const mappings = await this.deps.getProductMappings(product.id);
    const channelStates: ChannelStockState[] = [];
    let truthState: ChannelStockState | null = null;

    // Get current stock from each channel
    for (const mapping of mappings) {
      const channel = channels.find((c) => c.id === mapping.channelId);
      if (!channel || !channel.isActive) {
        continue;
      }

      try {
        const currentStock = await this.deps.getChannelStock(
          mapping.channelId,
          channel.type,
          mapping.externalId
        );

        if (currentStock !== null) {
          const state: ChannelStockState = {
            channelId: channel.id,
            channelType: channel.type,
            channelName: channel.name,
            externalId: mapping.externalId,
            quantity: currentStock,
            lastUpdated: new Date(), // Would ideally come from channel
          };

          channelStates.push(state);

          if (channel.id === sourceOfTruth.id) {
            truthState = state;
          }
        }
      } catch (error) {
        this.log(
          `Failed to get stock from channel ${channel.name} for product ${product.sku}: ${error}`,
          'warn'
        );
      }
    }

    if (channelStates.length < 2 || !truthState) {
      return null; // Not enough data to detect drift
    }

    // Check for drift
    const driftingChannels: DriftingChannel[] = [];
    let maxDrift = 0;

    for (const state of channelStates) {
      if (state.channelId === sourceOfTruth.id) {
        continue;
      }

      // Calculate expected stock for this channel
      const expectedStock = isOnlineChannel(state.channelType)
        ? calculateOnlineStock(truthState.quantity, product.bufferStock)
        : truthState.quantity;

      const drift = Math.abs(state.quantity - expectedStock);

      if (drift > 0) {
        maxDrift = Math.max(maxDrift, drift);
        driftingChannels.push({
          channelId: state.channelId,
          channelType: state.channelType,
          channelName: state.channelName,
          externalId: state.externalId,
          expectedQuantity: expectedStock,
          actualQuantity: state.quantity,
          drift,
        });
      }
    }

    if (driftingChannels.length === 0) {
      return null; // No drift detected
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high';
    if (maxDrift < this.config.driftAutoRepairThreshold) {
      severity = 'low';
    } else if (maxDrift < this.config.driftAutoRepairThreshold * 2) {
      severity = 'medium';
    } else {
      severity = 'high';
    }

    return {
      tenantId,
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      sourceOfTruth: truthState,
      driftingChannels,
      maxDrift,
      detectedAt: new Date(),
      severity,
    };
  }

  /**
   * Auto-repair drift by syncing from source of truth
   */
  private async repairDrift(
    tenantId: string,
    product: Product,
    drift: DriftDetection,
    sourceOfTruth: Channel
  ): Promise<boolean> {
    this.log(
      `Auto-repairing drift for product ${product.sku}: ${drift.driftingChannels.length} channels`
    );

    const repairedChannels: string[] = [];

    try {
      // Update our database to match source of truth
      await this.deps.updateProductStock(product.id, drift.sourceOfTruth.quantity);

      // Sync to all drifting channels
      for (const driftingChannel of drift.driftingChannels) {
        try {
          await this.deps.updateChannelStock(
            driftingChannel.channelId,
            driftingChannel.channelType,
            driftingChannel.externalId,
            driftingChannel.expectedQuantity
          );
          repairedChannels.push(driftingChannel.channelId);
        } catch (error) {
          this.log(
            `Failed to repair channel ${driftingChannel.channelName}: ${error}`,
            'error'
          );
        }
      }

      if (repairedChannels.length > 0) {
        // Emit drift repaired event
        this.eventBus.emitDriftRepaired({
          tenantId,
          productId: product.id,
          repairedChannels,
          newQuantity: drift.sourceOfTruth.quantity,
        });

        this.log(
          `Drift repaired for product ${product.sku}: ${repairedChannels.length}/${drift.driftingChannels.length} channels fixed`
        );
      }

      return repairedChannels.length === drift.driftingChannels.length;
    } catch (error) {
      this.log(`Failed to repair drift for product ${product.sku}: ${error}`, 'error');
      return false;
    }
  }

  /**
   * Flag a large drift for human review
   */
  private async flagDriftForReview(
    tenantId: string,
    product: Product,
    drift: DriftDetection
  ): Promise<void> {
    const channelNames = drift.driftingChannels.map((c) => c.channelName).join(', ');
    const message =
      `Stock drift detected for ${product.name} (${product.sku}): ` +
      `${drift.maxDrift} unit${drift.maxDrift > 1 ? 's' : ''} difference across channels (${channelNames}). ` +
      `Source of truth (${drift.sourceOfTruth.channelName}): ${drift.sourceOfTruth.quantity} units.`;

    await this.deps.createAlert(tenantId, 'sync_error', message, {
      productId: product.id,
      sku: product.sku,
      drift: drift.maxDrift,
      severity: drift.severity,
      driftingChannels: drift.driftingChannels,
      sourceOfTruth: drift.sourceOfTruth,
    });

    this.log(`Flagged drift for review: ${product.sku} (${drift.maxDrift} units drift)`);
  }

  /**
   * Helper to get a product by ID
   */
  private async getProductById(tenantId: string, productId: string): Promise<Product | null> {
    const products = await this.deps.getProducts(tenantId);
    return products.find((p) => p.id === productId) || null;
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[GuardianAgent]`;
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

export function createGuardianAgent(deps: GuardianAgentDependencies): GuardianAgent {
  return new GuardianAgent(deps);
}
