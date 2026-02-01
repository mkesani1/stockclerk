/**
 * Sync Engine Event Bus
 * Typed EventEmitter for inter-agent communication
 */

import EventEmitter from 'eventemitter3';
import type {
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
  StockChange,
  SyncResult,
  DriftDetection,
  AlertNotification,
  ChannelType,
} from './types.js';

// ============================================================================
// Event Type Mapping
// ============================================================================

export interface SyncEngineEventMap {
  'stock:change': StockChangeEvent;
  'sync:completed': SyncCompletedEvent;
  'sync:failed': SyncFailedEvent;
  'drift:detected': DriftDetectedEvent;
  'drift:repaired': DriftRepairedEvent;
  'alert:triggered': AlertTriggeredEvent;
  'channel:disconnected': ChannelDisconnectedEvent;
  'channel:connected': ChannelConnectedEvent;
}

// ============================================================================
// Typed Event Bus
// ============================================================================

export class SyncEngineEventBus extends EventEmitter {
  private debugMode = false;

  constructor(debug = false) {
    super();
    this.debugMode = debug;
  }

  /**
   * Enable or disable debug logging
   */
  setDebug(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Emit a stock change event
   */
  emitStockChange(payload: StockChange): void {
    const event: StockChangeEvent = {
      type: 'stock:change',
      payload,
      timestamp: new Date(),
    };
    this.log('stock:change', event);
    this.emit('stock:change', event);
  }

  /**
   * Emit a sync completed event
   */
  emitSyncCompleted(payload: SyncResult): void {
    const event: SyncCompletedEvent = {
      type: 'sync:completed',
      payload,
      timestamp: new Date(),
    };
    this.log('sync:completed', event);
    this.emit('sync:completed', event);
  }

  /**
   * Emit a sync failed event
   */
  emitSyncFailed(payload: {
    jobId: string;
    tenantId: string;
    error: string;
    retryable: boolean;
  }): void {
    const event: SyncFailedEvent = {
      type: 'sync:failed',
      payload,
      timestamp: new Date(),
    };
    this.log('sync:failed', event);
    this.emit('sync:failed', event);
  }

  /**
   * Emit a drift detected event
   */
  emitDriftDetected(payload: DriftDetection): void {
    const event: DriftDetectedEvent = {
      type: 'drift:detected',
      payload,
      timestamp: new Date(),
    };
    this.log('drift:detected', event);
    this.emit('drift:detected', event);
  }

  /**
   * Emit a drift repaired event
   */
  emitDriftRepaired(payload: {
    tenantId: string;
    productId: string;
    repairedChannels: string[];
    newQuantity: number;
  }): void {
    const event: DriftRepairedEvent = {
      type: 'drift:repaired',
      payload,
      timestamp: new Date(),
    };
    this.log('drift:repaired', event);
    this.emit('drift:repaired', event);
  }

  /**
   * Emit an alert triggered event
   */
  emitAlertTriggered(payload: AlertNotification): void {
    const event: AlertTriggeredEvent = {
      type: 'alert:triggered',
      payload,
      timestamp: new Date(),
    };
    this.log('alert:triggered', event);
    this.emit('alert:triggered', event);
  }

  /**
   * Emit a channel disconnected event
   */
  emitChannelDisconnected(payload: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    error?: string;
  }): void {
    const event: ChannelDisconnectedEvent = {
      type: 'channel:disconnected',
      payload,
      timestamp: new Date(),
    };
    this.log('channel:disconnected', event);
    this.emit('channel:disconnected', event);
  }

  /**
   * Emit a channel connected event
   */
  emitChannelConnected(payload: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
  }): void {
    const event: ChannelConnectedEvent = {
      type: 'channel:connected',
      payload,
      timestamp: new Date(),
    };
    this.log('channel:connected', event);
    this.emit('channel:connected', event);
  }

  /**
   * Subscribe to stock change events
   */
  onStockChange(listener: (event: StockChangeEvent) => void): this {
    return this.on('stock:change', listener);
  }

  /**
   * Subscribe to sync completed events
   */
  onSyncCompleted(listener: (event: SyncCompletedEvent) => void): this {
    return this.on('sync:completed', listener);
  }

  /**
   * Subscribe to sync failed events
   */
  onSyncFailed(listener: (event: SyncFailedEvent) => void): this {
    return this.on('sync:failed', listener);
  }

  /**
   * Subscribe to drift detected events
   */
  onDriftDetected(listener: (event: DriftDetectedEvent) => void): this {
    return this.on('drift:detected', listener);
  }

  /**
   * Subscribe to drift repaired events
   */
  onDriftRepaired(listener: (event: DriftRepairedEvent) => void): this {
    return this.on('drift:repaired', listener);
  }

  /**
   * Subscribe to alert triggered events
   */
  onAlertTriggered(listener: (event: AlertTriggeredEvent) => void): this {
    return this.on('alert:triggered', listener);
  }

  /**
   * Subscribe to channel disconnected events
   */
  onChannelDisconnected(listener: (event: ChannelDisconnectedEvent) => void): this {
    return this.on('channel:disconnected', listener);
  }

  /**
   * Subscribe to channel connected events
   */
  onChannelConnected(listener: (event: ChannelConnectedEvent) => void): this {
    return this.on('channel:connected', listener);
  }

  /**
   * Subscribe to all events
   */
  onAny(listener: (event: SyncEngineEvent) => void): this {
    const eventTypes: SyncEngineEventType[] = [
      'stock:change',
      'sync:completed',
      'sync:failed',
      'drift:detected',
      'drift:repaired',
      'alert:triggered',
      'channel:disconnected',
      'channel:connected',
    ];

    for (const type of eventTypes) {
      this.on(type, listener as (event: unknown) => void);
    }

    return this;
  }

  /**
   * Unsubscribe from stock change events
   */
  offStockChange(listener: (event: StockChangeEvent) => void): this {
    return this.off('stock:change', listener);
  }

  /**
   * Unsubscribe from sync completed events
   */
  offSyncCompleted(listener: (event: SyncCompletedEvent) => void): this {
    return this.off('sync:completed', listener);
  }

  /**
   * Unsubscribe from sync failed events
   */
  offSyncFailed(listener: (event: SyncFailedEvent) => void): this {
    return this.off('sync:failed', listener);
  }

  /**
   * Get listener count for an event type
   */
  getListenerCount(eventType: SyncEngineEventType): number {
    return this.listenerCount(eventType);
  }

  /**
   * Remove all listeners for a specific event type or all events
   */
  removeAllListenersFor(eventType?: SyncEngineEventType): this {
    if (eventType) {
      return this.removeAllListeners(eventType);
    }
    return this.removeAllListeners();
  }

  /**
   * Debug log helper
   */
  private log(eventType: string, event: SyncEngineEvent): void {
    if (this.debugMode) {
      console.log(`[SyncEngineEventBus] ${eventType}:`, JSON.stringify(event, null, 2));
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SyncEngineEventBus instance
 */
export function createEventBus(debug = false): SyncEngineEventBus {
  return new SyncEngineEventBus(debug);
}

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type {
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
};
