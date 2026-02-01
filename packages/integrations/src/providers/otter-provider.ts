/**
 * Otter/Deliveroo Inventory Provider
 * Implements the unified InventoryProvider interface for Otter (Deliveroo)
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
import { OtterApiClient } from '../otter/client.js';
import { OtterWebhookHandler, type OtterStockChangeEvent } from '../otter/webhooks.js';
import type { OtterWebhookPayload, OtterWebhookEvent, OtterMenuItem } from '../otter/types.js';
import type { SyncResult, Product } from '../types.js';

export class OtterProvider extends BaseInventoryProvider {
  readonly channelType = 'deliveroo' as const;

  private client: OtterApiClient | null = null;
  private webhookHandler: OtterWebhookHandler | null = null;
  private webhookSecret?: string;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'deliveroo') {
      throw new ProviderAuthError('deliveroo', 'Invalid credential type');
    }

    if (!credentials.otterApiKey || !credentials.restaurantId) {
      throw new ProviderAuthError('deliveroo', 'Otter API key and restaurant ID are required');
    }

    this.client = new OtterApiClient({
      apiKey: credentials.otterApiKey,
      restaurantId: credentials.restaurantId,
    });

    await this.client.connect();
    this.credentials = credentials;
    this._connected = true;
    this.webhookHandler = new OtterWebhookHandler(this.webhookSecret);
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
    return products.map((p) => this.transformToUnified(p, 'deliveroo'));
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();
    const product = await this.client!.getProduct(externalId);
    if (!product) return null;
    return this.transformToUnified(product, 'deliveroo');
  }

  /**
   * Update stock/availability for a menu item
   * For Otter, quantity 0 means unavailable, quantity > 0 means available
   */
  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();

    // First check if the item tracks inventory
    const product = await this.client!.getProduct(externalId);

    if (product?.metadata?.trackInventory) {
      // Update actual stock level
      await this.client!.updateStockLevel(externalId, quantity, 'set', 'Sync update');
    }

    // Also update availability based on quantity
    const isAvailable = quantity > 0;
    await this.client!.updateItemAvailability(externalId, isAvailable, {
      reason: quantity === 0 ? 'out_of_stock' : undefined,
    });
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number }>
  ): Promise<SyncResult> {
    this.ensureConnected();

    const stockUpdates = updates.map((u) => ({
      productId: u.externalId,
      sku: '',
      quantity: u.quantity,
      source: 'otter' as const,
      timestamp: new Date(),
    }));

    // Use the client's updateStock method which handles bulk updates
    return this.client!.updateStock(stockUpdates);
  }

  /**
   * Update menu item availability (used for Deliveroo-specific availability)
   */
  async updateAvailability(
    externalId: string,
    isAvailable: boolean,
    options?: {
      reason?: string;
      unavailableUntil?: string;
    }
  ): Promise<void> {
    this.ensureConnected();

    await this.client!.updateItemAvailability(
      externalId,
      isAvailable,
      {
        reason: options?.reason as 'out_of_stock' | undefined,
        unavailableUntil: options?.unavailableUntil,
      }
    );
  }

  /**
   * Get the full menu with categories
   */
  async getMenu(): Promise<{ id: string; name: string; categories: Array<{ id: string; name: string; items: UnifiedProduct[] }> }> {
    this.ensureConnected();
    const menu = await this.client!.getMenu();

    return {
      id: menu.id,
      name: menu.name,
      categories: menu.categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        items: cat.items.map((item) => this.transformMenuItem(item)),
      })),
    };
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      this.webhookHandler = new OtterWebhookHandler(this.webhookSecret);
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
      this.webhookHandler = new OtterWebhookHandler(this.webhookSecret);
    }
    return this.webhookHandler.validateSignature(payload, signature);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    this.ensureConnected();

    const webhookEvents = (events || [
      'item.availability_changed',
      'item.stock_updated',
      'order.created',
    ]) as OtterWebhookEvent[];

    return this.client!.subscribeWebhook(url, webhookEvents, this.webhookSecret);
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
      this.webhookHandler = new OtterWebhookHandler(secret);
    }
  }

  private transformMenuItem(item: OtterMenuItem): UnifiedProduct {
    const quantity = item.trackInventory
      ? item.stockQuantity ?? 0
      : item.isAvailable ? -1 : 0;

    return {
      id: item.id,
      externalId: item.id,
      sku: item.sku || `OTTER-${item.id}`,
      name: item.name,
      price: item.price.amount,
      currency: item.price.currency,
      quantity,
      isTracked: item.trackInventory,
      isAvailable: item.isAvailable,
      lastUpdated: new Date(item.updatedAt),
      source: 'deliveroo',
      metadata: {
        categoryId: item.categoryId,
        description: item.description,
        imageUrl: item.imageUrl,
        availabilityStatus: item.availabilityStatus,
        allergens: item.allergens,
        dietaryLabels: item.dietaryLabels,
      },
    };
  }

  private transformWebhookEvent(event: OtterStockChangeEvent): StockChangeEvent {
    return {
      source: 'deliveroo',
      type: event.type === 'stock_update' ? 'stock_update' :
            event.type === 'order' ? 'order' : 'availability_change',
      externalId: event.itemId,
      sku: event.sku,
      previousQuantity: event.previousQuantity,
      newQuantity: event.newQuantity ?? 0,
      isAvailable: event.isAvailable,
      reason: event.reason,
      timestamp: event.timestamp,
      metadata: {
        ...event.metadata,
        availabilityStatus: event.availabilityStatus,
      },
    };
  }
}

export function createOtterProvider(): OtterProvider {
  return new OtterProvider();
}

// Alias for clarity
export { OtterProvider as DeliverooProvider };
export { createOtterProvider as createDeliverooProvider };
