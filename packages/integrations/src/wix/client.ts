/**
 * Wix API Client
 * Handles OAuth2 authentication, API calls, and data transformation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import type { Product, StockUpdate, SyncResult, SyncError } from '../types.js';
import type {
  WixClientConfig,
  WixOAuthTokens,
  WixOAuthState,
  WixProduct,
  WixProductQuery,
  WixPaginatedResponse,
  WixInventoryItem,
  WixInventoryUpdateRequest,
  WixInventoryBulkUpdate,
  WixWebhookConfig,
  WixWebhookEventType,
  WixBasicOAuthConfig,
  WixCatalogVersion,
} from './types.js';

// Rate limit: 100 requests per minute for Wix API
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_INTERVAL_MS = 60000;

// Wix API base URLs
const WIX_OAUTH_URL = 'https://www.wixapis.com/oauth';
const WIX_API_BASE_URL = 'https://www.wixapis.com';

export class WixApiClient {
  private readonly config: Required<Pick<WixClientConfig, 'timeout' | 'retryAttempts'>> & WixClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: PQueue;
  private oauthState: WixOAuthState | null = null;
  private connected = false;

  constructor(config: WixClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    this.httpClient = axios.create({
      baseURL: WIX_API_BASE_URL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Setup request interceptor for auth token
    this.httpClient.interceptors.request.use(async (config) => {
      await this.ensureAuthenticated();
      if (this.oauthState?.accessToken) {
        config.headers.Authorization = this.oauthState.accessToken;
      }
      return config;
    });

    // Setup response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => this.handleApiError(error)
    );

    this.rateLimiter = createRateLimiter({
      concurrency: 10,
      intervalMs: RATE_LIMIT_INTERVAL_MS,
      maxPerInterval: RATE_LIMIT_REQUESTS,
    });

    // Initialize OAuth state if tokens provided
    if (this.config.accessToken && this.config.refreshToken && this.config.instanceId) {
      this.oauthState = {
        accessToken: this.config.accessToken,
        refreshToken: this.config.refreshToken,
        expiresAt: new Date(Date.now() + 3600 * 1000), // Assume 1 hour expiry
        instanceId: this.config.instanceId,
        siteId: this.config.siteId,
      };
    }
  }

  // ============================================================================
  // OAuth Flow
  // ============================================================================

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'wix.stores.inventory.read wix.stores.inventory.update wix.stores.products.read',
    });

    if (state) {
      params.set('state', state);
    }

    return `${WIX_OAUTH_URL}/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string
  ): Promise<WixOAuthState> {
    const response = await axios.post<WixOAuthTokens>(
      `${WIX_OAUTH_URL}/access`,
      {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }
    );

    const tokens = response.data;
    const instanceId = this.extractInstanceId(tokens.access_token);

    this.oauthState = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      instanceId,
    };

    this.connected = true;
    return this.oauthState;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.oauthState?.refreshToken) {
      throw new WixAuthError('No refresh token available');
    }

    const response = await axios.post<WixOAuthTokens>(
      `${WIX_OAUTH_URL}/access`,
      {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.oauthState.refreshToken,
      }
    );

    const tokens = response.data;

    this.oauthState = {
      ...this.oauthState,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || this.oauthState.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };
  }

  /**
   * Authenticate using Basic OAuth (recommended by Wix)
   * Uses app_id + app_secret + instanceId to get an access token
   * No redirects required - simpler than Advanced OAuth
   */
  async authenticateBasic(config: WixBasicOAuthConfig): Promise<WixOAuthState> {
    const response = await axios.post<WixOAuthTokens>(
      `${WIX_OAUTH_URL}/access`,
      {
        grant_type: 'client_credentials',
        client_id: config.appId,
        client_secret: config.appSecret,
        instance_id: config.instanceId,
      }
    );

    const tokens = response.data;

    this.oauthState = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      expiresAt: new Date(Date.now() + (tokens.expires_in || 14400) * 1000), // Default 4 hours
      instanceId: config.instanceId,
    };

    this.connected = true;
    return this.oauthState;
  }

  private extractInstanceId(accessToken: string): string {
    // Wix access tokens contain instance ID in the payload
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload.instanceId || payload.instance_id || '';
      }
    } catch {
      // Token parsing failed
    }
    return this.config.instanceId || '';
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    // Try Basic OAuth if configured (recommended by Wix)
    if (this.config.authMode === 'basic' && this.config.instanceId && this.config.clientId && this.config.clientSecret) {
      await this.authenticateBasic({
        appId: this.config.clientId,
        appSecret: this.config.clientSecret,
        instanceId: this.config.instanceId,
      });
      return;
    }

    if (this.oauthState?.accessToken) {
      // Verify token is valid
      try {
        await this.healthCheck();
        this.connected = true;
        return;
      } catch {
        // Token invalid, try refresh
        if (this.oauthState.refreshToken) {
          await this.refreshAccessToken();
          this.connected = true;
          return;
        }
      }
    }

    throw new WixAuthError('No valid credentials provided. Use exchangeCodeForTokens() or authenticateBasic() first.');
  }

  async disconnect(): Promise<void> {
    this.oauthState = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.oauthState !== null && !this.isTokenExpired();
  }

  private isTokenExpired(): boolean {
    if (!this.oauthState?.expiresAt) return true;
    // Consider token expired 5 minutes before actual expiry
    return new Date() >= new Date(this.oauthState.expiresAt.getTime() - 5 * 60 * 1000);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.oauthState) {
      throw new WixAuthError('Not authenticated');
    }

    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  getOAuthState(): WixOAuthState | null {
    return this.oauthState;
  }

  // ============================================================================
  // Product Operations
  // ============================================================================

  async getProducts(query?: WixProductQuery): Promise<Product[]> {
    const wixProducts = await this.fetchAllProducts(query);
    return wixProducts.map((p) => this.transformProduct(p));
  }

  async getProduct(id: string): Promise<Product | null> {
    try {
      const response = await this.rateLimitedRequest<{ product: WixProduct }>(
        () => this.httpClient.get(`/stores/v1/products/${id}`)
      );
      return this.transformProduct(response.product);
    } catch (error) {
      if (error instanceof WixNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async fetchAllProducts(query?: WixProductQuery): Promise<WixProduct[]> {
    const products: WixProduct[] = [];
    let offset = query?.offset || 0;
    const limit = query?.limit || 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<WixPaginatedResponse<WixProduct>>(
        () => this.httpClient.post('/stores/v1/products/query', {
          query: {
            paging: { limit, offset },
          },
          includeVariants: query?.includeVariants ?? true,
          includeHiddenProducts: query?.includeHiddenProducts ?? false,
        })
      );

      products.push(...response.items);
      hasMore = response.metadata.hasNext;
      offset += limit;
    }

    return products;
  }

  private transformProduct(wixProduct: WixProduct): Product {
    const quantity = wixProduct.stock.trackInventory
      ? wixProduct.stock.quantity ?? 0
      : -1; // -1 indicates unlimited/not tracked

    return {
      id: wixProduct.id,
      sku: wixProduct.sku || `WIX-${wixProduct.id}`,
      name: wixProduct.name,
      price: wixProduct.price.price,
      quantity,
      lastUpdated: new Date(wixProduct.lastUpdated),
      metadata: {
        source: 'wix',
        slug: wixProduct.slug,
        visible: wixProduct.visible,
        productType: wixProduct.productType,
        currency: wixProduct.price.currency,
        inStock: wixProduct.stock.inStock,
        inventoryStatus: wixProduct.stock.inventoryStatus,
        trackInventory: wixProduct.stock.trackInventory,
        variants: wixProduct.variants?.map((v) => ({
          id: v.id,
          sku: v.variant.sku,
          choices: v.choices,
          quantity: v.stock.quantity,
          inStock: v.stock.inStock,
        })),
        collectionIds: wixProduct.collectionIds,
      },
    };
  }

  // ============================================================================
  // Inventory Operations
  // ============================================================================

  async getInventory(): Promise<WixInventoryItem[]> {
    const items: WixInventoryItem[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<WixPaginatedResponse<WixInventoryItem>>(
        () => this.httpClient.post('/stores/v1/inventoryItems/query', {
          query: {
            paging: { limit, offset },
          },
        })
      );

      items.push(...response.items);
      hasMore = response.metadata.hasNext;
      offset += limit;
    }

    return items;
  }

  async getInventoryItem(inventoryItemId: string): Promise<WixInventoryItem | null> {
    try {
      const response = await this.rateLimitedRequest<{ inventoryItem: WixInventoryItem }>(
        () => this.httpClient.get(`/stores/v1/inventoryItems/${inventoryItemId}`)
      );
      return response.inventoryItem;
    } catch (error) {
      if (error instanceof WixNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async updateInventory(
    inventoryItemId: string,
    variantId: string,
    update: WixInventoryUpdateRequest
  ): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.post(
        `/stores/v1/inventoryItems/${inventoryItemId}/updateInventoryVariants`,
        {
          inventoryItem: {
            variants: [{
              variantId,
              ...update,
            }],
          },
        }
      )
    );
  }

  async updateInventoryByProductId(
    productId: string,
    variantId: string,
    quantity: number
  ): Promise<void> {
    // First, get the inventory item ID for the product
    const response = await this.rateLimitedRequest<WixPaginatedResponse<WixInventoryItem>>(
      () => this.httpClient.post('/stores/v1/inventoryItems/query', {
        query: {
          filter: JSON.stringify({ productId }),
          paging: { limit: 1 },
        },
      })
    );

    if (!response.items.length) {
      throw new WixNotFoundError(`Inventory item for product ${productId} not found`);
    }

    await this.updateInventory(response.items[0].id, variantId, { setQuantity: quantity });
  }

  async bulkUpdateInventory(updates: WixInventoryBulkUpdate[]): Promise<SyncResult> {
    const errors: SyncError[] = [];
    let successCount = 0;

    // Group updates by inventory item
    const updatesByProduct = new Map<string, WixInventoryBulkUpdate[]>();

    for (const update of updates) {
      if (update.productId) {
        const existing = updatesByProduct.get(update.productId) || [];
        existing.push(update);
        updatesByProduct.set(update.productId, existing);
      }
    }

    // Process updates
    await Promise.all(
      Array.from(updatesByProduct.entries()).map(async ([productId, productUpdates]) => {
        try {
          for (const update of productUpdates) {
            await this.updateInventoryByProductId(
              productId,
              update.variantId,
              update.setQuantity ?? 0
            );
            successCount++;
          }
        } catch (error) {
          errors.push({
            productId,
            message: error instanceof Error ? error.message : 'Unknown error',
            code: error instanceof WixApiError ? error.code : 'UNKNOWN_ERROR',
          });
        }
      })
    );

    return {
      success: errors.length === 0,
      source: 'wix',
      productsUpdated: successCount,
      errors,
      timestamp: new Date(),
    };
  }

  async updateStock(updates: StockUpdate[]): Promise<SyncResult> {
    const wixUpdates: WixInventoryBulkUpdate[] = updates.map((u) => ({
      productId: u.productId,
      variantId: 'default', // Use default variant if not specified
      setQuantity: u.quantity,
    }));

    return this.bulkUpdateInventory(wixUpdates);
  }

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  async subscribeWebhook(
    uri: string,
    eventType: WixWebhookEventType
  ): Promise<string> {
    const response = await this.rateLimitedRequest<{ webhook: WixWebhookConfig }>(
      () => this.httpClient.post('/apps/v1/webhooks', {
        webhook: {
          uri,
          eventType,
          status: 'ACTIVE',
        },
      })
    );

    return response.webhook.id || '';
  }

  async unsubscribeWebhook(webhookId: string): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.delete(`/apps/v1/webhooks/${webhookId}`)
    );
  }

  async listWebhooks(): Promise<WixWebhookConfig[]> {
    const response = await this.rateLimitedRequest<{ webhooks: WixWebhookConfig[] }>(
      () => this.httpClient.get('/apps/v1/webhooks')
    );

    return response.webhooks;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      // Try to query products with limit 1 to verify API access
      await this.rateLimitedRequest(
        () => this.httpClient.post('/stores/v1/products/query', {
          query: {
            paging: { limit: 1 },
          },
        })
      );

      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Catalog Version Detection
  // ============================================================================

  /**
   * Detect whether a Wix store uses Catalog V1 or V3
   * MUST be called before using inventory APIs to ensure correct endpoint usage
   */
  async getCatalogVersion(): Promise<WixCatalogVersion> {
    try {
      const response = await this.rateLimitedRequest<{ catalogVersion: string }>(
        () => this.httpClient.get('/stores/v1/catalog/version')
      );
      return response.catalogVersion === 'V3' ? 'V3' : 'V1';
    } catch {
      // Default to V1 for backwards compatibility if version check fails
      return 'V1';
    }
  }

  // ============================================================================
  // V3 Inventory Operations (for stores on Catalog V3)
  // ============================================================================

  /**
   * Get inventory items using V3 API
   * Use getCatalogVersion() first to determine which API to call
   */
  async getInventoryV3(): Promise<WixInventoryItem[]> {
    const items: WixInventoryItem[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.rateLimitedRequest<WixPaginatedResponse<WixInventoryItem>>(
        () => this.httpClient.post('/stores/v3/inventoryItems/query', {
          query: {
            paging: { limit, offset },
          },
        })
      );

      items.push(...response.items);
      hasMore = response.metadata.hasNext;
      offset += limit;
    }

    return items;
  }

  /**
   * Update inventory using V3 API
   */
  async updateInventoryV3(
    inventoryItemId: string,
    variantId: string,
    update: WixInventoryUpdateRequest
  ): Promise<void> {
    await this.rateLimitedRequest(
      () => this.httpClient.post(
        `/stores/v3/inventoryItems/${inventoryItemId}/updateInventoryVariants`,
        {
          inventoryItem: {
            variants: [{
              variantId,
              ...update,
            }],
          },
        }
      )
    );
  }

  /**
   * Smart inventory getter - auto-detects catalog version and uses correct API
   */
  async getInventoryAuto(): Promise<{ version: WixCatalogVersion; items: WixInventoryItem[] }> {
    const version = await this.getCatalogVersion();
    const items = version === 'V3' ? await this.getInventoryV3() : await this.getInventory();
    return { version, items };
  }

  /**
   * Smart inventory updater - auto-detects catalog version and uses correct API
   */
  async updateInventoryAuto(
    inventoryItemId: string,
    variantId: string,
    update: WixInventoryUpdateRequest
  ): Promise<void> {
    const version = await this.getCatalogVersion();
    if (version === 'V3') {
      await this.updateInventoryV3(inventoryItemId, variantId, update);
    } else {
      await this.updateInventory(inventoryItemId, variantId, update);
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
            console.warn(`Wix API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; details?: { applicationError?: { code?: string } } } | undefined;

    if (status === 404) {
      throw new WixNotFoundError(
        data?.message || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new WixAuthError(
        data?.message || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new WixRateLimitError(
        data?.message || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new WixServerError(
        data?.message || 'Server error'
      );
    }

    throw new WixApiError(
      data?.message || error.message || 'Unknown API error',
      data?.details?.applicationError?.code || 'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class WixApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'WixApiError';
  }
}

export class WixNotFoundError extends WixApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'WixNotFoundError';
  }
}

export class WixAuthError extends WixApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'WixAuthError';
  }
}

export class WixRateLimitError extends WixApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'WixRateLimitError';
  }
}

export class WixServerError extends WixApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'WixServerError';
  }
}
