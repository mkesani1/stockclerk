/**
 * Otter API Client
 * Handles API authentication, calls, and data transformation for Deliveroo integration
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import type { Product, StockUpdate, SyncResult, SyncError } from '../types.js';
import type {
  OtterClientConfig,
  OtterMenu,
  OtterMenuItem,
  OtterCategory,
  OtterAvailabilityUpdate,
  OtterAvailabilityResponse,
  OtterStockUpdate as OtterStockUpdateType,
  OtterStockUpdateResponse,
  OtterStockLevel,
  OtterRestaurant,
  OtterApiResponse,
  OtterPaginatedResponse,
  OtterWebhookConfig,
  OtterWebhookEvent,
  OtterItemQuery,
  OtterPlatform,
} from './types.js';

// Rate limit: 50 requests per minute for Otter API
const RATE_LIMIT_REQUESTS = 50;
const RATE_LIMIT_INTERVAL_MS = 60000;

export class OtterApiClient {
  private readonly config: Required<Pick<OtterClientConfig, 'baseUrl' | 'timeout' | 'retryAttempts'>> & OtterClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: PQueue;
  private connected = false;

  constructor(config: OtterClientConfig) {
    this.config = {
      baseUrl: 'https://api.tryotter.com/v1',
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
        'X-API-Key': this.config.apiKey,
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
    // Validate API key by fetching restaurant info
    const isValid = await this.healthCheck();
    if (!isValid) {
      throw new OtterAuthError('Invalid API key or restaurant not accessible');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new OtterApiError('Not connected. Call connect() first.', 'NOT_CONNECTED');
    }
  }

  // ============================================================================
  // Restaurant Operations
  // ============================================================================

  async getRestaurant(): Promise<OtterRestaurant> {
    const response = await this.rateLimitedRequest<OtterApiResponse<OtterRestaurant>>(
      () => this.httpClient.get(`/restaurants/${this.config.restaurantId}`)
    );
    return response.data;
  }

  // ============================================================================
  // Menu Operations
  // ============================================================================

  async getMenu(platform?: OtterPlatform): Promise<OtterMenu> {
    this.ensureConnected();

    const params: Record<string, string> = {};
    if (platform) {
      params.platform = platform;
    }

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterMenu>>(
      () => this.httpClient.get(`/restaurants/${this.config.restaurantId}/menu`, { params })
    );

    return response.data;
  }

  async getMenuItems(query?: Omit<OtterItemQuery, 'restaurantId'>): Promise<OtterMenuItem[]> {
    this.ensureConnected();

    const items: OtterMenuItem[] = [];
    let offset = query?.offset || 0;
    const limit = query?.limit || 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<OtterPaginatedResponse<OtterMenuItem>>(
        () => this.httpClient.get(`/restaurants/${this.config.restaurantId}/items`, {
          params: {
            ...query,
            limit,
            offset,
          },
        })
      );

      items.push(...response.data);
      hasMore = response.pagination.hasMore;
      offset += limit;
    }

    return items;
  }

  async getMenuItem(itemId: string): Promise<OtterMenuItem | null> {
    this.ensureConnected();

    try {
      const response = await this.rateLimitedRequest<OtterApiResponse<OtterMenuItem>>(
        () => this.httpClient.get(`/restaurants/${this.config.restaurantId}/items/${itemId}`)
      );
      return response.data;
    } catch (error) {
      if (error instanceof OtterNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // Product Operations (Unified Interface)
  // ============================================================================

  async getProducts(): Promise<Product[]> {
    const items = await this.getMenuItems();
    return items.map((item) => this.transformMenuItem(item));
  }

  async getProduct(id: string): Promise<Product | null> {
    const item = await this.getMenuItem(id);
    if (!item) {
      return null;
    }
    return this.transformMenuItem(item);
  }

  private transformMenuItem(item: OtterMenuItem): Product {
    const quantity = item.trackInventory
      ? item.stockQuantity ?? 0
      : item.isAvailable ? -1 : 0; // -1 indicates unlimited/not tracked

    return {
      id: item.id,
      sku: item.sku || `OTTER-${item.id}`,
      name: item.name,
      price: item.price.amount,
      quantity,
      lastUpdated: new Date(item.updatedAt),
      metadata: {
        source: 'otter',
        categoryId: item.categoryId,
        description: item.description,
        imageUrl: item.imageUrl,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        availabilityStatus: item.availabilityStatus,
        trackInventory: item.trackInventory,
        currency: item.price.currency,
        allergens: item.allergens,
        dietaryLabels: item.dietaryLabels,
        modifierGroups: item.modifierGroups?.map((mg) => ({
          id: mg.id,
          name: mg.name,
          modifiers: mg.modifiers.map((m) => ({
            id: m.id,
            name: m.name,
            price: m.price.amount,
            isAvailable: m.isAvailable,
          })),
        })),
      },
    };
  }

  // ============================================================================
  // Availability Operations
  // ============================================================================

  async updateItemAvailability(
    itemId: string,
    isAvailable: boolean,
    options?: {
      reason?: OtterAvailabilityUpdate['reason'];
      unavailableUntil?: string;
      platforms?: OtterPlatform[];
    }
  ): Promise<OtterAvailabilityResponse> {
    this.ensureConnected();

    const update: OtterAvailabilityUpdate = {
      itemId,
      isAvailable,
      reason: options?.reason,
      unavailableUntil: options?.unavailableUntil,
      platforms: options?.platforms,
    };

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterAvailabilityResponse>>(
      () => this.httpClient.put(
        `/restaurants/${this.config.restaurantId}/items/${itemId}/availability`,
        update
      )
    );

    return response.data;
  }

  async bulkUpdateAvailability(
    updates: OtterAvailabilityUpdate[]
  ): Promise<OtterAvailabilityResponse[]> {
    this.ensureConnected();

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterAvailabilityResponse[]>>(
      () => this.httpClient.put(
        `/restaurants/${this.config.restaurantId}/items/availability/bulk`,
        { items: updates }
      )
    );

    return response.data;
  }

  // ============================================================================
  // Stock/Inventory Operations
  // ============================================================================

  async getStockLevel(itemId: string): Promise<OtterStockLevel | null> {
    this.ensureConnected();

    try {
      const response = await this.rateLimitedRequest<OtterApiResponse<OtterStockLevel>>(
        () => this.httpClient.get(
          `/restaurants/${this.config.restaurantId}/items/${itemId}/stock`
        )
      );
      return response.data;
    } catch (error) {
      if (error instanceof OtterNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getStockLevels(): Promise<OtterStockLevel[]> {
    this.ensureConnected();

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterStockLevel[]>>(
      () => this.httpClient.get(
        `/restaurants/${this.config.restaurantId}/stock`
      )
    );

    return response.data;
  }

  async updateStockLevel(
    itemId: string,
    quantity: number,
    operation: 'set' | 'increment' | 'decrement' = 'set',
    reason?: string
  ): Promise<OtterStockUpdateResponse> {
    this.ensureConnected();

    const update: OtterStockUpdateType = {
      itemId,
      quantity,
      operation,
      reason,
    };

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterStockUpdateResponse>>(
      () => this.httpClient.put(
        `/restaurants/${this.config.restaurantId}/items/${itemId}/stock`,
        update
      )
    );

    return response.data;
  }

  async bulkUpdateStock(
    updates: OtterStockUpdateType[]
  ): Promise<OtterStockUpdateResponse[]> {
    this.ensureConnected();

    const response = await this.rateLimitedRequest<OtterApiResponse<OtterStockUpdateResponse[]>>(
      () => this.httpClient.put(
        `/restaurants/${this.config.restaurantId}/stock/bulk`,
        { items: updates }
      )
    );

    return response.data;
  }

  async updateStock(updates: StockUpdate[]): Promise<SyncResult> {
    this.ensureConnected();

    const errors: SyncError[] = [];
    let successCount = 0;

    // Convert to Otter format
    const otterUpdates: OtterStockUpdateType[] = updates.map((u) => ({
      itemId: u.productId,
      quantity: u.quantity,
      operation: 'set' as const,
      reason: `Sync from ${u.source}`,
    }));

    try {
      const results = await this.bulkUpdateStock(otterUpdates);

      for (const result of results) {
        if (result.success) {
          successCount++;
        } else {
          errors.push({
            productId: result.itemId,
            message: result.error || 'Unknown error',
            code: 'UPDATE_FAILED',
          });
        }
      }
    } catch (error) {
      // If bulk update fails, try individual updates
      for (const update of updates) {
        try {
          await this.updateStockLevel(update.productId, update.quantity);
          successCount++;
        } catch (err) {
          errors.push({
            productId: update.productId,
            sku: update.sku,
            message: err instanceof Error ? err.message : 'Unknown error',
            code: err instanceof OtterApiError ? err.code : 'UNKNOWN_ERROR',
          });
        }
      }
    }

    return {
      success: errors.length === 0,
      source: 'otter',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  async subscribeWebhook(
    url: string,
    events: OtterWebhookEvent[],
    secret?: string
  ): Promise<string> {
    const config: OtterWebhookConfig = {
      url,
      events,
      secret,
      isActive: true,
    };

    const response = await this.rateLimitedRequest<OtterApiResponse<{ id: string }>>(
      () => this.httpClient.post(
        `/restaurants/${this.config.restaurantId}/webhooks`,
        config
      )
    );

    return response.data.id;
  }

  async unsubscribeWebhook(webhookId: string): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.delete(
        `/restaurants/${this.config.restaurantId}/webhooks/${webhookId}`
      )
    );
  }

  async listWebhooks(): Promise<OtterWebhookConfig[]> {
    const response = await this.rateLimitedRequest<OtterApiResponse<OtterWebhookConfig[]>>(
      () => this.httpClient.get(
        `/restaurants/${this.config.restaurantId}/webhooks`
      )
    );

    return response.data;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.rateLimitedRequest(
        () => this.httpClient.get(`/restaurants/${this.config.restaurantId}`)
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
            console.warn(`Otter API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { error?: { code?: string; message?: string } } | undefined;

    if (status === 404) {
      throw new OtterNotFoundError(
        data?.error?.message || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new OtterAuthError(
        data?.error?.message || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new OtterRateLimitError(
        data?.error?.message || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new OtterServerError(
        data?.error?.message || 'Server error'
      );
    }

    throw new OtterApiError(
      data?.error?.message || error.message || 'Unknown API error',
      data?.error?.code || 'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class OtterApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'OtterApiError';
  }
}

export class OtterNotFoundError extends OtterApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'OtterNotFoundError';
  }
}

export class OtterAuthError extends OtterApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'OtterAuthError';
  }
}

export class OtterRateLimitError extends OtterApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'OtterRateLimitError';
  }
}

export class OtterServerError extends OtterApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'OtterServerError';
  }
}
