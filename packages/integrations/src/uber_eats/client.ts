/**
 * Uber Eats API Client
 * Handles OAuth2 authentication, API calls, and data transformation for Uber Eats
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import type {
  UberEatsClientConfig,
  UberEatsTokenResponse,
  UberEatsStore,
  UberEatsMenu,
  UberEatsMenuItem,
  UberEatsAvailabilityUpdate,
  UberEatsOrder,
} from './types.js';

// Rate limit: 30 requests per minute for Uber Eats API
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_INTERVAL_MS = 60000;

// Token expiry buffer (refresh 5 minutes before actual expiry)
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class UberEatsApiClient {
  private readonly config: Required<Pick<UberEatsClientConfig, 'timeout' | 'retryAttempts'>> & UberEatsClientConfig;
  private readonly httpClient: AxiosInstance;
  private readonly rateLimiter: PQueue;
  private connected = false;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(config: UberEatsClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    this.httpClient = axios.create({
      baseURL: 'https://api.uber.com/v1',
      timeout: this.config.timeout,
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

  async authenticate(): Promise<void> {
    try {
      const token = await this.getAccessToken();
      this.accessToken = token;
      this.connected = true;
    } catch (error) {
      throw new UberEatsAuthError('Failed to authenticate with Uber Eats');
    }
  }

  async connect(): Promise<void> {
    // Verify store access by fetching store info
    const store = await this.getStore(this.config.storeId);
    if (!store) {
      throw new UberEatsAuthError('Unable to access store with provided credentials');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new UberEatsApiError('Not connected. Call connect() first.', 'NOT_CONNECTED');
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken || !this.tokenExpiresAt || Date.now() >= this.tokenExpiresAt) {
      const token = await this.getAccessToken();
      this.accessToken = token;
    }
  }

  // ============================================================================
  // OAuth2 Authentication
  // ============================================================================

  private async getAccessToken(): Promise<string> {
    try {
      const response = await axios.post<UberEatsTokenResponse>(
        'https://login.uber.com/oauth/v2/token',
        {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'client_credentials',
          scope: 'eats.store',
        },
        {
          timeout: this.config.timeout,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data;
      // Set expiry time with buffer (tokens typically valid for 30 days)
      this.tokenExpiresAt = Date.now() + (expires_in * 1000) - TOKEN_EXPIRY_BUFFER_MS;

      return access_token;
    } catch (error) {
      throw new UberEatsAuthError('Failed to obtain access token');
    }
  }

  // ============================================================================
  // Store Operations
  // ============================================================================

  async getStore(storeId: string): Promise<UberEatsStore | null> {
    this.ensureConnected();
    await this.ensureValidToken();

    try {
      const response = await this.rateLimitedRequest<{ data: UberEatsStore }>(
        () => this.httpClient.get(`/eats/stores/${storeId}`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
      );

      return response.data || null;
    } catch (error) {
      if (error instanceof UberEatsNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // Menu Operations
  // ============================================================================

  async getMenu(storeId: string): Promise<UberEatsMenu> {
    this.ensureConnected();
    await this.ensureValidToken();

    const response = await this.rateLimitedRequest<UberEatsMenu>(
      () => this.httpClient.get(`/eats/stores/${storeId}/menus`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })
    );

    return response;
  }

  async getMenuItems(storeId: string): Promise<UberEatsMenuItem[]> {
    this.ensureConnected();
    await this.ensureValidToken();

    const menu = await this.getMenu(storeId);
    const items: UberEatsMenuItem[] = [];

    for (const menuSection of menu.menus) {
      for (const category of menuSection.categories) {
        items.push(...category.items);
      }
    }

    return items;
  }

  // ============================================================================
  // Availability Operations
  // ============================================================================

  async updateItemAvailability(
    storeId: string,
    itemId: string,
    available: boolean
  ): Promise<void> {
    this.ensureConnected();
    await this.ensureValidToken();

    const update: UberEatsAvailabilityUpdate = {
      item_id: itemId,
      available,
    };

    await this.rateLimitedRequest(
      () => this.httpClient.patch(
        `/eats/stores/${storeId}/items/${itemId}/availability`,
        update,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      )
    );
  }

  async batchUpdateAvailability(
    storeId: string,
    updates: Array<{ itemId: string; available: boolean }>
  ): Promise<void> {
    this.ensureConnected();
    await this.ensureValidToken();

    const payload = {
      updates: updates.map((u) => ({
        item_id: u.itemId,
        available: u.available,
      })),
    };

    await this.rateLimitedRequest(
      () => this.httpClient.patch(
        `/eats/stores/${storeId}/items/availability`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      )
    );
  }

  // ============================================================================
  // Order Operations
  // ============================================================================

  async getOrder(orderId: string): Promise<UberEatsOrder | null> {
    this.ensureConnected();
    await this.ensureValidToken();

    try {
      const response = await this.rateLimitedRequest<{ data: UberEatsOrder }>(
        () => this.httpClient.get(`/eats/orders/${orderId}`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
      );

      return response.data || null;
    } catch (error) {
      if (error instanceof UberEatsNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureValidToken();
      const store = await this.getStore(this.config.storeId);
      return store !== null;
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
            console.warn(`Uber Eats API retry attempt ${attempt}:`, error.message);
          },
        }
      );
    }) as Promise<T>;
  }

  private handleApiError(error: AxiosError): never {
    const status = error.response?.status;
    const data = error.response?.data as { error?: string; error_description?: string } | undefined;

    if (status === 404) {
      throw new UberEatsNotFoundError(
        data?.error_description || 'Resource not found'
      );
    }

    if (status === 401 || status === 403) {
      throw new UberEatsAuthError(
        data?.error_description || 'Authentication failed'
      );
    }

    if (status === 429) {
      throw new UberEatsRateLimitError(
        data?.error_description || 'Rate limit exceeded'
      );
    }

    if (status && status >= 500) {
      throw new UberEatsServerError(
        data?.error_description || 'Server error'
      );
    }

    throw new UberEatsApiError(
      data?.error_description || error.message || 'Unknown API error',
      data?.error || 'UNKNOWN_ERROR',
      status
    );
  }
}

// ============================================================================
// Custom Error Classes
// ============================================================================

export class UberEatsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'UberEatsApiError';
  }
}

export class UberEatsNotFoundError extends UberEatsApiError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'UberEatsNotFoundError';
  }
}

export class UberEatsAuthError extends UberEatsApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'UberEatsAuthError';
  }
}

export class UberEatsRateLimitError extends UberEatsApiError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'UberEatsRateLimitError';
  }
}

export class UberEatsServerError extends UberEatsApiError {
  constructor(message: string) {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'UberEatsServerError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createUberEatsClient(config: UberEatsClientConfig): UberEatsApiClient {
  return new UberEatsApiClient(config);
}
