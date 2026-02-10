/**
 * Orchestrator Module - Per-Tenant Process Isolation
 *
 * Exports the TenantOrchestrator which manages isolated child processes
 * for each tenant, providing:
 * - Crash isolation (one tenant's crash doesn't affect others)
 * - Memory isolation (each tenant has its own V8 heap)
 * - Queue isolation (tenant-scoped BullMQ queues)
 * - Independent Guardian loops per tenant
 */

export { TenantOrchestrator, createTenantOrchestrator } from './TenantOrchestrator.js';
export type { OrchestratorEvents } from './TenantOrchestrator.js';
export type {
  // IPC Messages
  ParentMessage,
  ChildMessage,
  InitMessage,
  TriggerSyncMessage,
  AddWebhookJobMessage,
  ShutdownMessage,
  ReadyMessage,
  HealthReportMessage,
  ErrorReportMessage,
  SyncEventMessage,

  // Config
  OrchestratorConfig,
  TenantWorkerConfig,

  // Health & Status
  TenantWorkerInfo,
  TenantHealthStatus,
  AgentHealthInfo,
  QueueHealthInfo,
} from './types.js';
