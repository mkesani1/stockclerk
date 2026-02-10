/**
 * TenantOrchestrator
 *
 * Manages isolated worker processes for each tenant.
 * Each tenant gets their own child process with:
 * - Separate event loop (crash isolation)
 * - Separate memory heap (memory leak isolation)
 * - Tenant-scoped BullMQ queues (queue flood isolation)
 * - Independent Guardian reconciliation loop
 *
 * If a tenant's worker crashes, ONLY that tenant is affected.
 * The orchestrator detects the crash and restarts the worker.
 */

import { fork, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import type {
  OrchestratorConfig,
  TenantWorkerInfo,
  TenantHealthStatus,
  ParentMessage,
  ChildMessage,
  ReadyMessage,
  HealthReportMessage,
  PongMessage,
  ErrorReportMessage,
  SyncEventMessage,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './types.js';

// ============================================================================
// Orchestrator Events
// ============================================================================

export interface OrchestratorEvents {
  'tenant:spawned': (tenantId: string, pid: number) => void;
  'tenant:ready': (tenantId: string) => void;
  'tenant:crashed': (tenantId: string, code: number | null, signal: string | null) => void;
  'tenant:restarting': (tenantId: string, attempt: number) => void;
  'tenant:stopped': (tenantId: string) => void;
  'tenant:health': (tenantId: string, health: TenantHealthStatus) => void;
  'tenant:error': (tenantId: string, error: string, fatal: boolean) => void;
  'tenant:sync_event': (tenantId: string, eventType: string, data: Record<string, unknown>) => void;
  'tenant:max_restarts': (tenantId: string) => void;
  'orchestrator:error': (error: Error) => void;
}

// ============================================================================
// TenantOrchestrator Class
// ============================================================================

export class TenantOrchestrator extends EventEmitter {
  private readonly config: OrchestratorConfig;
  private readonly workers: Map<string, { process: ChildProcess; info: TenantWorkerInfo }> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private tenantPollTimer: NodeJS.Timeout | null = null;
  private state: 'stopped' | 'running' | 'shutting_down' = 'stopped';
  private getTenantIds: (() => Promise<string[]>) | null = null;

  // Path to the worker entry point (compiled JS)
  private readonly workerScript: string;

  constructor(config: Partial<OrchestratorConfig> & { redisUrl: string; databaseUrl: string }) {
    super();
    this.config = {
      ...{
        healthCheckIntervalMs: 30_000,
        healthTimeoutMs: 10_000,
        maxRestartsPerTenant: 10,
        restartBackoffMs: 5_000,
        tenantPollIntervalMs: 60_000,
        defaultWorkerConfig: {
          guardianIntervalMs: 15 * 60_000,
          healthReportIntervalMs: 30_000,
          maxRetries: 3,
          workerConcurrency: {
            sync: 5,
            webhook: 10,
            alert: 3,
            stockUpdate: 5,
          },
        },
      },
      ...config,
    };

    // Worker script is in the same directory
    this.workerScript = path.join(path.dirname(new URL(import.meta.url).pathname), 'tenant-worker.js');
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the orchestrator.
   * Provide a function that returns active tenant IDs from the database.
   */
  async start(getTenantIds: () => Promise<string[]>): Promise<void> {
    if (this.state === 'running') {
      this.log('Orchestrator already running');
      return;
    }

    this.state = 'running';
    this.getTenantIds = getTenantIds;
    this.log('Starting TenantOrchestrator...');

    // Discover and spawn workers for all active tenants
    await this.discoverAndSpawnTenants();

    // Start health check loop
    this.healthCheckTimer = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );

    // Start tenant discovery loop (picks up new signups)
    this.tenantPollTimer = setInterval(
      () => this.discoverAndSpawnTenants(),
      this.config.tenantPollIntervalMs
    );

    this.log(`Orchestrator started. Managing ${this.workers.size} tenants.`);
  }

  /**
   * Gracefully shut down all tenant workers.
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') return;

    this.state = 'shutting_down';
    this.log('Shutting down TenantOrchestrator...');

    // Stop timers
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.tenantPollTimer) clearInterval(this.tenantPollTimer);
    this.healthCheckTimer = null;
    this.tenantPollTimer = null;

    // Gracefully stop all workers
    const stopPromises = Array.from(this.workers.keys()).map((tenantId) =>
      this.stopTenantWorker(tenantId, true)
    );
    await Promise.allSettled(stopPromises);

    this.state = 'stopped';
    this.log('TenantOrchestrator stopped.');
  }

  // ==========================================================================
  // Tenant Worker Management
  // ==========================================================================

  /**
   * Spawn a new isolated worker for a tenant.
   */
  async spawnTenantWorker(tenantId: string): Promise<void> {
    if (this.workers.has(tenantId)) {
      this.log(`Worker already exists for tenant ${tenantId}`);
      return;
    }

    if (this.state !== 'running') {
      this.log(`Cannot spawn worker: orchestrator is ${this.state}`);
      return;
    }

    this.log(`Spawning isolated worker for tenant ${tenantId}...`);

    const queuePrefix = `stockclerk:${tenantId}`;

    // Fork a child process
    const child = fork(this.workerScript, [], {
      env: {
        ...process.env,
        TENANT_ID: tenantId,
        NODE_ENV: process.env.NODE_ENV,
      },
      serialization: 'json',
      // Each child gets its own memory allocation
      execArgv: ['--max-old-space-size=256'], // 256MB heap per tenant
    });

    const info: TenantWorkerInfo = {
      tenantId,
      pid: child.pid || 0,
      state: 'spawning',
      startedAt: new Date(),
      lastHealthReport: null,
      lastPingAt: null,
      lastPongAt: null,
      restartCount: 0,
      maxRestarts: this.config.maxRestartsPerTenant,
      consecutiveFailures: 0,
    };

    this.workers.set(tenantId, { process: child, info });

    // Wire up IPC message handling
    child.on('message', (msg: ChildMessage) => {
      this.handleChildMessage(tenantId, msg);
    });

    // Wire up crash detection
    child.on('exit', (code, signal) => {
      this.handleChildExit(tenantId, code, signal);
    });

    child.on('error', (err) => {
      this.log(`Worker process error for tenant ${tenantId}: ${err.message}`, 'error');
      this.emit('tenant:error', tenantId, err.message, true);
    });

    // Send init message with tenant config
    this.sendToWorker(tenantId, {
      type: 'init',
      tenantId,
      config: {
        redisUrl: this.config.redisUrl,
        databaseUrl: this.config.databaseUrl,
        encryptionKey: this.config.encryptionKey,
        queuePrefix,
        ...this.config.defaultWorkerConfig,
      },
    });

    this.emit('tenant:spawned', tenantId, child.pid || 0);
  }

  /**
   * Stop a tenant's worker process.
   */
  async stopTenantWorker(tenantId: string, graceful = true): Promise<void> {
    const worker = this.workers.get(tenantId);
    if (!worker) return;

    worker.info.state = 'stopping';
    this.log(`Stopping worker for tenant ${tenantId} (graceful: ${graceful})`);

    if (graceful) {
      // Ask worker to shut down gracefully
      this.sendToWorker(tenantId, { type: 'shutdown', graceful: true });

      // Wait up to 10s for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still alive
          if (worker.process.connected) {
            worker.process.kill('SIGKILL');
          }
          resolve();
        }, 10_000);

        worker.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } else {
      worker.process.kill('SIGKILL');
    }

    this.workers.delete(tenantId);
    worker.info.state = 'stopped';
    this.emit('tenant:stopped', tenantId);
  }

  /**
   * Restart a tenant's worker (e.g., after a crash).
   */
  private async restartTenantWorker(tenantId: string): Promise<void> {
    const worker = this.workers.get(tenantId);
    if (!worker) return;

    const { info } = worker;
    info.restartCount++;
    info.consecutiveFailures++;

    if (info.restartCount > info.maxRestarts) {
      this.log(
        `Tenant ${tenantId} exceeded max restarts (${info.maxRestarts}). Giving up.`,
        'error'
      );
      this.workers.delete(tenantId);
      this.emit('tenant:max_restarts', tenantId);
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 minutes
    const backoff = Math.min(
      this.config.restartBackoffMs * Math.pow(2, info.consecutiveFailures - 1),
      5 * 60_000
    );

    this.log(
      `Restarting tenant ${tenantId} in ${backoff}ms (attempt ${info.restartCount}/${info.maxRestarts})`
    );
    this.emit('tenant:restarting', tenantId, info.restartCount);

    // Clean up old worker entry
    this.workers.delete(tenantId);

    // Wait for backoff then respawn
    await new Promise((resolve) => setTimeout(resolve, backoff));

    if (this.state === 'running') {
      await this.spawnTenantWorker(tenantId);
    }
  }

  // ==========================================================================
  // Commands to Tenant Workers
  // ==========================================================================

  /**
   * Trigger a sync for a specific tenant and channel.
   */
  triggerSync(
    tenantId: string,
    channelId: string,
    operation: 'full' | 'channel' | 'product' = 'channel',
    productId?: string
  ): void {
    this.sendToWorker(tenantId, {
      type: 'trigger_sync',
      channelId,
      operation,
      productId,
    });
  }

  /**
   * Add a webhook job to a tenant's isolated queue.
   */
  addWebhookJob(
    tenantId: string,
    channelId: string,
    channelType: string,
    eventType: string,
    payload: Record<string, unknown>,
    signature?: string
  ): void {
    this.sendToWorker(tenantId, {
      type: 'add_webhook_job',
      channelId,
      channelType,
      eventType,
      payload,
      signature,
    });
  }

  /**
   * Trigger Guardian reconciliation for a specific tenant.
   */
  triggerReconciliation(tenantId: string, autoRepair = true): void {
    this.sendToWorker(tenantId, {
      type: 'trigger_reconciliation',
      autoRepair,
    });
  }

  // ==========================================================================
  // Status & Health
  // ==========================================================================

  /**
   * Get the status of all managed tenant workers.
   */
  getAllTenantStatus(): Map<string, TenantWorkerInfo> {
    const result = new Map<string, TenantWorkerInfo>();
    for (const [tenantId, { info }] of this.workers) {
      result.set(tenantId, { ...info });
    }
    return result;
  }

  /**
   * Get the status of a specific tenant's worker.
   */
  getTenantStatus(tenantId: string): TenantWorkerInfo | null {
    const worker = this.workers.get(tenantId);
    return worker ? { ...worker.info } : null;
  }

  /**
   * Get the latest health report for a tenant.
   */
  getTenantHealth(tenantId: string): TenantHealthStatus | null {
    const worker = this.workers.get(tenantId);
    return worker?.info.lastHealthReport ?? null;
  }

  /**
   * Get a summary of the orchestrator's state.
   */
  getOrchestratorStatus(): {
    state: string;
    totalTenants: number;
    healthyTenants: number;
    degradedTenants: number;
    crashedTenants: number;
    tenants: Array<{
      tenantId: string;
      state: string;
      pid: number;
      uptime: number;
      restartCount: number;
      memoryMb: number;
    }>;
  } {
    let healthy = 0;
    let degraded = 0;
    let crashed = 0;

    const tenantList: Array<{
      tenantId: string;
      state: string;
      pid: number;
      uptime: number;
      restartCount: number;
      memoryMb: number;
    }> = [];

    for (const [tenantId, { info }] of this.workers) {
      const health = info.lastHealthReport;

      if (info.state === 'running' && health?.state === 'running') healthy++;
      else if (info.state === 'crashed' || health?.state === 'error') crashed++;
      else degraded++;

      tenantList.push({
        tenantId,
        state: info.state,
        pid: info.pid,
        uptime: Date.now() - info.startedAt.getTime(),
        restartCount: info.restartCount,
        memoryMb: health ? Math.round(health.memory.heapUsed / 1024 / 1024) : 0,
      });
    }

    return {
      state: this.state,
      totalTenants: this.workers.size,
      healthyTenants: healthy,
      degradedTenants: degraded,
      crashedTenants: crashed,
      tenants: tenantList,
    };
  }

  /**
   * Check if a tenant has a running worker.
   */
  hasTenantWorker(tenantId: string): boolean {
    return this.workers.has(tenantId);
  }

  // ==========================================================================
  // Internal: IPC Message Handling
  // ==========================================================================

  private handleChildMessage(tenantId: string, msg: ChildMessage): void {
    const worker = this.workers.get(tenantId);
    if (!worker) return;

    switch (msg.type) {
      case 'ready': {
        const readyMsg = msg as ReadyMessage;
        worker.info.state = 'running';
        worker.info.pid = readyMsg.pid;
        worker.info.consecutiveFailures = 0; // Reset on successful start
        this.log(`Tenant ${tenantId} worker ready (PID: ${readyMsg.pid})`);
        this.emit('tenant:ready', tenantId);
        break;
      }

      case 'health_report': {
        const healthMsg = msg as HealthReportMessage;
        worker.info.lastHealthReport = healthMsg.status;
        this.emit('tenant:health', tenantId, healthMsg.status);
        break;
      }

      case 'pong': {
        const pongMsg = msg as PongMessage;
        worker.info.lastPongAt = new Date();
        break;
      }

      case 'error_report': {
        const errorMsg = msg as ErrorReportMessage;
        this.log(`Tenant ${tenantId} error: ${errorMsg.error} (fatal: ${errorMsg.fatal})`, 'error');
        this.emit('tenant:error', tenantId, errorMsg.error, errorMsg.fatal);
        break;
      }

      case 'sync_event': {
        const syncMsg = msg as SyncEventMessage;
        this.emit('tenant:sync_event', tenantId, syncMsg.eventType, syncMsg.data);
        break;
      }

      case 'shutdown_complete': {
        this.log(`Tenant ${tenantId} shutdown complete`);
        break;
      }
    }
  }

  private handleChildExit(tenantId: string, code: number | null, signal: string | null): void {
    const worker = this.workers.get(tenantId);
    if (!worker) return;

    if (worker.info.state === 'stopping' || this.state === 'shutting_down') {
      // Expected shutdown
      this.log(`Tenant ${tenantId} worker exited cleanly (code: ${code})`);
      this.workers.delete(tenantId);
      this.emit('tenant:stopped', tenantId);
      return;
    }

    // Unexpected crash!
    worker.info.state = 'crashed';
    this.log(
      `CRASH: Tenant ${tenantId} worker died (code: ${code}, signal: ${signal})`,
      'error'
    );
    this.emit('tenant:crashed', tenantId, code, signal);

    // Attempt restart
    this.restartTenantWorker(tenantId).catch((err) => {
      this.log(`Failed to restart tenant ${tenantId}: ${err}`, 'error');
    });
  }

  // ==========================================================================
  // Internal: Health Checks
  // ==========================================================================

  private runHealthChecks(): void {
    if (this.state !== 'running') return;

    const now = Date.now();

    for (const [tenantId, { process: child, info }] of this.workers) {
      if (info.state !== 'running') continue;

      // Check if worker is responding
      if (info.lastPingAt && info.lastPongAt) {
        const timeSinceLastPong = now - info.lastPongAt.getTime();
        if (timeSinceLastPong > this.config.healthTimeoutMs * 2) {
          this.log(`Tenant ${tenantId} worker unresponsive (${timeSinceLastPong}ms since last pong)`, 'error');
          // Kill and restart
          child.kill('SIGKILL');
          continue;
        }
      }

      // Send ping
      info.lastPingAt = new Date();
      this.sendToWorker(tenantId, {
        type: 'ping',
        timestamp: now,
      });
    }
  }

  // ==========================================================================
  // Internal: Tenant Discovery
  // ==========================================================================

  private async discoverAndSpawnTenants(): Promise<void> {
    if (this.state !== 'running' || !this.getTenantIds) return;

    try {
      const tenantIds = await this.getTenantIds();

      for (const tenantId of tenantIds) {
        if (!this.workers.has(tenantId)) {
          this.log(`Discovered new tenant: ${tenantId}`);
          await this.spawnTenantWorker(tenantId);
        }
      }

      // Optionally: stop workers for tenants that no longer exist
      for (const [tenantId] of this.workers) {
        if (!tenantIds.includes(tenantId)) {
          this.log(`Tenant ${tenantId} no longer active, stopping worker`);
          await this.stopTenantWorker(tenantId, true);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Tenant discovery error: ${msg}`, 'error');
      this.emit('orchestrator:error', error instanceof Error ? error : new Error(msg));
    }
  }

  // ==========================================================================
  // Internal: Utilities
  // ==========================================================================

  private sendToWorker(tenantId: string, msg: ParentMessage): void {
    const worker = this.workers.get(tenantId);
    if (!worker || !worker.process.connected) {
      this.log(`Cannot send to tenant ${tenantId}: worker not connected`, 'error');
      return;
    }

    try {
      worker.process.send(msg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      this.log(`Failed to send message to tenant ${tenantId}: ${errMsg}`, 'error');
    }
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = '[TenantOrchestrator]';
    const ts = new Date().toISOString();
    switch (level) {
      case 'error': console.error(`${ts} ${prefix} ${message}`); break;
      case 'warn': console.warn(`${ts} ${prefix} ${message}`); break;
      default: console.log(`${ts} ${prefix} ${message}`);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTenantOrchestrator(
  config: Partial<OrchestratorConfig> & { redisUrl: string; databaseUrl: string }
): TenantOrchestrator {
  return new TenantOrchestrator(config);
}
