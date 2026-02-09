/**
 * Sync Engine Types
 * Comprehensive type definitions for the AI Sync Engine agents
 */

// ============================================================================
// Channel & Product Types (matching backend schema)
// ============================================================================

export type ChannelType = 'eposnow' | 'wix' | 'deliveroo';
export type AlertType = 'low_stock' | 'sync_error' | 'channel_disconnected' | 'system';
export type SyncEventStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  credentialsEncrypted: string | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
}

export interface Product {
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

export interface ProductChannelMapping {
  id: string;
  productId: string;
  channelId: string;
  externalId: string;
  externalSku: string | null;
  createdAt: Date;
}

export interface Alert {
  id: string;
  tenantId: string;
  type: AlertType;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
}

// ============================================================================
// Engine Configuration
// ============================================================================

export interface SyncEngineConfig {
  /** Redis connection URL */
  redisUrl: string;
  /** Database connection URL */
  databaseUrl: string;
  /** Interval for sync operations in milliseconds */
  syncIntervalMs: number;
  /** Maximum number of products to sync in a single batch */
  batchSize: number;
  /** Maximum retry attempts for failed jobs */
  maxRetries: number;
  /** Number of concurrent job processors */
  concurrency: number;
  /** Guardian reconciliation interval in milliseconds (default: 15 minutes) */
  reconciliationIntervalMs: number;
  /** Drift threshold for auto-repair (default: 5 units) */
  driftAutoRepairThreshold: number;
  /** Low stock alert threshold (default: 10 units) */
  lowStockThreshold: number;
  /** Enable debug logging */
  debug?: boolean;
}

export const DEFAULT_ENGINE_CONFIG: Partial<SyncEngineConfig> = {
  syncIntervalMs: 5000,
  batchSize: 100,
  maxRetries: 3,
  concurrency: 5,
  reconciliationIntervalMs: 15 * 60 * 1000, // 15 minutes
  driftAutoRepairThreshold: 5,
  lowStockThreshold: 10,
  debug: false,
};

// ============================================================================
// Engine Status Types
// ============================================================================

export type AgentState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface AgentStatus {
  name: string;
  state: AgentState;
  lastActivity: Date | null;
  processedCount: number;
  errorCount: number;
  error?: string;
}

export interface EngineStatus {
  state: AgentState;
  startedAt: Date | null;
  uptime: number;
  agents: {
    watcher: AgentStatus;
    sync: AgentStatus;
    guardian: AgentStatus;
    alert: AgentStatus;
  };
  stats: EngineStats;
}

export interface EngineStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  productsUpdated: number;
  alertsCreated: number;
  driftsDetected: number;
  driftsRepaired: number;
  lastSyncAt: Date | null;
  lastReconciliationAt: Date | null;
}

// ============================================================================
// Stock Change Classification
// ============================================================================

export type StockChangeType = 'sale' | 'restock' | 'adjustment' | 'return' | 'order' | 'unknown';

export interface StockChange {
  /** Internal product ID (if mapped) */
  productId?: string;
  /** External product ID from the channel */
  externalId: string;
  /** Product SKU */
  sku?: string;
  /** Channel that reported the change */
  sourceChannelId: string;
  /** Channel type */
  sourceChannelType: ChannelType;
  /** Tenant ID */
  tenantId: string;
  /** Previous stock quantity (if known) */
  previousQuantity?: number;
  /** New stock quantity */
  newQuantity: number;
  /** Calculated change amount */
  changeAmount: number;
  /** Classification of the change */
  changeType: StockChangeType;
  /** Timestamp of the change */
  timestamp: Date;
  /** Original webhook/event payload */
  rawPayload?: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Webhook Processing Types
// ============================================================================

export interface WebhookProcessJobData {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  signature?: string;
}

export interface ProcessedWebhook {
  jobId: string;
  stockChanges: StockChange[];
  processedAt: Date;
  success: boolean;
  error?: string;
}

// ============================================================================
// Sync Job Types
// ============================================================================

export type SyncOperation = 'full_sync' | 'channel_sync' | 'product_sync' | 'stock_change';

export interface SyncJobData {
  tenantId: string;
  operation: SyncOperation;
  /** Source channel ID (where the change originated) */
  sourceChannelId?: string;
  /** Target channel IDs (where to sync to) - if empty, sync to all except source */
  targetChannelIds?: string[];
  /** Product IDs to sync */
  productIds?: string[];
  /** Stock change that triggered this sync */
  stockChange?: StockChange;
  /** Priority (lower = higher priority) */
  priority?: number;
  /** Initiator of the sync (user ID or 'system') */
  initiatedBy?: string;
  /** Force sync even if no changes detected */
  force?: boolean;
}

export interface SyncResult {
  jobId: string;
  tenantId: string;
  operation: SyncOperation;
  success: boolean;
  channelsUpdated: number;
  productsUpdated: number;
  errors: SyncError[];
  startedAt: Date;
  completedAt: Date;
  duration: number;
}

export interface SyncError {
  channelId?: string;
  productId?: string;
  externalId?: string;
  message: string;
  code: string;
  retryable: boolean;
}

// ============================================================================
// Conflict Resolution Types
// ============================================================================

export interface StockConflict {
  tenantId: string;
  productId: string;
  sku: string;
  conflicts: ChannelStockState[];
  resolvedValue: number;
  resolvedAt: Date;
  resolution: 'most_recent' | 'source_of_truth' | 'manual';
}

export interface ChannelStockState {
  channelId: string;
  channelType: ChannelType;
  channelName: string;
  externalId: string;
  quantity: number;
  lastUpdated: Date;
}

// ============================================================================
// Drift Detection Types
// ============================================================================

export interface DriftDetection {
  tenantId: string;
  productId: string;
  sku: string;
  productName: string;
  sourceOfTruth: ChannelStockState;
  driftingChannels: DriftingChannel[];
  maxDrift: number;
  detectedAt: Date;
  severity: 'low' | 'medium' | 'high';
}

export interface DriftingChannel {
  channelId: string;
  channelType: ChannelType;
  channelName: string;
  externalId: string;
  expectedQuantity: number;
  actualQuantity: number;
  drift: number;
}

export interface ReconciliationJobData {
  tenantId: string;
  scope: 'full' | 'channel' | 'product';
  channelId?: string;
  productId?: string;
  autoRepair: boolean;
}

export interface ReconciliationResult {
  tenantId: string;
  productsChecked: number;
  driftsDetected: number;
  driftsRepaired: number;
  driftsFlagged: number;
  errors: string[];
  startedAt: Date;
  completedAt: Date;
}

// ============================================================================
// Alert Job Types
// ============================================================================

export interface AlertCheckJobData {
  tenantId: string;
  checkType: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
  productId?: string;
  channelId?: string;
  threshold?: number;
}

export interface AlertRule {
  id: string;
  tenantId: string;
  type: AlertType;
  productId?: string;
  channelId?: string;
  threshold?: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface AlertNotification {
  alertId: string;
  tenantId: string;
  type: AlertType;
  message: string;
  metadata?: Record<string, unknown>;
  channels: ('in_app' | 'email')[];
  createdAt: Date;
}

// ============================================================================
// Event Types for Inter-Agent Communication
// ============================================================================

export interface StockChangeEvent {
  type: 'stock:change';
  payload: StockChange;
  timestamp: Date;
}

export interface SyncCompletedEvent {
  type: 'sync:completed';
  payload: SyncResult;
  timestamp: Date;
}

export interface SyncFailedEvent {
  type: 'sync:failed';
  payload: {
    jobId: string;
    tenantId: string;
    error: string;
    retryable: boolean;
  };
  timestamp: Date;
}

export interface DriftDetectedEvent {
  type: 'drift:detected';
  payload: DriftDetection;
  timestamp: Date;
}

export interface DriftRepairedEvent {
  type: 'drift:repaired';
  payload: {
    tenantId: string;
    productId: string;
    repairedChannels: string[];
    newQuantity: number;
  };
  timestamp: Date;
}

export interface AlertTriggeredEvent {
  type: 'alert:triggered';
  payload: AlertNotification;
  timestamp: Date;
}

export interface ChannelDisconnectedEvent {
  type: 'channel:disconnected';
  payload: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    error?: string;
  };
  timestamp: Date;
}

export interface ChannelConnectedEvent {
  type: 'channel:connected';
  payload: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
  };
  timestamp: Date;
}

export type SyncEngineEvent =
  | StockChangeEvent
  | SyncCompletedEvent
  | SyncFailedEvent
  | DriftDetectedEvent
  | DriftRepairedEvent
  | AlertTriggeredEvent
  | ChannelDisconnectedEvent
  | ChannelConnectedEvent;

export type SyncEngineEventType = SyncEngineEvent['type'];

// ============================================================================
// Database Operation Types
// ============================================================================

export interface SyncEventRecord {
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

// ============================================================================
// Buffer Stock Calculation
// ============================================================================

export interface BufferStockCalculation {
  actualStock: number;
  bufferStock: number;
  onlineStock: number;
  isOnlineChannel: boolean;
}

/**
 * Calculate the stock to show on online channels after applying buffer
 * Online channels get: actual_stock - buffer_stock
 * If actual is 10 and buffer is 2, online shows 8
 */
export function calculateOnlineStock(actualStock: number, bufferStock: number): number {
  return Math.max(0, actualStock - bufferStock);
}

/**
 * Determine if a channel type is considered "online" for buffer stock purposes
 */
export function isOnlineChannel(channelType: ChannelType): boolean {
  // Eposnow is the POS (in-store), Wix and Deliveroo are online
  return channelType === 'wix' || channelType === 'deliveroo';
}

// ============================================================================
// Product Mapping Types
// ============================================================================

export type MappingStrategy = 'sku' | 'barcode' | 'name_fuzzy' | 'manual';

export interface MappingConfidence {
  strategy: MappingStrategy;
  score: number; // 0-1
  matched: boolean;
}

export interface ProductMapping {
  sourceProductId: string;
  targetProductId: string;
  sourceChannel: string;
  targetChannel: string;
  matchStrategy: MappingStrategy;
  confidence: number; // 0-1
  mappedAt: Date;
}

export interface ProductMapperOptions {
  fuzzyMatchThreshold?: number; // 0-1, default 0.6
  debug?: boolean;
}
