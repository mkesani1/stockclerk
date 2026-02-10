/**
 * BullMQ Queue Setup for StockClerk
 * Manages queues for sync jobs, webhook processing, and alert checks
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/index.js';
import type {
  SyncJobData,
  StockUpdateJobData,
  WebhookJobData,
} from '../types/index.js';

// Redis connection for all queues
let redisConnection: Redis | null = null;

// Queue names (global / legacy)
export const QUEUE_NAMES = {
  SYNC: 'stockclerk:sync',
  WEBHOOK: 'stockclerk:webhook',
  ALERT: 'stockclerk:alert',
  STOCK_UPDATE: 'stockclerk:stock-update',
} as const;

// Tenant-scoped queue names (per-tenant isolation)
export function getTenantQueueNames(tenantId: string) {
  return {
    SYNC: `stockclerk:${tenantId}:sync`,
    WEBHOOK: `stockclerk:${tenantId}:webhook`,
    ALERT: `stockclerk:${tenantId}:alert`,
    STOCK_UPDATE: `stockclerk:${tenantId}:stock-update`,
  } as const;
}

// Queue instances
let syncQueue: Queue<SyncJobData> | null = null;
let webhookQueue: Queue<WebhookJobData> | null = null;
let alertQueue: Queue<AlertJobData> | null = null;
let stockUpdateQueue: Queue<StockUpdateJobData> | null = null;

// Queue event listeners
let syncQueueEvents: QueueEvents | null = null;
let webhookQueueEvents: QueueEvents | null = null;
let alertQueueEvents: QueueEvents | null = null;
let stockUpdateQueueEvents: QueueEvents | null = null;

// Workers
let syncWorker: Worker<SyncJobData> | null = null;
let webhookWorker: Worker<WebhookJobData> | null = null;
let alertWorker: Worker<AlertJobData> | null = null;
let stockUpdateWorker: Worker<StockUpdateJobData> | null = null;

// Alert job data type
export interface AlertJobData {
  tenantId: string;
  checkType: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
  productId?: string;
  channelId?: string;
  threshold?: number;
}

// Full sync job data type
export interface FullSyncJobData extends SyncJobData {
  initiatedBy?: string;
  force?: boolean;
}

// Initialize Redis connection
export function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisConnection.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redisConnection.on('connect', () => {
      console.log('Redis connected for queues');
    });
  }
  return redisConnection;
}

// Initialize all queues
export async function initializeQueues(): Promise<void> {
  const connection = getRedisConnection();

  // Create queues with default options
  const defaultJobOptions = {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  };

  syncQueue = new Queue<SyncJobData>(QUEUE_NAMES.SYNC, {
    connection,
    defaultJobOptions,
  });

  webhookQueue = new Queue<WebhookJobData>(QUEUE_NAMES.WEBHOOK, {
    connection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 5, // More retries for webhooks
    },
  });

  alertQueue = new Queue<AlertJobData>(QUEUE_NAMES.ALERT, {
    connection,
    defaultJobOptions,
  });

  stockUpdateQueue = new Queue<StockUpdateJobData>(QUEUE_NAMES.STOCK_UPDATE, {
    connection,
    defaultJobOptions,
  });

  // Create queue event listeners for monitoring
  syncQueueEvents = new QueueEvents(QUEUE_NAMES.SYNC, { connection });
  webhookQueueEvents = new QueueEvents(QUEUE_NAMES.WEBHOOK, { connection });
  alertQueueEvents = new QueueEvents(QUEUE_NAMES.ALERT, { connection });
  stockUpdateQueueEvents = new QueueEvents(QUEUE_NAMES.STOCK_UPDATE, { connection });

  console.log('All queues initialized');
}

// Get queue instances
export function getSyncQueue(): Queue<SyncJobData> {
  if (!syncQueue) {
    throw new Error('Queues not initialized. Call initializeQueues() first.');
  }
  return syncQueue;
}

export function getWebhookQueue(): Queue<WebhookJobData> {
  if (!webhookQueue) {
    throw new Error('Queues not initialized. Call initializeQueues() first.');
  }
  return webhookQueue;
}

export function getAlertQueue(): Queue<AlertJobData> {
  if (!alertQueue) {
    throw new Error('Queues not initialized. Call initializeQueues() first.');
  }
  return alertQueue;
}

export function getStockUpdateQueue(): Queue<StockUpdateJobData> {
  if (!stockUpdateQueue) {
    throw new Error('Queues not initialized. Call initializeQueues() first.');
  }
  return stockUpdateQueue;
}

// Add jobs to queues
export async function addSyncJob(
  data: SyncJobData,
  options?: {
    priority?: number;
    delay?: number;
    jobId?: string;
  }
): Promise<Job<SyncJobData>> {
  const queue = getSyncQueue();
  return queue.add('sync', data, {
    priority: options?.priority,
    delay: options?.delay,
    jobId: options?.jobId,
  });
}

export async function addWebhookJob(
  data: WebhookJobData,
  options?: {
    priority?: number;
    delay?: number;
  }
): Promise<Job<WebhookJobData>> {
  const queue = getWebhookQueue();
  return queue.add('webhook', data, {
    priority: options?.priority ?? 1, // High priority for webhooks
    delay: options?.delay,
  });
}

export async function addAlertJob(
  data: AlertJobData,
  options?: {
    priority?: number;
    delay?: number;
    jobId?: string;
  }
): Promise<Job<AlertJobData>> {
  const queue = getAlertQueue();
  return queue.add('alert', data, {
    priority: options?.priority,
    delay: options?.delay,
    jobId: options?.jobId,
  });
}

export async function addStockUpdateJob(
  data: StockUpdateJobData,
  options?: {
    priority?: number;
    delay?: number;
  }
): Promise<Job<StockUpdateJobData>> {
  const queue = getStockUpdateQueue();
  return queue.add('stock-update', data, {
    priority: options?.priority ?? 2,
    delay: options?.delay,
  });
}

// Bulk add jobs
export async function addBulkSyncJobs(
  jobs: Array<{ data: SyncJobData; options?: { priority?: number; delay?: number } }>
): Promise<Job<SyncJobData>[]> {
  const queue = getSyncQueue();
  return queue.addBulk(
    jobs.map((j) => ({
      name: 'sync',
      data: j.data,
      opts: j.options,
    }))
  );
}

// Register workers
export function registerSyncWorker(
  processor: (job: Job<SyncJobData>) => Promise<void>,
  concurrency = 5
): Worker<SyncJobData> {
  const connection = getRedisConnection();
  syncWorker = new Worker<SyncJobData>(QUEUE_NAMES.SYNC, processor, {
    connection,
    concurrency,
  });

  syncWorker.on('completed', (job) => {
    console.log(`Sync job ${job.id} completed`);
  });

  syncWorker.on('failed', (job, err) => {
    console.error(`Sync job ${job?.id} failed:`, err.message);
  });

  return syncWorker;
}

export function registerWebhookWorker(
  processor: (job: Job<WebhookJobData>) => Promise<void>,
  concurrency = 10
): Worker<WebhookJobData> {
  const connection = getRedisConnection();
  webhookWorker = new Worker<WebhookJobData>(QUEUE_NAMES.WEBHOOK, processor, {
    connection,
    concurrency,
  });

  webhookWorker.on('completed', (job) => {
    console.log(`Webhook job ${job.id} completed`);
  });

  webhookWorker.on('failed', (job, err) => {
    console.error(`Webhook job ${job?.id} failed:`, err.message);
  });

  return webhookWorker;
}

export function registerAlertWorker(
  processor: (job: Job<AlertJobData>) => Promise<void>,
  concurrency = 3
): Worker<AlertJobData> {
  const connection = getRedisConnection();
  alertWorker = new Worker<AlertJobData>(QUEUE_NAMES.ALERT, processor, {
    connection,
    concurrency,
  });

  alertWorker.on('completed', (job) => {
    console.log(`Alert job ${job.id} completed`);
  });

  alertWorker.on('failed', (job, err) => {
    console.error(`Alert job ${job?.id} failed:`, err.message);
  });

  return alertWorker;
}

export function registerStockUpdateWorker(
  processor: (job: Job<StockUpdateJobData>) => Promise<void>,
  concurrency = 5
): Worker<StockUpdateJobData> {
  const connection = getRedisConnection();
  stockUpdateWorker = new Worker<StockUpdateJobData>(QUEUE_NAMES.STOCK_UPDATE, processor, {
    connection,
    concurrency,
  });

  stockUpdateWorker.on('completed', (job) => {
    console.log(`Stock update job ${job.id} completed`);
  });

  stockUpdateWorker.on('failed', (job, err) => {
    console.error(`Stock update job ${job?.id} failed:`, err.message);
  });

  return stockUpdateWorker;
}

// Get queue statistics
export async function getQueueStats(): Promise<{
  sync: QueueStats;
  webhook: QueueStats;
  alert: QueueStats;
  stockUpdate: QueueStats;
}> {
  const [syncStats, webhookStats, alertStats, stockUpdateStats] = await Promise.all([
    getQueueStatistics(getSyncQueue()),
    getQueueStatistics(getWebhookQueue()),
    getQueueStatistics(getAlertQueue()),
    getQueueStatistics(getStockUpdateQueue()),
  ]);

  return {
    sync: syncStats,
    webhook: webhookStats,
    alert: alertStats,
    stockUpdate: stockUpdateStats,
  };
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

async function getQueueStatistics(queue: Queue): Promise<QueueStats> {
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused: paused ? 1 : 0,
  };
}

// Get active jobs
export async function getActiveJobs(queueName: keyof typeof QUEUE_NAMES): Promise<Job[]> {
  let queue: Queue;
  switch (queueName) {
    case 'SYNC':
      queue = getSyncQueue();
      break;
    case 'WEBHOOK':
      queue = getWebhookQueue();
      break;
    case 'ALERT':
      queue = getAlertQueue();
      break;
    case 'STOCK_UPDATE':
      queue = getStockUpdateQueue();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
  return queue.getActive();
}

// Pause/resume queues
export async function pauseQueue(queueName: keyof typeof QUEUE_NAMES): Promise<void> {
  let queue: Queue;
  switch (queueName) {
    case 'SYNC':
      queue = getSyncQueue();
      break;
    case 'WEBHOOK':
      queue = getWebhookQueue();
      break;
    case 'ALERT':
      queue = getAlertQueue();
      break;
    case 'STOCK_UPDATE':
      queue = getStockUpdateQueue();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
  await queue.pause();
}

export async function resumeQueue(queueName: keyof typeof QUEUE_NAMES): Promise<void> {
  let queue: Queue;
  switch (queueName) {
    case 'SYNC':
      queue = getSyncQueue();
      break;
    case 'WEBHOOK':
      queue = getWebhookQueue();
      break;
    case 'ALERT':
      queue = getAlertQueue();
      break;
    case 'STOCK_UPDATE':
      queue = getStockUpdateQueue();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
  await queue.resume();
}

// Clean up old jobs
export async function cleanQueue(
  queueName: keyof typeof QUEUE_NAMES,
  status: 'completed' | 'failed',
  age: number // in milliseconds
): Promise<number[]> {
  let queue: Queue;
  switch (queueName) {
    case 'SYNC':
      queue = getSyncQueue();
      break;
    case 'WEBHOOK':
      queue = getWebhookQueue();
      break;
    case 'ALERT':
      queue = getAlertQueue();
      break;
    case 'STOCK_UPDATE':
      queue = getStockUpdateQueue();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
  const result = await queue.clean(age, 1000, status as unknown as any);
  return result as unknown as number[];
}

// Close all queues and connections
export async function closeQueues(): Promise<void> {
  // Close workers first
  if (syncWorker) await syncWorker.close();
  if (webhookWorker) await webhookWorker.close();
  if (alertWorker) await alertWorker.close();
  if (stockUpdateWorker) await stockUpdateWorker.close();

  // Close queue events
  if (syncQueueEvents) await syncQueueEvents.close();
  if (webhookQueueEvents) await webhookQueueEvents.close();
  if (alertQueueEvents) await alertQueueEvents.close();
  if (stockUpdateQueueEvents) await stockUpdateQueueEvents.close();

  // Close queues
  if (syncQueue) await syncQueue.close();
  if (webhookQueue) await webhookQueue.close();
  if (alertQueue) await alertQueue.close();
  if (stockUpdateQueue) await stockUpdateQueue.close();

  // Close Redis connection
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  // Reset all references
  syncQueue = null;
  webhookQueue = null;
  alertQueue = null;
  stockUpdateQueue = null;
  syncWorker = null;
  webhookWorker = null;
  alertWorker = null;
  stockUpdateWorker = null;
  syncQueueEvents = null;
  webhookQueueEvents = null;
  alertQueueEvents = null;
  stockUpdateQueueEvents = null;

  console.log('All queues closed');
}

// ============================================================================
// Tenant-Scoped Queue Operations (Per-Tenant Isolation)
// ============================================================================

// Cache of tenant-scoped queues so we don't recreate them
const tenantQueues: Map<string, {
  sync: Queue<SyncJobData>;
  webhook: Queue<WebhookJobData>;
  alert: Queue<AlertJobData>;
  stockUpdate: Queue<StockUpdateJobData>;
}> = new Map();

/**
 * Get or create tenant-scoped queues.
 * Each tenant gets their own BullMQ queue namespace.
 */
export function getTenantQueues(tenantId: string) {
  const existing = tenantQueues.get(tenantId);
  if (existing) return existing;

  const connection = getRedisConnection();
  const names = getTenantQueueNames(tenantId);

  const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 500 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };

  const queues = {
    sync: new Queue<SyncJobData>(names.SYNC, { connection, defaultJobOptions }),
    webhook: new Queue<WebhookJobData>(names.WEBHOOK, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
    }),
    alert: new Queue<AlertJobData>(names.ALERT, { connection, defaultJobOptions }),
    stockUpdate: new Queue<StockUpdateJobData>(names.STOCK_UPDATE, { connection, defaultJobOptions }),
  };

  tenantQueues.set(tenantId, queues);
  return queues;
}

/**
 * Add a sync job to a tenant's isolated queue.
 */
export async function addTenantSyncJob(
  tenantId: string,
  data: SyncJobData,
  options?: { priority?: number; delay?: number; jobId?: string }
): Promise<Job<SyncJobData>> {
  const queues = getTenantQueues(tenantId);
  return queues.sync.add('sync', data, {
    priority: options?.priority,
    delay: options?.delay,
    jobId: options?.jobId,
  });
}

/**
 * Add a webhook job to a tenant's isolated queue.
 */
export async function addTenantWebhookJob(
  tenantId: string,
  data: WebhookJobData,
  options?: { priority?: number; delay?: number }
): Promise<Job<WebhookJobData>> {
  const queues = getTenantQueues(tenantId);
  return queues.webhook.add('webhook', data, {
    priority: options?.priority ?? 1,
    delay: options?.delay,
  });
}

/**
 * Add an alert job to a tenant's isolated queue.
 */
export async function addTenantAlertJob(
  tenantId: string,
  data: AlertJobData,
  options?: { priority?: number; delay?: number; jobId?: string }
): Promise<Job<AlertJobData>> {
  const queues = getTenantQueues(tenantId);
  return queues.alert.add('alert', data, {
    priority: options?.priority,
    delay: options?.delay,
    jobId: options?.jobId,
  });
}

/**
 * Get tenant-scoped queue statistics.
 */
export async function getTenantQueueStats(tenantId: string) {
  const queues = getTenantQueues(tenantId);
  const [syncStats, webhookStats, alertStats, stockUpdateStats] = await Promise.all([
    getQueueStatistics(queues.sync),
    getQueueStatistics(queues.webhook),
    getQueueStatistics(queues.alert),
    getQueueStatistics(queues.stockUpdate),
  ]);

  return { sync: syncStats, webhook: webhookStats, alert: alertStats, stockUpdate: stockUpdateStats };
}

/**
 * Close all tenant-scoped queues (for shutdown).
 */
export async function closeTenantQueues(): Promise<void> {
  for (const [tenantId, queues] of tenantQueues) {
    await queues.sync.close();
    await queues.webhook.close();
    await queues.alert.close();
    await queues.stockUpdate.close();
  }
  tenantQueues.clear();
}

// Export types
export type { SyncJobData, StockUpdateJobData, WebhookJobData };
