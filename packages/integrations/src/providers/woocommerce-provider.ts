/**
 * WooCommerce Inventory Provider
 * Implements the unified InventoryProvider interface for WooCommerce
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
import {
  WooCommerceApiClient,
  createWooCommerceClient,
} from '../woocommerce/client.js';
import {
  WooCommerceWebhookHandler,
  createWooCommerceWebhookHandler,
} from '../woocommerce/webhooks.js';
import type { SyncResult } from '../types.js';
import type { WooCommerceProduct, WooCommerceVariation } from '../woocommerce/types.js';

export class WooCommerceProvider extends BaseInventoryProvider {
  readonly channelType = 'woocommerce' as const;

  private client: WooCommerceApiClient | null = null;
  private webhookHandler: WooCommerceWebhookHandler | null = null;
  private webhookSecret?: string;

  async connect(credentials: ChannelCredentials): Promise<void> {
    if (credentials.type !== 'woocommerce') {
      throw new ProviderAuthError('woocommerce', 'Invalid credential type');
    }

    if (!credentials.woocommerceSiteUrl || !credentials.woocommerceConsumerKey || !credentials.woocommerceConsumerSecret) {
      throw new ProviderAuthError(
        'woocommerce',
        'Site URL, consumer key, and consumer secret are required'
      );
    }

    this.client = createWooCommerceClient({
      siteUrl: credentials.woocommerceSiteUrl,
      consumerKey: credentials.woocommerceConsumerKey,
      consumerSecret: credentials.woocommerceConsumerSecret,
    });

    await this.client.connect();
    this.credentials = credentials;
    this._connected = true;
    this.webhookHandler = createWooCommerceWebhookHandler(this.webhookSecret);
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
    const unifiedProducts: UnifiedProduct[] = [];

    for (const product of products) {
      if (product.type === 'variable') {
        // Handle variable products - each variation becomes a separate UnifiedProduct
        const variations = await this.client!.getProductVariations(product.id);
        for (const variation of variations) {
          unifiedProducts.push(
            this.transformVariationToUnified(product, variation)
          );
        }
      } else {
        // Handle simple products
        unifiedProducts.push(this.transformProductToUnified(product));
      }
    }

    return unifiedProducts;
  }

  async getProduct(externalId: string): Promise<UnifiedProduct | null> {
    this.ensureConnected();

    // Parse externalId: could be either "productId" or "productId:variationId"
    const parts = externalId.split(':');
    const productId = parseInt(parts[0], 10);

    if (isNaN(productId)) {
      return null;
    }

    const product = await this.client!.getProduct(productId);
    if (!product) {
      return null;
    }

    // If it's a variation
    if (parts.length === 2) {
      const variationId = parseInt(parts[1], 10);
      if (isNaN(variationId)) {
        return null;
      }

      const variation = await this.client!.getProductVariation(productId, variationId);
      if (!variation) {
        return null;
      }

      return this.transformVariationToUnified(product, variation);
    }

    // Simple product
    return this.transformProductToUnified(product);
  }

  async updateStock(externalId: string, quantity: number): Promise<void> {
    this.ensureConnected();

    // Parse externalId: could be either "productId" or "productId:variationId"
    const parts = externalId.split(':');
    const productId = parseInt(parts[0], 10);

    if (isNaN(productId)) {
      throw new Error(`Invalid product ID in externalId: ${externalId}`);
    }

    if (parts.length === 2) {
      // Update variation stock
      const variationId = parseInt(parts[1], 10);
      if (isNaN(variationId)) {
        throw new Error(`Invalid variation ID in externalId: ${externalId}`);
      }
      await this.client!.updateVariationStock(productId, variationId, quantity);
    } else {
      // Update simple product stock
      await this.client!.updateStock(productId, quantity);
    }
  }

  async batchUpdateStock(
    updates: Array<{ externalId: string; quantity: number }>
  ): Promise<SyncResult> {
    this.ensureConnected();

    const errors: Array<{
      productId: string;
      sku?: string;
      message: string;
      code: string;
    }> = [];
    let successCount = 0;

    // Process updates sequentially to avoid rate limiting issues
    for (const update of updates) {
      try {
        await this.updateStock(update.externalId, update.quantity);
        successCount++;
      } catch (error) {
        errors.push({
          productId: update.externalId,
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'UPDATE_FAILED',
        });
      }
    }

    return {
      success: errors.length === 0,
      source: 'woocommerce',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  async handleWebhook(payload: unknown): Promise<StockChangeEvent | StockChangeEvent[] | null> {
    if (!this.webhookHandler) {
      this.webhookHandler = createWooCommerceWebhookHandler(this.webhookSecret);
    }

    // Extract topic from webhook context (should be passed separately)
    // For now, we'll need to infer from payload structure
    const parsed = this.webhookHandler.parsePayload(
      payload as string | Record<string, unknown>
    );

    // Determine topic based on payload data structure
    const data = parsed.data as Record<string, unknown>;
    let topic = '';

    if ('line_items' in data) {
      topic = 'order.completed';
    } else if ('type' in data) {
      topic = 'product.updated';
    } else {
      return null;
    }

    const event = this.webhookHandler.handleWebhook(parsed, topic);
    return event;
  }

  validateWebhook(payload: string | Buffer, signature: string): WebhookValidationResult {
    if (!this.webhookHandler) {
      this.webhookHandler = createWooCommerceWebhookHandler(this.webhookSecret);
    }
    return this.webhookHandler.validateSignature(payload, signature);
  }

  async subscribeWebhook(url: string, events?: string[]): Promise<string> {
    this.ensureConnected();

    const webhookTopics = events || [
      'product.updated',
      'product.created',
      'order.completed',
    ];

    // WooCommerce API doesn't support subscribing to multiple topics at once
    // We subscribe to the first topic and return its ID
    const webhookId = await this.client!.subscribeWebhook(
      webhookTopics[0],
      url,
      this.webhookSecret || ''
    );

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
      this.webhookHandler = createWooCommerceWebhookHandler(secret);
    }
  }

  private transformProductToUnified(product: WooCommerceProduct): UnifiedProduct {
    return {
      id: product.id.toString(),
      externalId: product.id.toString(),
      sku: product.sku,
      name: product.name,
      price: parseFloat(product.price),
      currency: 'GBP',
      quantity: product.stock_quantity ?? 0,
      isTracked: product.manage_stock,
      isAvailable: product.stock_status === 'instock',
      lastUpdated: new Date(product.date_modified),
      source: 'woocommerce',
      metadata: {
        productType: product.type,
        stockStatus: product.stock_status,
        regularPrice: product.regular_price,
        manageStock: product.manage_stock,
      },
    };
  }

  private transformVariationToUnified(
    product: WooCommerceProduct,
    variation: WooCommerceVariation
  ): UnifiedProduct {
    const externalId = `${product.id}:${variation.id}`;

    return {
      id: externalId,
      externalId,
      sku: variation.sku,
      name: `${product.name} (${this.formatAttributes(variation.attributes)})`,
      price: parseFloat(variation.price),
      currency: 'GBP',
      quantity: variation.stock_quantity ?? 0,
      isTracked: variation.manage_stock,
      isAvailable: variation.stock_status === 'instock',
      lastUpdated: new Date(product.date_modified),
      source: 'woocommerce',
      metadata: {
        productType: 'variation',
        parentProductId: product.id,
        variationId: variation.id,
        stockStatus: variation.stock_status,
        manageStock: variation.manage_stock,
        attributes: variation.attributes,
      },
    };
  }

  private formatAttributes(
    attributes: Array<{ id: number; name: string; option: string }>
  ): string {
    return attributes.map((attr) => attr.option).join(', ');
  }
}

export function createWooCommerceProvider(): WooCommerceProvider {
  return new WooCommerceProvider();
}
