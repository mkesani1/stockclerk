/**
 * Shopify Inventory Provider
 * Implements the unified InventoryProvider interface for Shopify
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
import { ShopifyApiClient } from '../shopify/client.js';
import { ShopifyWebhookHandler, type StockChangeEvent as ShopifyStockChangeEvent } from '../shopify/webhooks.js';
import type { SyncResult } from '../types.js';

export class ShopifyProvider extends BaseInventoryProvider {
  readonly channelType = 'shopify' as const;

  private client: ShopifyApiClient | null = null;
  private webhookHandler: ShopifyWebhookHandler | null = null;
  private webhookSecret?: string;
  private primaryLocationId: number | null = null;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'shopify') {
      throw new ProviderAuthError('shopify', 'Invalid credential type');
    }

    if (!credentials.shopifyShop || !credentials.shopifyAccessToken) {
      throw new ProviderAuthError('shopify', 'Shop and access token are required');
    }

    this.client = new ShopifyApiClient({
      shop: credentials.shopifyShop,
      accessToken: credentials.shopifyAccessToken,
    });

    await this.client.connect();

    // Store primary location ID if provided
    this.primaryLocationId = credentials.shopifyLocationId
      ? parseInt(credentials.shopifyLocationId, 10)
      : this.client.getPrimaryLocationId();

    this.credentials = credentials;
    this._connected = true;

    if (this.webhookSecret) {
      this.webhookHandler = new ShopifyWebhookHandler(this.webhookSecret);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.webhookHandler = null;
    this.primaryLocationId = null;
    await super.disconnect();
  }

  async getProducts(): Promise<UnifiedProduct[]> {
    this.ensureConnected();
    const products = await this.client!.getProducts();
    return products.map((p) => this.transformToUnified(p, 'shopify'));
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();
    const product = await this.client!.getProduct(externalId);
    if (!product) return null;
    return this.transformToUnified(product, 'shopify');
  }

  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();

    if (!this.primaryLocationId) {
      throw new Error('Primary location ID not configured');
    }

    const inventoryItemId = parseInt(externalId, 10);
    if (isNaN(inventoryItemId)) {
      throw new Error(`Invalid inventory item ID: ${externalId}`);
    }

    await this.client!.setInventoryLevel(
      inventoryItemId,
      this.primaryLocationId,
      quantity
    );
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number }>
  ): Promise<SyncResult> {
    this.ensureConnected();

    if (!this.primaryLocationId) {
      throw new Error('Primary location ID not configured');
    }

    const errors: Array<{
      productId: string;
      sku: string;
      message: string;
      code: string;
    }> = [];
    let successCount = 0;

    // Process updates in parallel
    await Promise.all(
      updates.map(async (update) => {
        try {
          const inventoryItemId = parseInt(update.externalId, 10);
          if (isNaN(inventoryItemId)) {
            throw new Error(`Invalid inventory item ID: ${update.externalId}`);
          }

          await this.client!.setInventoryLevel(
            inventoryItemId,
            this.primaryLocationId!,
            update.quantity
          );
          successCount++;
        } catch (error) {
          errors.push({
            productId: update.externalId,
            sku: '',
            message: error instanceof Error ? error.message : 'Unknown error',
            code: 'STOCK_UPDATE_FAILED',
          });
        }
      })
    );

    return {
      success: errors.length === 0,
      source: 'shopify',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      if (!this.webhookSecret) {
        return null;
      }
      this.webhookHandler = new ShopifyWebhookHandler(this.webhookSecret);
    }

    const parsed = this.webhookHandler.parsePayload(payload as string | Record<string, unknown>);

    // Check for duplicates
    if (payload && typeof payload === 'object' && 'X-Shopify-Event-Id' in payload) {
      const eventId = (payload as Record<string, unknown>)['X-Shopify-Event-Id'] as string;
      if (this.webhookHandler.isDuplicate(eventId)) {
        return null;
      }
    }

    const event = this.webhookHandler.handleWebhook(
      parsed.topic,
      parsed.data,
      parsed.timestamp
    );

    if (!event) return null;

    return this.transformWebhookEvent(event);
  }

  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult {
    if (!this.webhookSecret) {
      return { valid: false, error: 'Webhook secret not configured' };
    }

    if (!this.webhookHandler) {
      this.webhookHandler = new ShopifyWebhookHandler(this.webhookSecret);
    }

    return this.webhookHandler.validateSignature(payload, signature);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    this.ensureConnected();

    const webhookTopic = 'inventory_levels/update';

    const webhookId = await this.client!.subscribeWebhook(webhookTopic, url);
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
    this.webhookHandler = new ShopifyWebhookHandler(secret);
  }

  private transformWebhookEvent(event: ShopifyStockChangeEvent): StockChangeEvent {
    return {
      source: 'shopify',
      type: event.type === 'stock_update' ? 'stock_update' :
            event.type === 'order' ? 'order' : 'product_update',
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

export function createShopifyProvider(): ShopifyProvider {
  return new ShopifyProvider();
}
