/**
 * Eposnow API Client
 * Handles authentication, API calls, and data transformation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry, AbortError } from '../utils/retry.js';
import type { Product, StockUpdate, SyncResult, SyncError } from '../types.js';
import type {
  EposnowClientConfig,
  EposnowProduct,
  EposnowProductQuery,
  EposnowStockUpdate,
  EposnowStockAdjustmentReason,
  EposnowLocation,
  EposnowAuthToken,
  EposnowApiResponse,
  EposnowWebhookConfig,
  EposnowWebhookEvent,
} from './types.js';

// Rate limit: 60 requests per minute for Eposnow API
const RATE_LIMIT_REQUESTS = 60;
const RATE_LIMIT_INTERVAL_MS = 60000;

export class EposnowApiClient {
  private readonly config: Required<Pick<EposnowClientConfig, 'baseUrl' | 'timeout' | 'retryAttempts'>> & EposnowClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: PQueue;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private connected = false;

  constructor(config: EposnowClientConfig) {
    this.config = {
      baseUrl: 'https://api.eposnowhq.com',
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Setup request interceptor for auth token
    this.httpClient.interceptors.request.use(async (config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
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
    await this.authenticate();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.accessToken !== null && !this.isTokenExpired();
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    // Consider token expired 5 minutes before actual expiry
    return new Date() >= new Date(this.tokenExpiresAt.getTime() - 5 * 60 * 1000);
  }

  private async authenticate(): Promise<void> {
    const credentials = Buffer.from(
      `${this.config.apiKey}:${this.config.apiSecret}`
    ).toString('base64');

    const response = await this.httpClient.post<EposnowAuthToken>(
      '/api/v4/auth/token',
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + response.data.expires_in * 1000);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.authenticate();
    }
  }

  // ============================================================================
  // Product Operations
  // ============================================================================

  async getProducts(query?: EposnowProductQuery): Promise<Product[]> {
    await this.ensureAuthenticated();

    const eposnowProducts = await this.fetchAllProducts(query);
    return eposnowProducts.map((p) => this.transformProduct(p));
  }

  async getProduct(id: string): Promise<Product | null> {
    await this.ensureAuthenticated();

    const productId = parseInt(id, 10);
    if (isNaN(productId)) {
      return null;
    }

    try {
      const response = await this.rateLimitedRequest<EposnowProduct>(
        () => this.httpClient.get(`/api/v4/Product/${productId}`)
      );
      return this.transformProduct(response);
    } catch (error) {
      if (error instanceof EposnowNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async fetchAllProducts(query?: EposnowProductQuery): Promise<EposnowProduct[]> {
    const products: EposnowProduct[] = [];
    let page = query?.page || 1;
    const pageSize = query?.pageSize || 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<EposnowApiResponse<EposnowProduct[]>>(
        () => this.httpClient.get('/api/v4/Product', {
          params: {
            page,
            pageSize,
            categoryId: query?.categoryId,
            includeDeleted: query?.includeDeleted || false,
            modifiedSince: query?.modifiedSince,
            search: query?.search,
          },
        })
      );

      products.push(...response.data);

      if (response.meta) {
        hasMore = page * pageSize < response.meta.total;
      } else {
        hasMore = response.data.length === pageSize;
      }

      page++;
    }

    return products;
  }

  private transformProduct(eposnowProduct: EposnowProduct): Product {
    return {
      id: eposnowProduct.Id.toString(),
      sku: eposnowProduct.SKU || eposnowProduct.Barcode || `EPOS-${eposnowProduct.Id}`,
      name: eposnowProduct.Name,
      price: eposnowProduct.SalePrice,
      quantity: eposnowProduct.CurrentStockLevel,
      lastUpdated: new Date(eposnowProduct.UpdatedDate),
      metadata: {
        source: 'eposnow',
        costPrice: eposnowProduct.CostPrice,
        categoryId: eposnowProduct.CategoryId,
        productType: eposnowProduct.ProductType,
        barcode: eposnowProduct.Barcode,
        reorderLevel: eposnowProduct.ReorderLevel,
        optimalStockLevel: eposnowProduct.OptimalStockLevel,
        locationStocks: eposnowProduct.LocationStockLevels,
        variants: eposnowProduct.Variants?.map((v) => ({
          id: v.Id.toString(),
          name: v.Name,
          sku: v.SKU,
          quantity: v.CurrentStockLevel,
        })),
      },
    };
  }

  // ============================================================================
  // Stock Operations
  // ============================================================================

  async updateStock(
    productId: string,
    quantity: number,
    reason: EposnowStockAdjustmentReason = 'Adjustment',
    notes?: string
  ): Promise<void> {
    await this.ensureAuthenticated();

    const update: EposnowStockUpdate = {
      ProductId: parseInt(productId, 10),
      Quantity: quantity,
      Reason: reason,
      Notes: notes,
    };

    if (this.config.locationId) {
      update.LocationId = this.config.locationId;
    }

    await this.rateLimitedRequest(
      () => this.httpClient.post('/api/v4/Stock/Adjustment', update)
    );
  }

  async updateStockBatch(updates: StockUpdate[]): Promise<SyncResult> {
    await this.ensureAuthenticated();

    const errors: SyncError[] = [];
    let successCount = 0;

    // Process updates in parallel with rate limiting
    await Promise.all(
      updates.map(async (update) => {
        try {
          await this.updateStock(
            update.productId,
            update.quantity,
            'Adjustment',
            `Sync from ${update.source}`
          );
          successCount++;
        } catch (error) {
          errors.push({
            productId: update.productId,
            sku: update.sku,
            message: error instanceof Error ? error.message : 'Unknown error',
            code: error instanceof EposnowApiError ? error.code : 'UNKNOWN_ERROR',
          });
        }
      })
    );

    return {
      success: errors.length === 0,
      source: 'eposnow',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  async getStockLevel(productId: string, locationId?: number): Promise<number> {
    await this.ensureAuthenticated();

    const product = await this.getProduct(productId);
    if (!product) {
      throw new EposnowNotFoundError(`Product ${productId} not found`);
    }

    if (locationId && product.metadata?.locationStocks) {
      const locationStock = (product.metadata.locationStocks as Array<{ LocationId: number; StockLevel: number }>)
        .find((ls) => ls.LocationId === locationId);
      return locationStock?.StockLevel ?? 0;
    }

    return product.quantity;
  }

  // ============================================================================
  // Location Operations
  // ============================================================================

  async getLocations(): Promise<EposnowLocation[]> {
    await this.ensureAuthenticated();

    const response = await this.rateLimitedRequest<EposnowApiResponse<EposnowLocation[]>>(
      () => this.httpClient.get('/api/v4/Location')
    );

    return response.data;
  }

  async getLocation(locationId: number): Promise<EposnowLocation | null> {
    await this.ensureAuthenticated();

    try {
      const response = await this.rateLimitedRequest<EposnowLocation>(
        () => this.httpClient.get(`/api/v4/Location/${locationId}`)
      );
      return response;
    } catch (error) {
      if (error instanceof EposnowNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  async subscribeWebhook(
    url: string,
    events: EposnowWebhookEvent[],
    secretKey?: string
  ): Promise<number> {
    await this.ensureAuthenticated();

    const config: EposnowWebhookConfig = {
      Url: url,
      Events: events,
      IsActive: true,
      SecretKey: secretKey,
    };

    const response = await this.rateLimitedRequest<{ Id: number }>(
      () => this.httpClient.post('/api/v4/Webhook', config)
    );

    return response.Id;
  }

  async unsubscribeWebhook(webhookId: number): Promise<void> {
    await this.ensureAuthenticated();

    await this.rateLimitedRequest(
      () => this.httpClient.delete(`/api/v4/Webhook/${webhookId}`)
    );
  }

  async listWebhooks(): Promise<Array<EposnowWebhookConfig & { Id: number }>> {
    await this.ensureAuthenticated();

    const response = await this.rateLimitedRequest<EposnowApiResponse<Array<EposnowWebhookConfig & { Id: number }>>>(
      () => this.httpClient.get('/api/v4/Webhook')
    );

    return response.data;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();

      // Try to fetch a single product to verify API access
      await this.rateLimitedRequest(
        () => this.httpClient.get('/api/v4/Product', { params: { pageSize: 1 } })
      );

      return true;
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
            console.warn(`Eposnow API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { error?: { code?: string; message?: string } } | undefined;

    if (status === 404) {
      throw new EposnowNotFoundError(
        data?.error?.message || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new EposnowAuthError(
        data?.error?.message || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new EposnowRateLimitError(
        data?.error?.message || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new EposnowServerError(
        data?.error?.message || 'Server error'
      );
    }

    throw new EposnowApiError(
      data?.error?.message || error.message || 'Unknown API error',
      data?.error?.code || 'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class EposnowApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'EposnowApiError';
  }
}

export class EposnowNotFoundError extends EposnowApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'EposnowNotFoundError';
  }
}

export class EposnowAuthError extends EposnowApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'EposnowAuthError';
  }
}

export class EposnowRateLimitError extends EposnowApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'EposnowRateLimitError';
  }
}

export class EposnowServerError extends EposnowApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'EposnowServerError';
  }
}
