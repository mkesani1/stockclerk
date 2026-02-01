/**
 * Unified Inventory Provider Interface
 * Abstract interface for all channel integrations to implement
 */

import type { Product, StockUpdate, SyncResult, IntegrationSource } from './types.js';

// ============================================================================
// Unified Types
// ============================================================================

export type ChannelType = 'eposnow' | 'wix' | 'deliveroo';

export interface ChannelCredentials {
  type: ChannelType;
  // Eposnow credentials
  apiKey?: string;
  apiSecret?: string;
  locationId?: string;
  // Wix credentials
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  siteId?: string;
  instanceId?: string;
  // Otter/Deliveroo credentials
  otterApiKey?: string;
  restaurantId?: string;
}

export interface UnifiedProduct {
  id: string;
  externalId: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
  quantity: number;
  isTracked: boolean;
  isAvailable: boolean;
  lastUpdated: Date;
  source: ChannelType;
  metadata?: Record<string, unknown>;
}

export interface StockChangeEvent {
  source: ChannelType;
  type: 'stock_update' | 'product_update' | 'sale' | 'availability_change' | 'order';
  externalId: string;
  sku?: string;
  previousQuantity?: number;
  newQuantity: number;
  isAvailable?: boolean;
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProviderHealth {
  connected: boolean;
  lastChecked: Date;
  latencyMs?: number;
  error?: string;
}

// ============================================================================
// Unified Provider Interface
// ============================================================================

export interface InventoryProvider {
  /**
   * The channel type this provider handles
   */
  readonly channelType: ChannelType;

  /**
   * Connect to the external API with the given credentials
   */
  connect(credentials: ChannelCredentials): Promise<void>;

  /**
   * Disconnect from the external API
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean;

  /**
   * Get all products from the channel
   */
  getProducts(): Promise<UnifiedProduct[]>;

  /**
   * Get a single product by external ID
   */
  getProduct(externalId: string): Promise<UnifiedProduct | null>;

  /**
   * Update stock level for a product
   */
  updateStock(externalId: string, quantity: number): Promise<void>;

  /**
   * Batch update stock levels
   */
  batchUpdateStock(updates: Array<{ externalId: string; quantity: number }>): Promise<SyncResult>;

  /**
   * Handle incoming webhook payload
   */
  handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null>;

  /**
   * Validate webhook signature
   */
  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult;

  /**
   * Subscribe to webhooks for the channel
   */
  subscribeWebhook(url: string, events?: string[]): Promise<string>;

  /**
   * Unsubscribe from webhooks
   */
  unsubscribeWebhook(webhookId: string): Promise<void>;

  /**
   * Health check the connection
   */
  healthCheck(): Promise<ProviderHealth>;
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

export abstract class BaseInventoryProvider implements InventoryProvider {
  abstract readonly channelType: ChannelType;

  protected credentials: ChannelCredentials | null = null;
  protected _connected = false;

  abstract connect(credentials: ChannelCredentials): Promise<void>;

  async disconnect(): Promise<void> {
    this._connected = false;
    this.credentials = null;
  }

  isConnected(): boolean {
    return this._connected;
  }

  abstract getProducts(): Promise<UnifiedProduct[]>;
  abstract getProduct(externalId: string): Promise<UnifiedProduct | null>;
  abstract updateStock(externalId: string, quantity: number): Promise<void>;
  abstract batchUpdateStock(updates: Array<{ externalId: string; quantity: number }>): Promise<SyncResult>;
  abstract handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null>;
  abstract validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult;
  abstract subscribeWebhook(url: string, events?: string[]): Promise<string>;
  abstract unsubscribeWebhook(webhookId: string): Promise<void>;

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      // Try to fetch a single product as health check
      await this.getProducts();
      return {
        connected: true,
        lastChecked: new Date(),
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        connected: false,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected ensureConnected(): void {
    if (!this._connected) {
      throw new ProviderNotConnectedError(this.channelType);
    }
  }

  protected transformToUnified(product: Product, source: ChannelType): UnifiedProduct {
    return {
      id: product.id,
      externalId: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      currency: (product.metadata?.currency as string) || 'GBP',
      quantity: product.quantity,
      isTracked: product.quantity !== -1,
      isAvailable: product.quantity !== 0,
      lastUpdated: product.lastUpdated,
      source,
      metadata: product.metadata,
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly channelType: ChannelType,
    public readonly code: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderNotConnectedError extends ProviderError {
  constructor(channelType: ChannelType) {
    super(`Provider ${channelType} is not connected`, channelType, 'NOT_CONNECTED');
    this.name = 'ProviderNotConnectedError';
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(channelType: ChannelType, message: string) {
    super(message, channelType, 'AUTH_ERROR');
    this.name = 'ProviderAuthError';
  }
}

export class ProviderSyncError extends ProviderError {
  constructor(channelType: ChannelType, message: string) {
    super(message, channelType, 'SYNC_ERROR');
    this.name = 'ProviderSyncError';
  }
}
