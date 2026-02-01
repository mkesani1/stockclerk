/**
 * Wix Inventory Provider
 * Implements the unified InventoryProvider interface for Wix
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
import { WixApiClient } from '../wix/client.js';
import { WixWebhookHandler, type WixStockChangeEvent } from '../wix/webhooks.js';
import type { WixWebhookPayload, WixWebhookEventType, WixOAuthState } from '../wix/types.js';
import type { SyncResult } from '../types.js';

export class WixProvider extends BaseInventoryProvider {
  readonly channelType = 'wix' as const;

  private client: WixApiClient | null = null;
  private webhookHandler: WixWebhookHandler | null = null;
  private webhookSecret?: string;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'wix') {
      throw new ProviderAuthError('wix', 'Invalid credential type');
    }

    if (!credentials.clientId || !credentials.clientSecret) {
      throw new ProviderAuthError('wix', 'Client ID and secret are required');
    }

    this.client = new WixApiClient({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      siteId: credentials.siteId,
      instanceId: credentials.instanceId,
    });

    await this.client.connect();
    this.credentials = credentials;
    this._connected = true;
    this.webhookHandler = new WixWebhookHandler(this.webhookSecret);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.webhookHandler = null;
    await super.disconnect();
  }

  /**
   * Get OAuth authorization URL for user to authorize the app
   */
  getAuthorizationUrl(redirectUri: string, state?: string): string {
    if (!this.client) {
      throw new ProviderAuthError('wix', 'Client not initialized');
    }
    return this.client.getAuthorizationUrl(redirectUri, state);
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<WixOAuthState> {
    if (!this.client) {
      // Create a temporary client for token exchange
      if (!this.credentials?.clientId || !this.credentials?.clientSecret) {
        throw new ProviderAuthError('wix', 'Client credentials required for token exchange');
      }
      this.client = new WixApiClient({
        clientId: this.credentials.clientId,
        clientSecret: this.credentials.clientSecret,
      });
    }
    return this.client.exchangeCodeForTokens(code, redirectUri);
  }

  /**
   * Get current OAuth state (tokens)
   */
  getOAuthState(): WixOAuthState | null {
    return this.client?.getOAuthState() || null;
  }

  async getProducts(): Promise<UnifiedProduct[]> {
    this.ensureConnected();
    const products = await this.client!.getProducts();
    return products.map((p) => this.transformToUnified(p, 'wix'));
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();
    const product = await this.client!.getProduct(externalId);
    if (!product) return null;
    return this.transformToUnified(product, 'wix');
  }

  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();
    await this.client!.updateInventoryByProductId(externalId, 'default', quantity);
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number; variantId?: string }>
  ): Promise<SyncResult> {
    this.ensureConnected();
    const stockUpdates = updates.map((u) => ({
      productId: u.externalId,
      sku: '',
      quantity: u.quantity,
      source: 'wix' as const,
      timestamp: new Date(),
    }));
    return this.client!.updateStock(stockUpdates);
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      this.webhookHandler = new WixWebhookHandler(this.webhookSecret);
    }

    const parsed = this.webhookHandler.parsePayload(payload as string | Record<string, unknown>);
    const events = this.webhookHandler.handleWebhook(parsed);

    if (!events) return null;

    if (Array.isArray(events)) {
      return events.map((e) => this.transformWebhookEvent(e));
    }

    return this.transformWebhookEvent(events);
  }

  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult {
    if (!this.webhookHandler) {
      this.webhookHandler = new WixWebhookHandler(this.webhookSecret);
    }
    return this.webhookHandler.validateSignature(payload, signature, undefined);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    this.ensureConnected();

    // Wix allows subscribing to one event at a time, so we'll use the primary one
    const eventType = (events?.[0] || 'wix.stores.inventory.updated') as WixWebhookEventType;
    return this.client!.subscribeWebhook(url, eventType);
  }

  async unsubscribeWebhook(webhookId: string): Promise<void> {
    this.ensureConnected();
    await this.client!.unsubscribeWebhook(webhookId);
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
      this.webhookHandler = new WixWebhookHandler(secret);
    }
  }

  private transformWebhookEvent(event: WixStockChangeEvent): StockChangeEvent {
    return {
      source: 'wix',
      type: event.type === 'inventory_update' ? 'stock_update' :
            event.type === 'order' ? 'order' : 'product_update',
      externalId: event.productId,
      sku: event.sku,
      previousQuantity: event.previousQuantity,
      newQuantity: event.newQuantity,
      isAvailable: event.inStock,
      timestamp: event.timestamp,
      metadata: {
        ...event.metadata,
        variantId: event.variantId,
      },
    };
  }
}

export function createWixProvider(): WixProvider {
  return new WixProvider();
}
