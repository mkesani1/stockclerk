/**
 * Shopify API Client
 * Handles authentication, API calls, and data transformation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry, AbortError } from '../utils/retry.js';
import type { Product } from '../types.js';
import type {
  ShopifyClientConfig,
  ShopifyProduct,
  ShopifyProductQuery,
  ShopifyVariant,
  ShopifyLocation,
  ShopifyInventoryLevel,
  ShopifyInventoryItem,
  ShopifyStockUpdate,
} from './types.js';

// Rate limit: 40 requests per minute for Shopify API (2 requests/second)
// Using 30/min for buffer
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_INTERVAL_MS = 60000;

export class ShopifyApiClient {
  private readonly config: Required<Pick<ShopifyClientConfig, 'apiVersion' | 'timeout' | 'retryAttempts'>> & ShopifyClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: PQueue;
  private connected = false;
  private primaryLocationId: number | null = null;

  constructor(config: ShopifyClientConfig) {
    this.config = {
      apiVersion: '2024-01',
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    const baseUrl = `https://${this.config.shop}.myshopify.com/admin/api/${this.config.apiVersion}`;

    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Access-Token': this.config.accessToken,
      },
    });

    // Setup response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => this.handleApiError(error)
    );

    this.rateLimiter = createRateLimiter({
      concurrency: 5,
      intervalMs: RATE_LIMIT_INTERVAL_MS,
      maxPerInterval: RATE_LIMIT_REQUESTS,
    });
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    // Verify connection and get primary location
    const locations = await this.getLocations();
    const primaryLocation = locations.find((l) => l.active);
    if (primaryLocation) {
      this.primaryLocationId = primaryLocation.id;
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.primaryLocationId = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getPrimaryLocationId(): number | null {
    return this.primaryLocationId;
  }

  // ============================================================================
  // Product Operations
  // ============================================================================

  async getProducts(query?: ShopifyProductQuery): Promise<Product[]> {
    const shopifyProducts = await this.fetchAllProducts(query);
    return this.transformProducts(shopifyProducts);
  }

  async getProduct(id: string): Promise<Product | null> {
    const productId = parseInt(id, 10);
    if (isNaN(productId)) {
      return null;
    }

    try {
      const response = await this.rateLimitedRequest<{ product: ShopifyProduct }>(
        () => this.httpClient.get(`/products/${productId}.json`)
      );
      const products = this.transformProducts([response.product]);
      return products[0] || null;
    } catch (error) {
      if (error instanceof ShopifyNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async fetchAllProducts(query?: ShopifyProductQuery): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let sinceId = query?.since_id;
    let limit = query?.limit || 250;

    // GraphQL query is preferred for Shopify, but REST works too
    // Fetch in batches until no more products
    while (true) {
      const response = await this.rateLimitedRequest<{ products: ShopifyProduct[] }>(
        () => this.httpClient.get('/products.json', {
          params: {
            limit,
            since_id: sinceId,
            fields: query?.fields,
          },
        })
      );

      if (!response.products || response.products.length === 0) {
        break;
      }

      products.push(...response.products);

      // If we got fewer products than limit, we've reached the end
      if (response.products.length < limit) {
        break;
      }

      // Continue from last product ID
      sinceId = response.products[response.products.length - 1].id;
    }

    return products;
  }

  private transformProducts(shopifyProducts: ShopifyProduct[]): Product[] {
    const products: Product[] = [];

    for (const sp of shopifyProducts) {
      // Flatten variants into separate products
      if (sp.variants && sp.variants.length > 0) {
        for (const variant of sp.variants) {
          products.push(this.transformVariant(sp, variant));
        }
      }
    }

    return products;
  }

  private transformVariant(product: ShopifyProduct, variant: ShopifyVariant): Product {
    return {
      id: variant.id.toString(),
      sku: variant.sku || `SHOPIFY-${variant.id}`,
      name: `${product.title}${variant.title && variant.title !== 'Default Title' ? ` - ${variant.title}` : ''}`,
      price: parseFloat(variant.price),
      quantity: variant.inventory_quantity || 0,
      lastUpdated: new Date(product.updated_at),
      metadata: {
        source: 'shopify',
        productId: product.id.toString(),
        variantId: variant.id.toString(),
        inventoryItemId: variant.inventory_item_id.toString(),
        barcode: variant.barcode,
        vendor: product.vendor,
        productType: product.product_type,
        variantPosition: variant.position,
      },
    };
  }

  // ============================================================================
  // Inventory Operations
  // ============================================================================

  async getInventoryLevels(
    inventoryItemIds: number[],
    locationIds?: number[]
  ): Promise<ShopifyInventoryLevel[]> {
    if (inventoryItemIds.length === 0) {
      return [];
    }

    const levels: ShopifyInventoryLevel[] = [];

    // Fetch inventory levels for each inventory item
    for (const itemId of inventoryItemIds) {
      const response = await this.rateLimitedRequest<{ inventory_levels: ShopifyInventoryLevel[] }>(
        () => this.httpClient.get(`/inventory_items/${itemId}/inventory_levels.json`, {
          params: locationIds ? { location_ids: locationIds.join(',') } : undefined,
        })
      );

      if (response.inventory_levels) {
        levels.push(...response.inventory_levels);
      }
    }

    return levels;
  }

  async getInventoryItem(id: string): Promise<ShopifyInventoryItem | null> {
    const itemId = parseInt(id, 10);
    if (isNaN(itemId)) {
      return null;
    }

    try {
      const response = await this.rateLimitedRequest<{ inventory_item: ShopifyInventoryItem }>(
        () => this.httpClient.get(`/inventory_items/${itemId}.json`)
      );
      return response.inventory_item || null;
    } catch (error) {
      if (error instanceof ShopifyNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getLocations(): Promise<ShopifyLocation[]> {
    const response = await this.rateLimitedRequest<{ locations: ShopifyLocation[] }>(
      () => this.httpClient.get('/locations.json')
    );

    return response.locations || [];
  }

  async setInventoryLevel(
    inventoryItemId: number,
    locationId: number,
    available: number
  ): Promise<void> {
    const payload = {
      inventory_level: {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        available,
      },
    };

    await this.rateLimitedRequest(
      () => this.httpClient.post('/inventory_levels/set.json', payload)
    );
  }

  async adjustInventoryLevel(
    inventoryItemId: number,
    locationId: number,
    adjustment: number
  ): Promise<void> {
    const payload = {
      inventory_adjustment: {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        available_adjustment: adjustment,
      },
    };

    await this.rateLimitedRequest(
      () => this.httpClient.post('/inventory_levels/adjust.json', payload)
    );
  }

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  async subscribeWebhook(topic: string, address: string): Promise<number> {
    const payload = {
      webhook: {
        topic,
        address,
        format: 'json',
      },
    };

    const response = await this.rateLimitedRequest<{ webhook: { id: number } }>(
      () => this.httpClient.post('/webhooks.json', payload)
    );

    return response.webhook.id;
  }

  async unsubscribeWebhook(webhookId: number): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.delete(`/webhooks/${webhookId}.json`)
    );
  }

  async listWebhooks(): Promise<Array<{ id: number; topic: string; address: string }>> {
    const response = await this.rateLimitedRequest<{ webhooks: Array<{ id: number; topic: string; address: string }> }>(
      () => this.httpClient.get('/webhooks.json')
    );

    return response.webhooks || [];
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.rateLimitedRequest<{ shops?: Array<{ id: number }> }>(
        () => this.httpClient.get('/shop.json')
      );

      return !!response;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async rateLimitedRequest<T>(request: () => Promise<{ data: T }>): Promise<T> {
    return this.rateLimiter.add(async () => {
      return withRetry(
        async () => {
          const response = await request();
          return response.data;
        },
        {
          retries: this.config.retryAttempts,
          minTimeout: 1000,
          maxTimeout: 10000,
          onRetry: (error, attempt) => {
            console.warn(`Shopify API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { errors?: Array<{ message?: string }> } | undefined;

    if (status === 404) {
      throw new ShopifyNotFoundError(
        data?.errors?.[0]?.message || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new ShopifyAuthError(
        data?.errors?.[0]?.message || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new ShopifyRateLimitError(
        data?.errors?.[0]?.message || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new ShopifyServerError(
        data?.errors?.[0]?.message || 'Server error'
      );
    }

    throw new ShopifyApiError(
      data?.errors?.[0]?.message || error.message || 'Unknown API error',
      'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

export class ShopifyNotFoundError extends ShopifyApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'ShopifyNotFoundError';
  }
}

export class ShopifyAuthError extends ShopifyApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'ShopifyAuthError';
  }
}

export class ShopifyRateLimitError extends ShopifyApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'ShopifyRateLimitError';
  }
}

export class ShopifyServerError extends ShopifyApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'ShopifyServerError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createShopifyClient(config: ShopifyClientConfig): ShopifyApiClient {
  return new ShopifyApiClient(config);
}
