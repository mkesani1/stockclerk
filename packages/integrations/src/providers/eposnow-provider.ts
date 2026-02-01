/**
 * Eposnow Inventory Provider
 * Implements the unified InventoryProvider interface for Eposnow
 */

import {
  BaseInventoryProvider,
  type ChannelCredentials,
  type UnifiedProduct,
  type StockChangeEvent,
  type WebhookValidationResult,
  type ProviderHealth,
  ProviderAuthError,
} from '../unified.js';
import { EposnowApiClient } from '../eposnow/client.js';
import { EposnowWebhookHandler, type StockChangeEvent as EposnowStockChangeEvent } from '../eposnow/webhooks.js';
import type { EposnowWebhookPayload, EposnowWebhookEvent } from '../eposnow/types.js';
import type { SyncResult } from '../types.js';

export class EposnowProvider extends BaseInventoryProvider {
  readonly channelType = 'eposnow' as const;

  private client: EposnowApiClient | null = null;
  private webhookHandler: EposnowWebhookHandler | null = null;
  private webhookSecret?: string;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'eposnow') {
      throw new ProviderAuthError('eposnow', 'Invalid credential type');
    }

    if (!credentials.apiKey || !credentials.apiSecret) {
      throw new ProviderAuthError('eposnow', 'API key and secret are required');
    }

    this.client = new EposnowApiClient({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      locationId: credentials.locationId ? parseInt(credentials.locationId, 10) : undefined,
    });

    await this.client.connect();
    this.credentials = credentials;
    this._connected = true;
    this.webhookHandler = new EposnowWebhookHandler(this.webhookSecret);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.webhookHandler = null;
    await super.disconnect();
  }

  async getProducts(): Promise<UnifiedProduct[]> {
    this.ensureConnected();
    const products = await this.client!.getProducts();
    return products.map((p) => this.transformToUnified(p, 'eposnow'));
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();
    const product = await this.client!.getProduct(externalId);
    if (!product) return null;
    return this.transformToUnified(product, 'eposnow');
  }

  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();
    await this.client!.updateStock(externalId, quantity);
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number }>
  ): Promise<SyncResult> {
    this.ensureConnected();
    const stockUpdates = updates.map((u) => ({
      productId: u.externalId,
      sku: '', // Will be resolved by the client
      quantity: u.quantity,
      source: 'eposnow' as const,
      timestamp: new Date(),
    }));
    return this.client!.updateStockBatch(stockUpdates);
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      this.webhookHandler = new EposnowWebhookHandler(this.webhookSecret);
    }

    const parsed = this.webhookHandler.parsePayload(payload as string | Record<string, unknown>);
    const event = this.webhookHandler.handleWebhook(parsed);

    if (!event) return null;

    return this.transformWebhookEvent(event);
  }

  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult {
    if (!this.webhookHandler) {
      this.webhookHandler = new EposnowWebhookHandler(this.webhookSecret);
    }
    return this.webhookHandler.validateSignature(payload, signature);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    this.ensureConnected();

    const webhookEvents = (events || [
      'stock.updated',
      'product.updated',
      'transaction.completed',
    ]) as EposnowWebhookEvent[];

    const webhookId = await this.client!.subscribeWebhook(url, webhookEvents, this.webhookSecret);
    return webhookId.toString();
  }

  async unsubscribeWebhook(webhookId: string): Promise<void> {
    this.ensureConnected();
    await this.client!.unsubscribeWebhook(parseInt(webhookId, 10));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    if (!this.client) {
      return {
        connected: false,
        lastChecked: new Date(),
        error: 'Client not initialized',
      };
    }

    try {
      const healthy = await this.client.healthCheck();
      return {
        connected: healthy,
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

  setWebhookSecret(secret: string): void {
    this.webhookSecret = secret;
    if (this.webhookHandler) {
      this.webhookHandler = new EposnowWebhookHandler(secret);
    }
  }

  private transformWebhookEvent(event: EposnowStockChangeEvent): StockChangeEvent {
    return {
      source: 'eposnow',
      type: event.type === 'stock_update' ? 'stock_update' :
            event.type === 'sale' ? 'sale' : 'product_update',
      externalId: event.productId,
      sku: event.sku,
      previousQuantity: event.previousQuantity,
      newQuantity: event.newQuantity,
      reason: event.reason,
      timestamp: event.timestamp,
      metadata: event.metadata,
    };
  }
}

export function createEposnowProvider(): EposnowProvider {
  return new EposnowProvider();
}
