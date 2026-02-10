/**
 * IPC Message Types for Tenant Worker Isolation
 *
 * Communication between TenantOrchestrator (parent) and TenantWorker (child process).
 * All messages are JSON-serializable for child_process IPC.
 */

// ============================================================================
// Parent → Child Messages
// ============================================================================

export interface InitMessage {
  type: 'init';
  tenantId: string;
  config: TenantWorkerConfig;
}

export interface TriggerSyncMessage {
  type: 'trigger_sync';
  channelId: string;
  operation: 'full' | 'channel' | 'product';
  productId?: string;
}

export interface TriggerReconciliationMessage {
  type: 'trigger_reconciliation';
  autoRepair?: boolean;
}

export interface AddWebhookJobMessage {
  type: 'add_webhook_job';
  channelId: string;
  channelType: string;
  eventType: string;
  payload: Record<string, unknown>;
  signature?: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
  graceful: boolean;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export type ParentMessage =
  | InitMessage
  | TriggerSyncMessage
  | TriggerReconciliationMessage
  | AddWebhookJobMessage
  | ShutdownMessage
  | PingMessage;

// ============================================================================
// Child → Parent Messages
// ============================================================================

export interface ReadyMessage {
  type: 'ready';
  tenantId: string;
  pid: number;
}

export interface HealthReportMessage {
  type: 'health_report';
  tenantId: string;
  status: TenantHealthStatus;
}

export interface PongMessage {
  type: 'pong';
  tenantId: string;
  timestamp: number;
  latencyMs: number;
}

export interface ErrorReportMessage {
  type: 'error_report';
  tenantId: string;
  error: string;
  fatal: boolean;
}

export interface SyncEventMessage {
  type: 'sync_event';
  tenantId: string;
  eventType: 'sync_started' | 'sync_completed' | 'sync_failed' | 'stock_updated' | 'alert_created';
  data: Record<string, unknown>;
}

export interface ShutdownCompleteMessage {
  type: 'shutdown_complete';
  tenantId: string;
}

export type ChildMessage =
  | ReadyMessage
  | HealthReportMessage
  | PongMessage
  | ErrorReportMessage
  | SyncEventMessage
  | ShutdownCompleteMessage;

// ============================================================================
// Shared Types
// ============================================================================

export interface TenantWorkerConfig {
  redisUrl: string;
  databaseUrl: string;
  encryptionKey?: string;
  queuePrefix: string;          // e.g., 'stockclerk:tenant-abc'
  guardianIntervalMs: number;   // Per-tenant guardian cycle
  healthReportIntervalMs: number;
  maxRetries: number;
  workerConcurrency: {
    sync: number;
    webhook: number;
    alert: number;
    stockUpdate: number;
  };
}

export interface TenantHealthStatus {
  tenantId: string;
  state: 'starting' | 'running' | 'degraded' | 'error' | 'stopping' | 'stopped';
  uptime: number;               // ms since start
  lastActivity: string | null;  // ISO timestamp
  agents: {
    watcher: AgentHealthInfo;
    sync: AgentHealthInfo;
    guardian: AgentHealthInfo;
    alert: AgentHealthInfo;
  };
  queues: {
    sync: QueueHealthInfo;
    webhook: QueueHealthInfo;
    alert: QueueHealthInfo;
    stockUpdate: QueueHealthInfo;
  };
  memory: {
    heapUsed: number;   // bytes
    heapTotal: number;
    rss: number;
  };
  errors: {
    total: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
}

export interface AgentHealthInfo {
  state: 'running' | 'idle' | 'error' | 'stopped';
  processedCount: number;
  errorCount: number;
  lastActivity: string | null;
}

export interface QueueHealthInfo {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// ============================================================================
// Orchestrator-level Types
// ============================================================================

export interface TenantWorkerInfo {
  tenantId: string;
  pid: number;
  state: 'spawning' | 'ready' | 'running' | 'crashed' | 'stopping' | 'stopped';
  startedAt: Date;
  lastHealthReport: TenantHealthStatus | null;
  lastPingAt: Date | null;
  lastPongAt: Date | null;
  restartCount: number;
  maxRestarts: number;
  consecutiveFailures: number;
}

export interface OrchestratorConfig {
  redisUrl: string;
  databaseUrl: string;
  encryptionKey?: string;
  healthCheckIntervalMs: number;    // How often to ping workers
  healthTimeoutMs: number;          // How long to wait for pong
  maxRestartsPerTenant: number;     // Max restarts before giving up
  restartBackoffMs: number;         // Base backoff between restarts
  tenantPollIntervalMs: number;     // How often to check for new tenants
  defaultWorkerConfig: Omit<TenantWorkerConfig, 'queuePrefix' | 'redisUrl' | 'databaseUrl' | 'encryptionKey'>;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  redisUrl: '',
  databaseUrl: '',
  healthCheckIntervalMs: 30_000,    // 30s
  healthTimeoutMs: 10_000,          // 10s
  maxRestartsPerTenant: 10,
  restartBackoffMs: 5_000,          // 5s base
  tenantPollIntervalMs: 60_000,     // 1m
  defaultWorkerConfig: {
    guardianIntervalMs: 15 * 60_000,  // 15m
    healthReportIntervalMs: 30_000,   // 30s
    maxRetries: 3,
    workerConcurrency: {
      sync: 5,
      webhook: 10,
      alert: 3,
      stockUpdate: 5,
    },
  },
};
