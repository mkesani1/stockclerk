// Main exports file for @stockclerk/backend package
// This file re-exports all types and utilities for use by other agents

// Database exports
export { db, pool, checkDatabaseConnection, closeDatabaseConnection } from './db/index.js';

// Schema exports (tables and relations)
export {
  // Tables
  tenants,
  users,
  channels,
  products,
  productChannelMappings,
  syncEvents,
  alerts,
  // Enums
  channelTypeEnum,
  userRoleEnum,
  syncEventStatusEnum,
  alertTypeEnum,
  // Relations
  tenantsRelations,
  usersRelations,
  channelsRelations,
  productsRelations,
  productChannelMappingsRelations,
  syncEventsRelations,
  alertsRelations,
} from './db/schema.js';

// Type exports from schema
export type {
  Tenant,
  NewTenant,
  User,
  NewUser,
  Channel,
  NewChannel,
  Product,
  NewProduct,
  ProductChannelMapping,
  NewProductChannelMapping,
  SyncEvent,
  NewSyncEvent,
  Alert,
  NewAlert,
  ChannelType,
  UserRole,
  SyncEventStatus,
  AlertType,
} from './db/schema.js';

// All types from types module
export * from './types/index.js';

// Config
export { config, type Config } from './config/index.js';

// Auth middleware
export { authenticateRequest, requireRole, getCurrentUser, getTenantId } from './middleware/auth.js';

// WebSocket utilities
export {
  broadcastToTenant,
  broadcastToAll,
  broadcastToRoom,
  getTenantConnectionCount,
  getTotalConnectionCount,
  getConnectionStats,
  createWebSocketMessage,
  emitSyncStarted,
  emitSyncCompleted,
  emitSyncError,
  emitStockUpdated,
  emitAlertNew,
  emitChannelStatus,
  closeAllTenantConnections,
  closeAllConnections,
  stopHeartbeat,
} from './websocket/index.js';

// Queue utilities
export {
  // Queue initialization and cleanup
  initializeQueues,
  closeQueues,
  getRedisConnection,
  // Queue getters
  getSyncQueue,
  getWebhookQueue,
  getAlertQueue,
  getStockUpdateQueue,
  // Job adders
  addSyncJob,
  addWebhookJob,
  addAlertJob,
  addStockUpdateJob,
  addBulkSyncJobs,
  // Worker registration
  registerSyncWorker,
  registerWebhookWorker,
  registerAlertWorker,
  registerStockUpdateWorker,
  // Stats and management
  getQueueStats,
  getActiveJobs,
  pauseQueue,
  resumeQueue,
  cleanQueue,
  // Queue names constant
  QUEUE_NAMES,
  // Types
  type AlertJobData,
  type QueueStats,
} from './queues/index.js';

// Alert rules helpers
export {
  getAlertRulesForTenant,
  getLowStockThresholds,
} from './routes/alerts.js';

// Dashboard helpers
export {
  updateAgentStatus,
  getAgentStatus,
} from './routes/dashboard.js';

// Credential encryption utilities (for integrations)
export { encryptCredentials, decryptCredentials } from './routes/channels.js';
