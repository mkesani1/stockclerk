/**
 * WooCommerce API Client
 * Handles authentication, API calls, and data transformation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import type {
  WooCommerceClientConfig,
  WooCommerceProduct,
  WooCommerceVariation,
  WooCommerceOrder,
  WooCommerceProductQuery,
  WooCommerceStockUpdate,
  WooCommercePaginatedResponse,
} from './types.js';

// Rate limit: 25 requests per minute for WooCommerce API
const RATE_LIMIT_REQUESTS = 25;
const RATE_LIMIT_INTERVAL_MS = 60000;

export class WooCommerceApiClient {
  private readonly config: Required<Pick<WooCommerceClientConfig, 'version' | 'timeout' | 'retryAttempts'>> &
    WooCommerceClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: ReturnType<typeof createRateLimiter>;
  private connected = false;

  constructor(config: WooCommerceClientConfig) {
    this.config = {
      version: 'wc/v3',
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    const baseURL = `${this.config.siteUrl}/wp-json/${this.config.version}`;

    this.httpClient = axios.create({
      baseURL,
      timeout: this.config.timeout,
      auth: {
        username: this.config.consumerKey,
        password: this.config.consumerSecret,
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
    // Verify connection by fetching a single product
    try {
      await this.rateLimitedRequest(
        () => this.httpClient.get('/products', { params: { per_page: 1 } })
      );
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Product Operations
  // ============================================================================

  async getProducts(query?: WooCommerceProductQuery): Promise<WooCommerceProduct[]> {
    const products: WooCommerceProduct[] = [];
    let page = query?.page || 1;
    const perPage = query?.per_page || 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<WooCommerceProduct[]>(
        () =>
          this.httpClient.get('/products', {
            params: {
              page,
              per_page: perPage,
              search: query?.search,
              sku: query?.sku,
              type: query?.type,
            },
          })
      );

      products.push(...response);

      // Check if there are more pages using headers
      const totalPages = parseInt(
        this.httpClient.defaults.headers['X-WP-TotalPages'] as string,
        10
      );
      hasMore = !isNaN(totalPages) && page < totalPages;

      page++;
    }

    return products;
  }

  async getProduct(id: number): Promise<WooCommerceProduct | null> {
    try {
      const response = await this.rateLimitedRequest<WooCommerceProduct>(
        () => this.httpClient.get(`/products/${id}`)
      );
      return response;
    } catch (error) {
      if (error instanceof WooCommerceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getProductVariations(productId: number): Promise<WooCommerceVariation[]> {
    const variations: WooCommerceVariation[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<WooCommerceVariation[]>(
        () =>
          this.httpClient.get(`/products/${productId}/variations`, {
            params: {
              page,
              per_page: perPage,
            },
          })
      );

      variations.push(...response);
      hasMore = response.length === perPage;
      page++;
    }

    return variations;
  }

  async getProductVariation(
    productId: number,
    variationId: number
  ): Promise<WooCommerceVariation | null> {
    try {
      const response = await this.rateLimitedRequest<WooCommerceVariation>(
        () => this.httpClient.get(`/products/${productId}/variations/${variationId}`)
      );
      return response;
    } catch (error) {
      if (error instanceof WooCommerceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async updateProduct(id: number, data: Partial<WooCommerceProduct>): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.put(`/products/${id}`, data)
    );
  }

  async updateProductVariation(
    productId: number,
    variationId: number,
    data: Partial<WooCommerceVariation>
  ): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.put(`/products/${productId}/variations/${variationId}`, data)
    );
  }

  async updateStock(productId: number, quantity: number): Promise<void> {
    await this.updateProduct(productId, {
      stock_quantity: quantity,
    });
  }

  async updateVariationStock(
    productId: number,
    variationId: number,
    quantity: number
  ): Promise<void> {
    await this.updateProductVariation(productId, variationId, {
      stock_quantity: quantity,
    });
  }

  // ============================================================================
  // Order Operations
  // ============================================================================

  async getOrders(params?: Record<string, unknown>): Promise<WooCommerceOrder[]> {
    const response = await this.rateLimitedRequest<WooCommerceOrder[]>(
      () =>
        this.httpClient.get('/orders', {
          params: {
            per_page: 100,
            ...params,
          },
        })
    );
    return response;
  }

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  async subscribeWebhook(
    topic: string,
    deliveryUrl: string,
    secret: string
  ): Promise<number> {
    const response = await this.rateLimitedRequest<{ id: number }>(
      () =>
        this.httpClient.post('/webhooks', {
          topic,
          delivery_url: deliveryUrl,
          secret,
        })
    );

    return response.id;
  }

  async unsubscribeWebhook(webhookId: number): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.delete(`/webhooks/${webhookId}`)
    );
  }

  async listWebhooks(): Promise<Array<{ id: number; topic: string; delivery_url: string }>> {
    const response = await this.rateLimitedRequest<
      Array<{ id: number; topic: string; delivery_url: string }>
    >(
      () =>
        this.httpClient.get('/webhooks', {
          params: { per_page: 100 },
        })
    );

    return response;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.rateLimitedRequest(
        () => this.httpClient.get('/products', { params: { per_page: 1 } })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async rateLimitedRequest<T>(
    request: () => Promise<{ data: T }>
  ): Promise<T> {
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
            console.warn(`WooCommerce API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; code?: string } | undefined;

    if (status === 404) {
      throw new WooCommerceNotFoundError(
        data?.message || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new WooCommerceAuthError(
        data?.message || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new WooCommerceRateLimitError(
        data?.message || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new WooCommerceServerError(
        data?.message || 'Server error'
      );
    }

    throw new WooCommerceApiError(
      data?.message || error.message || 'Unknown API error',
      data?.code || 'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class WooCommerceApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'WooCommerceApiError';
  }
}

export class WooCommerceNotFoundError extends WooCommerceApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'WooCommerceNotFoundError';
  }
}

export class WooCommerceAuthError extends WooCommerceApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'WooCommerceAuthError';
  }
}

export class WooCommerceRateLimitError extends WooCommerceApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'WooCommerceRateLimitError';
  }
}

export class WooCommerceServerError extends WooCommerceApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'WooCommerceServerError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWooCommerceClient(config: WooCommerceClientConfig): WooCommerceApiClient {
  return new WooCommerceApiClient(config);
}
