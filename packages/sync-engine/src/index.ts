/**
 * StockClerk - Sync Engine
 * AI-powered real-time inventory synchronization engine with 4 intelligent agents
 *
 * Agents:
 * - Watcher Agent: Listens for webhook events, detects and classifies stock changes
 * - Sync Agent: Performs multi-channel atomic updates with buffer stock rules
 * - Guardian Agent: Runs scheduled reconciliation to detect and repair drift
 * - Alert Agent: Monitors stock levels and dispatches notifications
 *
 * @packageDocumentation
 */

// ============================================================================
// Main Engine
// ============================================================================

export {
  SyncEngine,
  createSyncEngine,
  type SyncEngineDependencies,
} from './engine.js';

// ============================================================================
// Agents
// ============================================================================

export {
  // Watcher Agent
  WatcherAgent,
  createWatcherAgent,
  type WatcherAgentDependencies,

  // Sync Agent
  SyncAgent,
  createSyncAgent,
  type SyncAgentDependencies,

  // Guardian Agent
  GuardianAgent,
  createGuardianAgent,
  type GuardianAgentDependencies,

  // Alert Agent
  AlertAgent,
  createAlertAgent,
  type AlertAgentDependencies,
} from './agents/index.js';

// ============================================================================
// Event Bus
// ============================================================================

export {
  SyncEngineEventBus,
  createEventBus,
  type SyncEngineEventMap,
} from './events.js';

// ============================================================================
// Types
// ============================================================================

export type {
  // Channel & Product types
  ChannelType,
  AlertType,
  SyncEventStatus,
  Channel,
  Product,
  ProductChannelMapping,
  Alert,

  // Engine configuration
  SyncEngineConfig,
  AgentState,
  AgentStatus,
  EngineStatus,
  EngineStats,

  // Stock changes
  StockChangeType,
  StockChange,
  WebhookProcessJobData,
  ProcessedWebhook,

  // Sync operations
  SyncOperation,
  SyncJobData,
  SyncResult,
  SyncError,

  // Conflict resolution
  StockConflict,
  ChannelStockState,

  // Drift detection
  DriftDetection,
  DriftingChannel,
  ReconciliationJobData,
  ReconciliationResult,

  // Alerts
  AlertCheckJobData,
  AlertRule,
  AlertNotification,

  // Events
  SyncEngineEvent,
  SyncEngineEventType,
  StockChangeEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  DriftDetectedEvent,
  DriftRepairedEvent,
  AlertTriggeredEvent,
  ChannelDisconnectedEvent,
  ChannelConnectedEvent,

  // Database operations
  SyncEventRecord,

  // Buffer stock
  BufferStockCalculation,
} from './types.js';

// ============================================================================
// Utility Functions
// ============================================================================

export {
  calculateOnlineStock,
  isOnlineChannel,
  DEFAULT_ENGINE_CONFIG,
} from './types.js';
