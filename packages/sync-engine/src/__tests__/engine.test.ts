/**
 * Sync Engine Tests
 * Tests full engine lifecycle and coordination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Types
interface Product {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  bufferStock: number;
  tenantId: string;
}

interface Channel {
  id: string;
  tenantId: string;
  type: 'eposnow' | 'wix' | 'deliveroo';
  name: string;
  isActive: boolean;
}

interface SyncEngineConfig {
  tenantId: string;
  guardianInterval?: number;
  batchSize?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

interface SyncJob {
  id: string;
  type: 'full_sync' | 'incremental_sync' | 'webhook_triggered' | 'guardian_repair';
  tenantId: string;
  productIds?: string[];
  channelIds?: string[];
  priority: 'high' | 'normal' | 'low';
  createdAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface SyncResult {
  jobId: string;
  success: boolean;
  productsProcessed: number;
  channelsUpdated: number;
  errors: string[];
  duration: number;
}

// Mock services
const mockSyncService = {
  syncToAllChannels: vi.fn(),
  syncToChannel: vi.fn(),
  calculateAvailableStock: vi.fn(),
};

const mockGuardianService = {
  detectDrift: vi.fn(),
  repairAllDrifts: vi.fn(),
};

const mockAlertService = {
  evaluateAllRules: vi.fn(),
  processAlert: vi.fn(),
};

const mockWebhookWatcher = {
  on: vi.fn(),
  processWebhook: vi.fn(),
};

// SyncEngine class for testing
class SyncEngine extends EventEmitter {
  private config: SyncEngineConfig;
  private isRunning: boolean = false;
  private guardianTimer: ReturnType<typeof setInterval> | null = null;
  private jobQueue: SyncJob[] = [];
  private processingJob: SyncJob | null = null;

  constructor(config: SyncEngineConfig) {
    super();
    this.config = {
      guardianInterval: 300000, // 5 minutes
      batchSize: 50,
      retryAttempts: 3,
      retryDelayMs: 1000,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Engine is already running');
    }

    this.isRunning = true;
    this.emit('started', { tenantId: this.config.tenantId });

    // Start guardian interval
    this.guardianTimer = setInterval(() => {
      this.runGuardian();
    }, this.config.guardianInterval);

    // Start processing queue
    this.processQueue();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.guardianTimer) {
      clearInterval(this.guardianTimer);
      this.guardianTimer = null;
    }

    this.emit('stopped', { tenantId: this.config.tenantId });
  }

  isEngineRunning(): boolean {
    return this.isRunning;
  }

  addJob(job: Omit<SyncJob, 'id' | 'createdAt' | 'status'>): SyncJob {
    const fullJob: SyncJob = {
      ...job,
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date(),
      status: 'pending',
    };

    // Insert based on priority
    if (job.priority === 'high') {
      this.jobQueue.unshift(fullJob);
    } else if (job.priority === 'low') {
      this.jobQueue.push(fullJob);
    } else {
      // Normal priority: insert after high priority jobs
      const insertIndex = this.jobQueue.findIndex((j) => j.priority === 'low' || j.priority === 'normal');
      if (insertIndex === -1) {
        this.jobQueue.push(fullJob);
      } else {
        this.jobQueue.splice(insertIndex, 0, fullJob);
      }
    }

    this.emit('jobAdded', fullJob);
    return fullJob;
  }

  getJobQueue(): SyncJob[] {
    return [...this.jobQueue];
  }

  getCurrentJob(): SyncJob | null {
    return this.processingJob;
  }

  private async processQueue(): Promise<void> {
    while (this.isRunning) {
      if (this.jobQueue.length === 0) {
        await this.delay(100);
        continue;
      }

      const job = this.jobQueue.shift()!;
      this.processingJob = job;
      job.status = 'processing';

      this.emit('jobStarted', job);

      const startTime = Date.now();
      let result: SyncResult;

      try {
        result = await this.processJob(job);
        job.status = 'completed';
      } catch (error) {
        job.status = 'failed';
        result = {
          jobId: job.id,
          success: false,
          productsProcessed: 0,
          channelsUpdated: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          duration: Date.now() - startTime,
        };
      }

      this.processingJob = null;
      this.emit('jobCompleted', { job, result });
    }
  }

  private async processJob(job: SyncJob): Promise<SyncResult> {
    const startTime = Date.now();
    let productsProcessed = 0;
    let channelsUpdated = 0;
    const errors: string[] = [];

    switch (job.type) {
      case 'full_sync':
        // Mock full sync processing
        const fullSyncResults = await mockSyncService.syncToAllChannels();
        productsProcessed = fullSyncResults?.productsProcessed ?? 0;
        channelsUpdated = fullSyncResults?.channelsUpdated ?? 0;
        if (fullSyncResults?.errors) {
          errors.push(...fullSyncResults.errors);
        }
        break;

      case 'incremental_sync':
      case 'webhook_triggered':
        // Mock incremental sync
        const incrementalResults = await mockSyncService.syncToChannel();
        productsProcessed = incrementalResults?.productsProcessed ?? 0;
        channelsUpdated = incrementalResults?.channelsUpdated ?? 0;
        break;

      case 'guardian_repair':
        // Mock guardian repair
        const repairResults = await mockGuardianService.repairAllDrifts();
        productsProcessed = repairResults?.repaired ?? 0;
        break;
    }

    return {
      jobId: job.id,
      success: errors.length === 0,
      productsProcessed,
      channelsUpdated,
      errors,
      duration: Date.now() - startTime,
    };
  }

  async runGuardian(): Promise<void> {
    if (!this.isRunning) return;

    this.emit('guardianRunStarted', { tenantId: this.config.tenantId });

    const drifts = await mockGuardianService.detectDrift();

    if (drifts?.length > 0) {
      // Add repair job with high priority
      this.addJob({
        type: 'guardian_repair',
        tenantId: this.config.tenantId,
        priority: 'high',
      });

      this.emit('driftsDetected', { count: drifts.length });
    }

    this.emit('guardianRunCompleted', { tenantId: this.config.tenantId });
  }

  async handleWebhook(channelType: string, payload: unknown): Promise<void> {
    this.emit('webhookReceived', { channelType, payload });

    mockWebhookWatcher.processWebhook(payload);

    // Add sync job
    this.addJob({
      type: 'webhook_triggered',
      tenantId: this.config.tenantId,
      priority: 'high',
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

describe('SyncEngine', () => {
  let engine: SyncEngine;

  const config: SyncEngineConfig = {
    tenantId: 'tenant-123',
    guardianInterval: 1000, // Short interval for testing
    batchSize: 10,
    retryAttempts: 3,
  };

  beforeEach(() => {
    engine = new SyncEngine(config);
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default mock responses
    mockSyncService.syncToAllChannels.mockResolvedValue({
      productsProcessed: 10,
      channelsUpdated: 3,
      errors: [],
    });
    mockSyncService.syncToChannel.mockResolvedValue({
      productsProcessed: 1,
      channelsUpdated: 1,
    });
    mockGuardianService.detectDrift.mockResolvedValue([]);
    mockGuardianService.repairAllDrifts.mockResolvedValue({ repaired: 0 });
  });

  afterEach(async () => {
    await engine.stop();
    vi.useRealTimers();
  });

  describe('Lifecycle', () => {
    it('should start the engine', async () => {
      const startedHandler = vi.fn();
      engine.on('started', startedHandler);

      await engine.start();

      expect(engine.isEngineRunning()).toBe(true);
      expect(startedHandler).toHaveBeenCalledWith({ tenantId: config.tenantId });
    });

    it('should throw error when starting already running engine', async () => {
      await engine.start();

      await expect(engine.start()).rejects.toThrow('Engine is already running');
    });

    it('should stop the engine', async () => {
      const stoppedHandler = vi.fn();
      engine.on('stopped', stoppedHandler);

      await engine.start();
      await engine.stop();

      expect(engine.isEngineRunning()).toBe(false);
      expect(stoppedHandler).toHaveBeenCalledWith({ tenantId: config.tenantId });
    });

    it('should handle stop when not running', async () => {
      await expect(engine.stop()).resolves.toBeUndefined();
    });
  });

  describe('Job Queue', () => {
    it('should add job to queue', () => {
      const jobAddedHandler = vi.fn();
      engine.on('jobAdded', jobAddedHandler);

      const job = engine.addJob({
        type: 'full_sync',
        tenantId: config.tenantId,
        priority: 'normal',
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('pending');
      expect(jobAddedHandler).toHaveBeenCalled();
    });

    it('should prioritize high priority jobs', () => {
      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });
      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'low' });
      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'high' });

      const queue = engine.getJobQueue();

      expect(queue[0].priority).toBe('high');
    });

    it('should maintain FIFO within same priority', () => {
      const job1 = engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });
      const job2 = engine.addJob({ type: 'incremental_sync', tenantId: config.tenantId, priority: 'normal' });

      const queue = engine.getJobQueue();

      expect(queue[0].id).toBe(job1.id);
      expect(queue[1].id).toBe(job2.id);
    });

    it('should process jobs from queue', async () => {
      const jobStartedHandler = vi.fn();
      const jobCompletedHandler = vi.fn();
      engine.on('jobStarted', jobStartedHandler);
      engine.on('jobCompleted', jobCompletedHandler);

      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });

      await engine.start();

      // Allow queue processing
      await vi.advanceTimersByTimeAsync(200);

      expect(jobStartedHandler).toHaveBeenCalled();
      expect(jobCompletedHandler).toHaveBeenCalled();
    });

    it('should track current processing job', async () => {
      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });

      let capturedJob: SyncJob | null = null;
      engine.on('jobStarted', () => {
        capturedJob = engine.getCurrentJob();
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(capturedJob).not.toBeNull();
      expect(capturedJob?.status).toBe('processing');
    });
  });

  describe('Job Processing', () => {
    it('should process full_sync job', async () => {
      const job = engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });

      const completedPromise = new Promise<void>((resolve) => {
        engine.on('jobCompleted', ({ result }) => {
          expect(result.success).toBe(true);
          expect(result.productsProcessed).toBe(10);
          expect(result.channelsUpdated).toBe(3);
          resolve();
        });
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(200);
      await completedPromise;
    });

    it('should handle job processing errors', async () => {
      mockSyncService.syncToAllChannels.mockRejectedValue(new Error('Sync failed'));

      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });

      const completedPromise = new Promise<void>((resolve) => {
        engine.on('jobCompleted', ({ job, result }) => {
          expect(job.status).toBe('failed');
          expect(result.success).toBe(false);
          expect(result.errors).toContain('Sync failed');
          resolve();
        });
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(200);
      await completedPromise;
    });

    it('should include errors in result when sync has errors', async () => {
      mockSyncService.syncToAllChannels.mockResolvedValue({
        productsProcessed: 8,
        channelsUpdated: 2,
        errors: ['Channel A failed', 'Channel B failed'],
      });

      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });

      const completedPromise = new Promise<void>((resolve) => {
        engine.on('jobCompleted', ({ result }) => {
          expect(result.success).toBe(false);
          expect(result.errors).toHaveLength(2);
          resolve();
        });
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(200);
      await completedPromise;
    });
  });

  describe('Guardian', () => {
    it('should run guardian on interval', async () => {
      const guardianStartedHandler = vi.fn();
      const guardianCompletedHandler = vi.fn();
      engine.on('guardianRunStarted', guardianStartedHandler);
      engine.on('guardianRunCompleted', guardianCompletedHandler);

      await engine.start();

      // Fast forward past guardian interval
      await vi.advanceTimersByTimeAsync(config.guardianInterval! + 100);

      expect(guardianStartedHandler).toHaveBeenCalled();
      expect(guardianCompletedHandler).toHaveBeenCalled();
    });

    it('should add repair job when drifts detected', async () => {
      mockGuardianService.detectDrift.mockResolvedValue([
        { productId: 'prod-1', channelId: 'ch-1', driftPercentage: 25 },
      ]);

      const driftsDetectedHandler = vi.fn();
      engine.on('driftsDetected', driftsDetectedHandler);

      await engine.start();
      await engine.runGuardian();

      const queue = engine.getJobQueue();
      const repairJob = queue.find((j) => j.type === 'guardian_repair');

      expect(repairJob).toBeDefined();
      expect(repairJob?.priority).toBe('high');
      expect(driftsDetectedHandler).toHaveBeenCalledWith({ count: 1 });
    });

    it('should not add repair job when no drifts', async () => {
      mockGuardianService.detectDrift.mockResolvedValue([]);

      await engine.start();
      await engine.runGuardian();

      const queue = engine.getJobQueue();
      const repairJob = queue.find((j) => j.type === 'guardian_repair');

      expect(repairJob).toBeUndefined();
    });

    it('should stop guardian on engine stop', async () => {
      const guardianStartedHandler = vi.fn();
      engine.on('guardianRunStarted', guardianStartedHandler);

      await engine.start();
      await engine.stop();

      // Fast forward past guardian interval
      await vi.advanceTimersByTimeAsync(config.guardianInterval! + 100);

      expect(guardianStartedHandler).not.toHaveBeenCalled();
    });
  });

  describe('Webhook Handling', () => {
    it('should process incoming webhooks', async () => {
      const webhookReceivedHandler = vi.fn();
      engine.on('webhookReceived', webhookReceivedHandler);

      await engine.start();

      await engine.handleWebhook('eposnow', {
        event: 'stock_change',
        productId: '12345',
        stockLevel: 85,
      });

      expect(webhookReceivedHandler).toHaveBeenCalledWith({
        channelType: 'eposnow',
        payload: expect.objectContaining({ event: 'stock_change' }),
      });
    });

    it('should add high priority sync job on webhook', async () => {
      await engine.start();

      await engine.handleWebhook('eposnow', {
        event: 'stock_change',
        productId: '12345',
      });

      const queue = engine.getJobQueue();
      const webhookJob = queue.find((j) => j.type === 'webhook_triggered');

      expect(webhookJob).toBeDefined();
      expect(webhookJob?.priority).toBe('high');
    });

    it('should call webhook watcher processWebhook', async () => {
      const payload = { event: 'stock_change', productId: '12345' };

      await engine.handleWebhook('eposnow', payload);

      expect(mockWebhookWatcher.processWebhook).toHaveBeenCalledWith(payload);
    });
  });

  describe('Event Emission', () => {
    it('should emit all lifecycle events in order', async () => {
      const events: string[] = [];

      engine.on('started', () => events.push('started'));
      engine.on('jobAdded', () => events.push('jobAdded'));
      engine.on('jobStarted', () => events.push('jobStarted'));
      engine.on('jobCompleted', () => events.push('jobCompleted'));
      engine.on('stopped', () => events.push('stopped'));

      engine.addJob({ type: 'full_sync', tenantId: config.tenantId, priority: 'normal' });
      await engine.start();
      await vi.advanceTimersByTimeAsync(200);
      await engine.stop();

      expect(events).toEqual(['jobAdded', 'started', 'jobStarted', 'jobCompleted', 'stopped']);
    });
  });
});
