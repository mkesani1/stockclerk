/**
 * Uber Eats Inventory Provider
 * Implements the unified InventoryProvider interface for Uber Eats
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
import { UberEatsApiClient } from '../uber_eats/client.js';
import { UberEatsWebhookHandler, type UberEatsStockChangeEvent } from '../uber_eats/webhooks.js';
import type { UberEatsWebhookPayload, UberEatsMenuItem } from '../uber_eats/types.js';
import type { SyncResult, Product } from '../types.js';

export class UberEatsProvider extends BaseInventoryProvider {
  readonly channelType = 'uber_eats' as const;

  private client: UberEatsApiClient | null = null;
  private webhookHandler: UberEatsWebhookHandler | null = null;
  private webhookSecret?: string;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'uber_eats') {
      throw new ProviderAuthError('uber_eats', 'Invalid credential type');
    }

    if (!credentials.uberEatsClientId || !credentials.uberEatsClientSecret || !credentials.uberEatsStoreId) {
      throw new ProviderAuthError(
        'uber_eats',
        'Uber Eats client ID, client secret, and store ID are required'
      );
    }

    this.client = new UberEatsApiClient({
      clientId: credentials.uberEatsClientId,
      clientSecret: credentials.uberEatsClientSecret,
      storeId: credentials.uberEatsStoreId,
    });

    await this.client.authenticate();
    await this.client.connect();
    this.credentials = credentials;
    this._connected = true;
    this.webhookHandler = new UberEatsWebhookHandler(
      this.webhookSecret ? { secret: this.webhookSecret, clientSecret: credentials.uberEatsClientSecret } : undefined
    );
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
    const items = await this.client!.getMenuItems(this.credentials!.uberEatsStoreId!);
    return items.map((item) => this.transformMenuItem(item));
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();
    const items = await this.client!.getMenuItems(this.credentials!.uberEatsStoreId!);
    const item = items.find((i) => i.id === externalId || i.external_id === externalId);
    if (!item) return null;
    return this.transformMenuItem(item);
  }

  /**
   * Update stock/availability for a menu item
   * For Uber Eats, quantity 0 means unavailable, quantity > 0 means available
   * This is availability-based (not quantity-based)
   */
  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();

    // Map quantity to availability: quantity > 0 = available, quantity = 0 = unavailable
    const isAvailable = quantity > 0;

    await this.client!.updateItemAvailability(
      this.credentials!.uberEatsStoreId!,
      externalId,
      isAvailable
    );
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number }>
  ): Promise<SyncResult> {
    this.ensureConnected();

    const errors: Array<{ productId: string; sku?: string; message: string; code: string }> = [];
    let successCount = 0;

    // Convert to Uber Eats format (map quantity to availability)
    const availabilityUpdates = updates.map((u) => ({
      itemId: u.externalId,
      available: u.quantity > 0,
    }));

    try {
      await this.client!.batchUpdateAvailability(
        this.credentials!.uberEatsStoreId!,
        availabilityUpdates
      );
      successCount = updates.length;
    } catch (error) {
      // If batch update fails, try individual updates
      for (const update of updates) {
        try {
          await this.client!.updateItemAvailability(
            this.credentials!.uberEatsStoreId!,
            update.externalId,
            update.quantity > 0
          );
          successCount++;
        } catch (err) {
          errors.push({
            productId: update.externalId,
            message: err instanceof Error ? err.message : 'Unknown error',
            code: 'UPDATE_FAILED',
          });
        }
      }
    }

    return {
      success: errors.length === 0,
      source: 'uber_eats',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      this.webhookHandler = new UberEatsWebhookHandler(
        this.webhookSecret
          ? { secret: this.webhookSecret, clientSecret: this.credentials?.uberEatsClientSecret || '' }
          : undefined
      );
    }

    const parsed = this.webhookHandler.parsePayload(payload as string | Record<string, unknown>);
    const events = this.webhookHandler.handleWebhook(parsed);

    if (!events) return null;

    return events.map((e) => this.transformWebhookEvent(e));
  }

  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult {
    if (!this.webhookHandler) {
      this.webhookHandler = new UberEatsWebhookHandler(
        this.webhookSecret
          ? { secret: this.webhookSecret, clientSecret: this.credentials?.uberEatsClientSecret || '' }
          : undefined
      );
    }
    return this.webhookHandler.validateSignature(payload, signature);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    // Uber Eats webhooks are configured in the developer portal, not via API
    // This method returns a note for the user to configure webhooks manually
    return 'Uber Eats webhooks must be configured in the Uber Developer Portal. ' +
           'Please add your webhook URL there with the appropriate event subscriptions.';
  }

  async unsubscribeWebhook(webhookId: string): Promise<void> {
    // Webhooks are managed via Uber Developer Portal, not via API
    // This is a no-op for Uber Eats
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
      this.webhookHandler = new UberEatsWebhookHandler(
        { secret, clientSecret: this.credentials?.uberEatsClientSecret || '' }
      );
    }
  }

  private transformMenuItem(item: UberEatsMenuItem): UnifiedProduct {
    // Uber Eats is availability-based: available = 1, unavailable = 0
    const quantity = item.available ? 1 : 0;

    return {
      id: item.id,
      externalId: item.id,
      sku: item.external_id || `UBEREATS-${item.id}`,
      name: item.title,
      price: item.price,
      currency: 'GBP',
      quantity,
      isTracked: false, // Uber Eats doesn't track quantities, only availability
      isAvailable: item.available,
      lastUpdated: new Date(),
      source: 'uber_eats',
      metadata: {
        externalId: item.external_id,
        suspended: !!item.suspension_info,
        suspensionReason: item.suspension_info?.suspension.reason,
        suspendUntil: item.suspension_info?.suspension.suspend_until,
      },
    };
  }

  private transformWebhookEvent(event: UberEatsStockChangeEvent): StockChangeEvent {
    return {
      source: 'uber_eats',
      type: event.type === 'order' ? 'order' : 'availability_change',
      externalId: event.itemId,
      newQuantity: event.newQuantity,
      isAvailable: event.isAvailable,
      reason: event.reason,
      timestamp: event.timestamp,
      metadata: event.metadata,
    };
  }
}

export function createUberEatsProvider(): UberEatsProvider {
  return new UberEatsProvider();
}
