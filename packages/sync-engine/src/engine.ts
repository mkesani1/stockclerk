/**
 * Sync Engine Orchestrator
 * Coordinates all AI agents (Watcher, Sync, Guardian, Alert) and manages their lifecycle.
 */

import { Redis } from 'ioredis';
import { SyncEngineEventBus, createEventBus } from './events.js';
import { WatcherAgent, createWatcherAgent, WatcherAgentDependencies } from './agents/watcher.js';
import { SyncAgent, createSyncAgent, SyncAgentDependencies } from './agents/sync.js';
import { GuardianAgent, createGuardianAgent, GuardianAgentDependencies } from './agents/guardian.js';
import { AlertAgent, createAlertAgent, AlertAgentDependencies } from './agents/alert.js';
import type {
  SyncEngineConfig,
  EngineStatus,
  EngineStats,
  AgentStatus,
  AgentState,
  DEFAULT_ENGINE_CONFIG,
  ChannelType,
  AlertType,
  Channel,
  Product,
  ProductChannelMapping,
  AlertRule,
  SyncEventRecord,
} from './types.js';

// ============================================================================
// Engine Dependencies Interface
// ============================================================================

export interface SyncEngineDependencies {
  // Product/Channel data access
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

  // Stock operations
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

  // Sync events/audit
  createSyncEvent: (event: SyncEventRecord) => Promise<string>;
  updateSyncEventStatus: (
    eventId: string,
    status: SyncEventRecord['status'],
    errorMessage?: string
  ) => Promise<void>;

  // Alerts
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

  // Channel health
  checkChannelHealth: (channelId: string) => Promise<{
    connected: boolean;
    lastChecked: Date;
    error?: string;
  }>;

  // Tenant operations
  getAllTenantIds: () => Promise<string[]>;
}

// ============================================================================
// Sync Engine Class
// ============================================================================

export class SyncEngine {
  private readonly config: SyncEngineConfig;
  private readonly redis: Redis;
  private readonly eventBus: SyncEngineEventBus;
  private readonly deps: SyncEngineDependencies;

  private watcherAgent: WatcherAgent | null = null;
  private syncAgent: SyncAgent | null = null;
  private guardianAgent: GuardianAgent | null = null;
  private alertAgent: AlertAgent | null = null;

  private state: AgentState = 'stopped';
  private startedAt: Date | null = null;
  private stats: EngineStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    productsUpdated: 0,
    alertsCreated: 0,
    driftsDetected: 0,
    driftsRepaired: 0,
    lastSyncAt: null,
    lastReconciliationAt: null,
  };

  constructor(config: SyncEngineConfig, deps: SyncEngineDependencies) {
    this.config = { ...config };
    this.deps = deps;

    // Initialize Redis connection
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.redis.on('error', (err: Error) => {
      console.error('[SyncEngine] Redis error:', err);
    });

    this.redis.on('connect', () => {
      this.log('Redis connected');
    });

    // Initialize event bus
    this.eventBus = createEventBus(config.debug);

    // Set up stats tracking via events
    this.setupStatsTracking();
  }

  /**
   * Start the Sync Engine and all agents
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      this.log('Engine already running');
      return;
    }

    this.state = 'starting';
    this.log('Starting Sync Engine...');

    try {
      // Create and start Watcher Agent
      this.watcherAgent = createWatcherAgent({
        redis: this.redis,
        eventBus: this.eventBus,
        config: this.config,
        getProductMapping: this.deps.getProductMapping,
        getChannel: async (channelId: string) => {
          const channel = await this.deps.getChannel(channelId);
          return channel ? { type: channel.type, name: channel.name } : null;
        },
      });
      await this.watcherAgent.start();

      // Create and start Sync Agent
      this.syncAgent = createSyncAgent({
        redis: this.redis,
        eventBus: this.eventBus,
        config: this.config,
        getChannels: this.deps.getChannels,
        getChannel: this.deps.getChannel,
        getProduct: this.deps.getProduct,
        getProductByExternalId: this.deps.getProductByExternalId,
        getProductMappings: this.deps.getProductMappings,
        updateProductStock: this.deps.updateProductStock,
        updateChannelStock: this.deps.updateChannelStock,
        createSyncEvent: this.deps.createSyncEvent,
        updateSyncEventStatus: this.deps.updateSyncEventStatus,
        getChannelStock: this.deps.getChannelStock,
      });
      await this.syncAgent.start();

      // Create and start Guardian Agent
      this.guardianAgent = createGuardianAgent({
        redis: this.redis,
        eventBus: this.eventBus,
        config: this.config,
        getAllTenantIds: this.deps.getAllTenantIds,
        getChannels: this.deps.getChannels,
        getProducts: this.deps.getProducts,
        getProductMappings: this.deps.getProductMappings,
        getChannelStock: this.deps.getChannelStock,
        updateProductStock: this.deps.updateProductStock,
        updateChannelStock: this.deps.updateChannelStock,
        createAlert: this.deps.createAlert,
      });
      await this.guardianAgent.start();

      // Create and start Alert Agent
      this.alertAgent = createAlertAgent({
        redis: this.redis,
        eventBus: this.eventBus,
        config: this.config,
        getAllTenantIds: this.deps.getAllTenantIds,
        getChannels: this.deps.getChannels,
        getProducts: this.deps.getProducts,
        getProduct: this.deps.getProduct,
        getAlertRules: this.deps.getAlertRules,
        createAlert: this.deps.createAlert,
        alertExists: this.deps.alertExists,
        checkChannelHealth: this.deps.checkChannelHealth,
      });
      await this.alertAgent.start();

      this.state = 'running';
      this.startedAt = new Date();

      this.log('Sync Engine started successfully with all agents');
    } catch (error) {
      this.state = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Failed to start engine: ${errorMessage}`, 'error');

      // Clean up any started agents
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the Sync Engine and all agents
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.log('Stopping Sync Engine...');

    try {
      // Stop all agents in reverse order
      if (this.alertAgent) {
        await this.alertAgent.stop();
        this.alertAgent = null;
      }

      if (this.guardianAgent) {
        await this.guardianAgent.stop();
        this.guardianAgent = null;
      }

      if (this.syncAgent) {
        await this.syncAgent.stop();
        this.syncAgent = null;
      }

      if (this.watcherAgent) {
        await this.watcherAgent.stop();
        this.watcherAgent = null;
      }

      // Close Redis connection
      await this.redis.quit();

      // Clear event listeners
      this.eventBus.removeAllListenersFor();

      this.state = 'stopped';
      this.log('Sync Engine stopped');
    } catch (error) {
      this.state = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Error stopping engine: ${errorMessage}`, 'error');
      throw error;
    }
  }

  /**
   * Trigger a full sync for a tenant
   */
  async triggerFullSync(tenantId: string): Promise<void> {
    if (this.state !== 'running' || !this.syncAgent) {
      throw new Error('Sync Engine not running');
    }

    this.log(`Triggering full sync for tenant ${tenantId}`);
    await this.syncAgent.triggerFullSync(tenantId);
  }

  /**
   * Trigger a channel sync
   */
  async triggerChannelSync(tenantId: string, channelId: string): Promise<void> {
    if (this.state !== 'running' || !this.syncAgent) {
      throw new Error('Sync Engine not running');
    }

    this.log(`Triggering channel sync for tenant ${tenantId}, channel ${channelId}`);
    await this.syncAgent.triggerChannelSync(tenantId, channelId);
  }

  /**
   * Trigger a product sync
   */
  async triggerProductSync(tenantId: string, productId: string): Promise<void> {
    if (this.state !== 'running' || !this.syncAgent) {
      throw new Error('Sync Engine not running');
    }

    this.log(`Triggering product sync for tenant ${tenantId}, product ${productId}`);
    await this.syncAgent.triggerProductSync(tenantId, productId);
  }

  /**
   * Trigger a reconciliation
   */
  async triggerReconciliation(
    tenantId: string,
    options?: { autoRepair?: boolean }
  ): Promise<void> {
    if (this.state !== 'running' || !this.guardianAgent) {
      throw new Error('Sync Engine not running');
    }

    this.log(`Triggering reconciliation for tenant ${tenantId}`);
    await this.guardianAgent.triggerReconciliation(tenantId, 'full', options);
  }

  /**
   * Get the overall engine status
   */
  getStatus(): EngineStatus {
    const uptime = this.startedAt
      ? Date.now() - this.startedAt.getTime()
      : 0;

    return {
      state: this.state,
      startedAt: this.startedAt,
      uptime,
      agents: {
        watcher: this.watcherAgent?.getStatus() ?? this.getStoppedAgentStatus('watcher'),
        sync: this.syncAgent?.getStatus() ?? this.getStoppedAgentStatus('sync'),
        guardian: this.guardianAgent?.getStatus() ?? this.getStoppedAgentStatus('guardian'),
        alert: this.alertAgent?.getStatus() ?? this.getStoppedAgentStatus('alert'),
      },
      stats: { ...this.stats },
    };
  }

  /**
   * Get the status of a specific agent
   */
  getAgentStatus(agentName: 'watcher' | 'sync' | 'guardian' | 'alert'): AgentStatus {
    switch (agentName) {
      case 'watcher':
        return this.watcherAgent?.getStatus() ?? this.getStoppedAgentStatus('watcher');
      case 'sync':
        return this.syncAgent?.getStatus() ?? this.getStoppedAgentStatus('sync');
      case 'guardian':
        return this.guardianAgent?.getStatus() ?? this.getStoppedAgentStatus('guardian');
      case 'alert':
        return this.alertAgent?.getStatus() ?? this.getStoppedAgentStatus('alert');
      default:
        throw new Error(`Unknown agent: ${agentName}`);
    }
  }

  /**
   * Get the event bus for external subscriptions
   */
  getEventBus(): SyncEngineEventBus {
    return this.eventBus;
  }

  /**
   * Add a webhook job to be processed by the Watcher Agent
   */
  async addWebhookJob(data: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    eventType: string;
    payload: Record<string, unknown>;
    signature?: string;
  }): Promise<string> {
    if (this.state !== 'running' || !this.watcherAgent) {
      throw new Error('Sync Engine not running');
    }

    return this.watcherAgent.addWebhookJob({
      ...data,
      receivedAt: new Date(),
    });
  }

  /**
   * Set up stats tracking via event subscriptions
   */
  private setupStatsTracking(): void {
    this.eventBus.onSyncCompleted((event) => {
      this.stats.totalSyncs++;
      if (event.payload.success) {
        this.stats.successfulSyncs++;
      } else {
        this.stats.failedSyncs++;
      }
      this.stats.productsUpdated += event.payload.productsUpdated;
      this.stats.lastSyncAt = event.timestamp;
    });

    this.eventBus.onSyncFailed(() => {
      this.stats.totalSyncs++;
      this.stats.failedSyncs++;
    });

    this.eventBus.onDriftDetected(() => {
      this.stats.driftsDetected++;
      this.stats.lastReconciliationAt = new Date();
    });

    this.eventBus.onDriftRepaired(() => {
      this.stats.driftsRepaired++;
    });

    this.eventBus.onAlertTriggered(() => {
      this.stats.alertsCreated++;
    });
  }

  /**
   * Get a default stopped agent status
   */
  private getStoppedAgentStatus(name: string): AgentStatus {
    return {
      name,
      state: 'stopped',
      lastActivity: null,
      processedCount: 0,
      errorCount: 0,
    };
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[SyncEngine]`;
    const timestamp = new Date().toISOString();

    switch (level) {
      case 'error':
        console.error(`${timestamp} ${prefix} ERROR: ${message}`);
        break;
      case 'warn':
        console.warn(`${timestamp} ${prefix} WARN: ${message}`);
        break;
      default:
        console.log(`${timestamp} ${prefix} ${message}`);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SyncEngine instance
 */
export function createSyncEngine(
  config: SyncEngineConfig,
  deps: SyncEngineDependencies
): SyncEngine {
  return new SyncEngine(config, deps);
}

// ============================================================================
// Re-export agent factories for direct use
// ============================================================================

export {
  createWatcherAgent,
  createSyncAgent,
  createGuardianAgent,
  createAlertAgent,
};

export type {
  WatcherAgent,
  SyncAgent,
  GuardianAgent,
  AlertAgent,
  WatcherAgentDependencies,
  SyncAgentDependencies,
  GuardianAgentDependencies,
  AlertAgentDependencies,
};
