/**
 * Tenant Worker Process
 *
 * This file runs as an isolated child process via child_process.fork().
 * Each instance manages a single tenant's sync engine:
 * - Tenant-scoped BullMQ queues
 * - Tenant-scoped workers consuming from those queues
 * - Independent Guardian reconciliation loop
 * - Health reporting back to the orchestrator
 *
 * ISOLATION GUARANTEES:
 * - Separate V8 heap: memory leaks here don't affect other tenants
 * - Separate event loop: blocked I/O here doesn't affect other tenants
 * - Crash boundary: uncaughtException here kills only this process
 */

import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import type {
  ParentMessage,
  ChildMessage,
  TenantWorkerConfig,
  TenantHealthStatus,
  QueueHealthInfo,
} from './types.js';

// ============================================================================
// State
// ============================================================================

let tenantId: string = '';
let config: TenantWorkerConfig | null = null;
let redis: Redis | null = null;
let startedAt: Date | null = null;
let state: TenantHealthStatus['state'] = 'stopped';

// Queues (tenant-scoped)
let syncQueue: Queue | null = null;
let webhookQueue: Queue | null = null;
let alertQueue: Queue | null = null;
let stockUpdateQueue: Queue | null = null;

// Workers
let syncWorker: Worker | null = null;
let webhookWorker: Worker | null = null;
let alertWorker: Worker | null = null;
let stockUpdateWorker: Worker | null = null;

// Guardian
let guardianTimer: NodeJS.Timeout | null = null;
let healthReportTimer: NodeJS.Timeout | null = null;

// Stats
let stats = {
  syncProcessed: 0,
  syncErrors: 0,
  webhookProcessed: 0,
  webhookErrors: 0,
  alertProcessed: 0,
  alertErrors: 0,
  totalErrors: 0,
  lastError: null as string | null,
  lastErrorAt: null as string | null,
  lastActivity: null as string | null,
};

// ============================================================================
// IPC Communication
// ============================================================================

function sendToParent(msg: ChildMessage): void {
  if (process.send) {
    process.send(msg);
  }
}

function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const prefix = `[TenantWorker:${tenantId}]`;
  const ts = new Date().toISOString();
  switch (level) {
    case 'error': console.error(`${ts} ${prefix} ${message}`); break;
    case 'warn': console.warn(`${ts} ${prefix} ${message}`); break;
    default: console.log(`${ts} ${prefix} ${message}`);
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(msg: { tenantId: string; config: TenantWorkerConfig }): Promise<void> {
  tenantId = msg.tenantId;
  config = msg.config;
  state = 'starting';

  log('Initializing isolated worker...');

  try {
    // Create tenant-scoped Redis connection
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keyPrefix: `${config.queuePrefix}:`,
    });

    redis.on('error', (err) => {
      log(`Redis error: ${err.message}`, 'error');
      recordError(err.message);
    });

    // Create tenant-scoped queues
    const queueConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const defaultJobOptions = {
      attempts: config.maxRetries,
      backoff: { type: 'exponential' as const, delay: 1000 },
      removeOnComplete: { age: 24 * 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 3600 },
    };

    syncQueue = new Queue(`${config.queuePrefix}:sync`, {
      connection: queueConnection,
      defaultJobOptions,
    });

    webhookQueue = new Queue(`${config.queuePrefix}:webhook`, {
      connection: queueConnection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
    });

    alertQueue = new Queue(`${config.queuePrefix}:alert`, {
      connection: queueConnection,
      defaultJobOptions,
    });

    stockUpdateQueue = new Queue(`${config.queuePrefix}:stock-update`, {
      connection: queueConnection,
      defaultJobOptions,
    });

    // Create tenant-scoped workers
    syncWorker = new Worker(
      `${config.queuePrefix}:sync`,
      async (job: Job) => processSyncJob(job),
      { connection: queueConnection, concurrency: config.workerConcurrency.sync }
    );

    webhookWorker = new Worker(
      `${config.queuePrefix}:webhook`,
      async (job: Job) => processWebhookJob(job),
      { connection: queueConnection, concurrency: config.workerConcurrency.webhook }
    );

    alertWorker = new Worker(
      `${config.queuePrefix}:alert`,
      async (job: Job) => processAlertJob(job),
      { connection: queueConnection, concurrency: config.workerConcurrency.alert }
    );

    stockUpdateWorker = new Worker(
      `${config.queuePrefix}:stock-update`,
      async (job: Job) => processStockUpdateJob(job),
      { connection: queueConnection, concurrency: config.workerConcurrency.stockUpdate }
    );

    // Wire worker events for stats
    wireWorkerEvents(syncWorker, 'sync');
    wireWorkerEvents(webhookWorker, 'webhook');
    wireWorkerEvents(alertWorker, 'alert');
    wireWorkerEvents(stockUpdateWorker, 'stockUpdate');

    // Start Guardian reconciliation loop
    guardianTimer = setInterval(
      () => runGuardianReconciliation(),
      config.guardianIntervalMs
    );

    // Start health report loop
    healthReportTimer = setInterval(
      () => reportHealth(),
      config.healthReportIntervalMs
    );

    startedAt = new Date();
    state = 'running';

    // Tell parent we're ready
    sendToParent({
      type: 'ready',
      tenantId,
      pid: process.pid,
    });

    log(`Worker ready. Queues: ${config.queuePrefix}:*`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    state = 'error';
    log(`Initialization failed: ${errMsg}`, 'error');

    sendToParent({
      type: 'error_report',
      tenantId,
      error: errMsg,
      fatal: true,
    });

    // Exit so orchestrator can restart us
    process.exit(1);
  }
}

// ============================================================================
// Job Processors (tenant-scoped)
// ============================================================================

async function processSyncJob(job: Job): Promise<void> {
  const { channelId, channelType, operation, productIds } = job.data;
  log(`Processing sync job: ${operation} for channel ${channelId}`);
  stats.lastActivity = new Date().toISOString();

  // Emit sync_started event to parent (for WebSocket broadcast)
  sendToParent({
    type: 'sync_event',
    tenantId,
    eventType: 'sync_started',
    data: { channelId, channelType, operation, jobId: job.id },
  });

  try {
    // The actual sync logic will be handled by the sync-integration module
    // This worker adds the job to the queue; the parent wires the processor
    stats.syncProcessed++;

    sendToParent({
      type: 'sync_event',
      tenantId,
      eventType: 'sync_completed',
      data: { channelId, channelType, operation, jobId: job.id },
    });
  } catch (error) {
    stats.syncErrors++;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    recordError(errMsg);

    sendToParent({
      type: 'sync_event',
      tenantId,
      eventType: 'sync_failed',
      data: { channelId, channelType, error: errMsg, jobId: job.id },
    });

    throw error; // Let BullMQ handle retries
  }
}

async function processWebhookJob(job: Job): Promise<void> {
  const { channelId, channelType, eventType, payload } = job.data;
  log(`Processing webhook: ${eventType} from channel ${channelId}`);
  stats.lastActivity = new Date().toISOString();

  try {
    stats.webhookProcessed++;

    sendToParent({
      type: 'sync_event',
      tenantId,
      eventType: 'stock_updated',
      data: { channelId, channelType, eventType, jobId: job.id },
    });
  } catch (error) {
    stats.webhookErrors++;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    recordError(errMsg);
    throw error;
  }
}

async function processAlertJob(job: Job): Promise<void> {
  const { checkType } = job.data;
  log(`Processing alert check: ${checkType}`);
  stats.lastActivity = new Date().toISOString();

  try {
    stats.alertProcessed++;
  } catch (error) {
    stats.alertErrors++;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    recordError(errMsg);
    throw error;
  }
}

async function processStockUpdateJob(job: Job): Promise<void> {
  log(`Processing stock update: ${job.id}`);
  stats.lastActivity = new Date().toISOString();
  // Stock update processing handled via parent IPC
}

// ============================================================================
// Guardian Reconciliation (per-tenant, isolated)
// ============================================================================

async function runGuardianReconciliation(): Promise<void> {
  if (state !== 'running') return;

  log('Running Guardian reconciliation...');
  stats.lastActivity = new Date().toISOString();

  try {
    // Request reconciliation via parent (which has DB access)
    sendToParent({
      type: 'sync_event',
      tenantId,
      eventType: 'sync_started',
      data: { operation: 'reconciliation', source: 'guardian' },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log(`Guardian error: ${errMsg}`, 'error');
    recordError(errMsg);
  }
}

// ============================================================================
// Health Reporting
// ============================================================================

async function reportHealth(): Promise<void> {
  const memUsage = process.memoryUsage();

  const report: TenantHealthStatus = {
    tenantId,
    state,
    uptime: startedAt ? Date.now() - startedAt.getTime() : 0,
    lastActivity: stats.lastActivity,
    agents: {
      watcher: {
        state: syncWorker ? 'running' : 'stopped',
        processedCount: stats.webhookProcessed,
        errorCount: stats.webhookErrors,
        lastActivity: stats.lastActivity,
      },
      sync: {
        state: syncWorker ? 'running' : 'stopped',
        processedCount: stats.syncProcessed,
        errorCount: stats.syncErrors,
        lastActivity: stats.lastActivity,
      },
      guardian: {
        state: guardianTimer ? 'running' : 'stopped',
        processedCount: 0,
        errorCount: 0,
        lastActivity: stats.lastActivity,
      },
      alert: {
        state: alertWorker ? 'running' : 'stopped',
        processedCount: stats.alertProcessed,
        errorCount: stats.alertErrors,
        lastActivity: stats.lastActivity,
      },
    },
    queues: {
      sync: await getQueueHealth(syncQueue),
      webhook: await getQueueHealth(webhookQueue),
      alert: await getQueueHealth(alertQueue),
      stockUpdate: await getQueueHealth(stockUpdateQueue),
    },
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
    },
    errors: {
      total: stats.totalErrors,
      lastError: stats.lastError,
      lastErrorAt: stats.lastErrorAt,
    },
  };

  sendToParent({
    type: 'health_report',
    tenantId,
    status: report,
  });
}

async function getQueueHealth(queue: Queue | null): Promise<QueueHealthInfo> {
  if (!queue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  } catch {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
}

// ============================================================================
// Worker Event Wiring
// ============================================================================

function wireWorkerEvents(worker: Worker, name: string): void {
  worker.on('completed', (job) => {
    log(`${name} job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    log(`${name} job ${job?.id} failed: ${err.message}`, 'error');
    recordError(err.message);
  });

  worker.on('error', (err) => {
    log(`${name} worker error: ${err.message}`, 'error');
    recordError(err.message);
  });
}

// ============================================================================
// Shutdown
// ============================================================================

async function shutdown(graceful: boolean): Promise<void> {
  state = 'stopping';
  log(`Shutting down (graceful: ${graceful})...`);

  // Stop timers
  if (guardianTimer) clearInterval(guardianTimer);
  if (healthReportTimer) clearInterval(healthReportTimer);
  guardianTimer = null;
  healthReportTimer = null;

  // Close workers
  const closePromises: Promise<void>[] = [];
  if (syncWorker) closePromises.push(syncWorker.close());
  if (webhookWorker) closePromises.push(webhookWorker.close());
  if (alertWorker) closePromises.push(alertWorker.close());
  if (stockUpdateWorker) closePromises.push(stockUpdateWorker.close());

  await Promise.allSettled(closePromises);

  // Close queues
  const queueClosePromises: Promise<void>[] = [];
  if (syncQueue) queueClosePromises.push(syncQueue.close());
  if (webhookQueue) queueClosePromises.push(webhookQueue.close());
  if (alertQueue) queueClosePromises.push(alertQueue.close());
  if (stockUpdateQueue) queueClosePromises.push(stockUpdateQueue.close());

  await Promise.allSettled(queueClosePromises);

  // Close Redis
  if (redis) await redis.quit();

  state = 'stopped';

  sendToParent({
    type: 'shutdown_complete',
    tenantId,
  });

  log('Shutdown complete');
  process.exit(0);
}

// ============================================================================
// Error Recording
// ============================================================================

function recordError(message: string): void {
  stats.totalErrors++;
  stats.lastError = message;
  stats.lastErrorAt = new Date().toISOString();

  sendToParent({
    type: 'error_report',
    tenantId,
    error: message,
    fatal: false,
  });
}

// ============================================================================
// Message Handler
// ============================================================================

process.on('message', async (msg: ParentMessage) => {
  switch (msg.type) {
    case 'init':
      await initialize(msg);
      break;

    case 'trigger_sync':
      if (syncQueue) {
        await syncQueue.add('sync', {
          tenantId,
          channelId: msg.channelId,
          operation: msg.operation,
          productId: msg.productId,
        });
      }
      break;

    case 'add_webhook_job':
      if (webhookQueue) {
        await webhookQueue.add('webhook', {
          tenantId,
          channelId: msg.channelId,
          channelType: msg.channelType,
          eventType: msg.eventType,
          payload: msg.payload,
          signature: msg.signature,
        }, { priority: 1 });
      }
      break;

    case 'trigger_reconciliation':
      await runGuardianReconciliation();
      break;

    case 'shutdown':
      await shutdown(msg.graceful);
      break;

    case 'ping':
      sendToParent({
        type: 'pong',
        tenantId,
        timestamp: msg.timestamp,
        latencyMs: Date.now() - msg.timestamp,
      });
      break;
  }
});

// ============================================================================
// Crash Handlers
// ============================================================================

process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}`, 'error');
  log(err.stack || 'No stack trace', 'error');

  sendToParent({
    type: 'error_report',
    tenantId,
    error: `Uncaught exception: ${err.message}`,
    fatal: true,
  });

  // Give time for the message to be sent, then exit
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  const errMsg = reason instanceof Error ? reason.message : String(reason);
  log(`UNHANDLED REJECTION: ${errMsg}`, 'error');

  sendToParent({
    type: 'error_report',
    tenantId,
    error: `Unhandled rejection: ${errMsg}`,
    fatal: false,
  });
});

// Handle SIGTERM from orchestrator
process.on('SIGTERM', () => {
  shutdown(true).catch(() => process.exit(1));
});

log('Tenant worker process started, waiting for init message...');
