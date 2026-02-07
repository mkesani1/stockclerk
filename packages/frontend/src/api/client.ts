/**
 * API Client for StockSync Hub Frontend
 * Axios-based client with JWT token interceptor and error handling
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import type {
  Product,
  Channel,
  Alert,
  SyncEvent,
  User,
  Tenant,
  ChannelType,
  AlertType,
} from '@/types';

// ============================================================================
// Configuration
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const WS_BASE_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}`;

// ============================================================================
// Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  name?: string;
}

// Backend user shape (differs from frontend User type)
export interface BackendSafeUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
  onboardingComplete: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
}

export interface AuthResponse {
  user: BackendSafeUser;
  tenant: Tenant;
  tokens: {
    accessToken: string;
    expiresIn: number;
  };
}

export interface CreateProductData {
  sku: string;
  name: string;
  currentStock?: number;
  bufferStock?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateProductData {
  sku?: string;
  name?: string;
  currentStock?: number;
  bufferStock?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateChannelData {
  type: ChannelType;
  name: string;
  credentials?: Record<string, unknown>;
}

export interface UpdateChannelData {
  name?: string;
  credentials?: Record<string, unknown>;
  isActive?: boolean;
}

export interface CreateMappingData {
  productId: string;
  channelId: string;
  externalId: string;
  externalSku?: string;
}

export interface DashboardStats {
  totalProducts: number;
  totalChannels: number;
  activeAlerts: number;
  recentSyncs: number;
  stockHealth: {
    healthy: number;
    low: number;
    outOfStock: number;
  };
  channelStatus: {
    connected: number;
    disconnected: number;
    syncing: number;
  };
  syncActivity: {
    last24h: number;
    successful: number;
    failed: number;
  };
}

export interface AgentStatus {
  name: string;
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  lastActivity: string | null;
  processedCount: number;
  errorCount: number;
  error?: string;
}

export interface EngineStatus {
  state: string;
  startedAt: string | null;
  uptime: number;
  agents: {
    watcher: AgentStatus;
    sync: AgentStatus;
    guardian: AgentStatus;
    alert: AgentStatus;
  };
  stats: {
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    productsUpdated: number;
    alertsCreated: number;
    driftsDetected: number;
    driftsRepaired: number;
  };
}

// ============================================================================
// Token Storage
// ============================================================================

const TOKEN_KEY = 'stocksync_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ============================================================================
// Axios Instance
// ============================================================================

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse>) => {
    if (error.response) {
      const { status, data } = error.response;

      // Handle 401 Unauthorized
      if (status === 401) {
        clearStoredToken();
        // Redirect to login if not already there
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }

      // Create a more informative error
      const message = data?.error || data?.message || 'An error occurred';
      const enhancedError = new Error(message);
      (enhancedError as any).status = status;
      (enhancedError as any).data = data;
      return Promise.reject(enhancedError);
    }

    // Network error
    if (error.request) {
      const networkError = new Error('Network error. Please check your connection.');
      (networkError as any).isNetworkError = true;
      return Promise.reject(networkError);
    }

    return Promise.reject(error);
  }
);

// ============================================================================
// Auth API
// ============================================================================

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
    if (response.data.data) {
      setStoredToken(response.data.data.tokens.accessToken);
    }
    return response.data.data!;
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiClient.post<ApiResponse<AuthResponse>>('/auth/register', data);
    if (response.data.data) {
      setStoredToken(response.data.data.tokens.accessToken);
    }
    return response.data.data!;
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      clearStoredToken();
    }
  },

  async getProfile(): Promise<{ user: User; tenant: Tenant }> {
    const response = await apiClient.get<ApiResponse<{ user: User; tenant: Tenant }>>('/auth/me');
    return response.data.data!;
  },

  async refreshToken(): Promise<{ accessToken: string }> {
    const response = await apiClient.post<ApiResponse<{ accessToken: string }>>('/auth/refresh');
    if (response.data.data) {
      setStoredToken(response.data.data.accessToken);
    }
    return response.data.data!;
  },

  async completeOnboarding(): Promise<void> {
    await apiClient.patch<ApiResponse<{ onboardingComplete: boolean }>>('/auth/onboarding-complete');
  },
};

// ============================================================================
// Products API
// ============================================================================

export const productsApi = {
  async list(params?: { page?: number; limit?: number; search?: string }): Promise<PaginatedResponse<Product>> {
    const response = await apiClient.get<PaginatedResponse<Product>>('/products', { params });
    return response.data;
  },

  async get(id: string): Promise<Product> {
    const response = await apiClient.get<ApiResponse<Product>>(`/products/${id}`);
    return response.data.data!;
  },

  async create(data: CreateProductData): Promise<Product> {
    const response = await apiClient.post<ApiResponse<Product>>('/products', data);
    return response.data.data!;
  },

  async update(id: string, data: UpdateProductData): Promise<Product> {
    const response = await apiClient.patch<ApiResponse<Product>>(`/products/${id}`, data);
    return response.data.data!;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/products/${id}`);
  },

  async updateStock(id: string, currentStock: number, reason?: string): Promise<Product> {
    const response = await apiClient.patch<ApiResponse<Product>>(`/products/${id}/stock`, {
      currentStock,
      reason,
    });
    return response.data.data!;
  },

  async getMappings(id: string): Promise<any[]> {
    const response = await apiClient.get<ApiResponse<any[]>>(`/products/${id}/mappings`);
    return response.data.data!;
  },

  async addMapping(data: CreateMappingData): Promise<any> {
    const response = await apiClient.post<ApiResponse<any>>('/products/mappings', data);
    return response.data.data!;
  },

  async removeMapping(mappingId: string): Promise<void> {
    await apiClient.delete(`/products/mappings/${mappingId}`);
  },
};

// ============================================================================
// Channels API
// ============================================================================

export const channelsApi = {
  async list(): Promise<Channel[]> {
    const response = await apiClient.get<ApiResponse<Channel[]>>('/channels');
    return response.data.data!;
  },

  async get(id: string): Promise<Channel> {
    const response = await apiClient.get<ApiResponse<Channel>>(`/channels/${id}`);
    return response.data.data!;
  },

  async create(data: CreateChannelData): Promise<Channel> {
    const response = await apiClient.post<ApiResponse<Channel>>('/channels', data);
    return response.data.data!;
  },

  /**
   * Start Wix OAuth flow - returns authorization URL
   */
  async startWixOAuth(): Promise<{ authUrl: string; state: string }> {
    const response = await apiClient.get<ApiResponse<{ authUrl: string; state: string }>>(
      '/channels/wix/oauth-start'
    );
    return response.data.data!;
  },

  async update(id: string, data: UpdateChannelData): Promise<Channel> {
    const response = await apiClient.patch<ApiResponse<Channel>>(`/channels/${id}`, data);
    return response.data.data!;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/channels/${id}`);
  },

  async testConnection(id: string): Promise<{ connected: boolean; message?: string }> {
    const response = await apiClient.post<ApiResponse<{ connected: boolean; message?: string }>>(
      `/channels/${id}/test`
    );
    return response.data.data!;
  },

  async sync(id: string): Promise<{ jobId: string }> {
    const response = await apiClient.post<ApiResponse<{ jobId: string }>>(`/channels/${id}/sync`);
    return response.data.data!;
  },
};

// ============================================================================
// Alerts API
// ============================================================================

export const alertsApi = {
  async list(params?: { page?: number; limit?: number; unreadOnly?: boolean }): Promise<PaginatedResponse<Alert>> {
    const response = await apiClient.get<PaginatedResponse<Alert>>('/alerts', { params });
    return response.data;
  },

  async get(id: string): Promise<Alert> {
    const response = await apiClient.get<ApiResponse<Alert>>(`/alerts/${id}`);
    return response.data.data!;
  },

  async markRead(id: string): Promise<Alert> {
    const response = await apiClient.patch<ApiResponse<Alert>>(`/alerts/${id}`, { isRead: true });
    return response.data.data!;
  },

  async markAllRead(): Promise<void> {
    await apiClient.post('/alerts/mark-all-read');
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/alerts/${id}`);
  },

  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<ApiResponse<{ count: number }>>('/alerts/unread-count');
    return response.data.data?.count ?? 0;
  },
};

// ============================================================================
// Sync API
// ============================================================================

export const syncApi = {
  async getEvents(params?: { page?: number; limit?: number; channelId?: string }): Promise<PaginatedResponse<SyncEvent>> {
    const response = await apiClient.get<PaginatedResponse<SyncEvent>>('/sync/events', { params });
    return response.data;
  },

  async triggerFullSync(): Promise<{ jobId: string }> {
    const response = await apiClient.post<ApiResponse<{ jobId: string }>>('/sync/full');
    return response.data.data!;
  },

  async triggerChannelSync(channelId: string): Promise<{ jobId: string }> {
    const response = await apiClient.post<ApiResponse<{ jobId: string }>>(`/sync/channel/${channelId}`);
    return response.data.data!;
  },

  async triggerProductSync(productId: string): Promise<{ jobId: string }> {
    const response = await apiClient.post<ApiResponse<{ jobId: string }>>(`/sync/product/${productId}`);
    return response.data.data!;
  },

  async triggerReconciliation(): Promise<{ jobId: string }> {
    const response = await apiClient.post<ApiResponse<{ jobId: string }>>('/sync/reconcile');
    return response.data.data!;
  },

  async getStatus(): Promise<EngineStatus> {
    const response = await apiClient.get<ApiResponse<EngineStatus>>('/sync/status');
    return response.data.data!;
  },
};

// ============================================================================
// Dashboard API
// ============================================================================

export const dashboardApi = {
  async getStats(): Promise<DashboardStats> {
    const response = await apiClient.get<ApiResponse<DashboardStats>>('/dashboard/stats');
    return response.data.data!;
  },

  async getRecentActivity(limit = 10): Promise<SyncEvent[]> {
    const response = await apiClient.get<ApiResponse<SyncEvent[]>>('/dashboard/activity', {
      params: { limit },
    });
    return response.data.data!;
  },

  async getAgentStatus(): Promise<EngineStatus> {
    const response = await apiClient.get<ApiResponse<EngineStatus>>('/dashboard/agents');
    return response.data.data!;
  },

  async getStockOverview(): Promise<{
    products: Array<{
      id: string;
      sku: string;
      name: string;
      currentStock: number;
      bufferStock: number;
      status: 'healthy' | 'low' | 'out_of_stock';
    }>;
  }> {
    const response = await apiClient.get<ApiResponse<any>>('/dashboard/stock-overview');
    return response.data.data!;
  },
};

// ============================================================================
// Admin API
// ============================================================================

export const adminApi = {
  async getStats(): Promise<any> {
    const response = await apiClient.get<ApiResponse<any>>('/admin/stats');
    return response.data.data!;
  },

  async getTenants(params?: { page?: number; limit?: number }): Promise<any> {
    const response = await apiClient.get<ApiResponse<any>>('/admin/tenants', { params });
    return response.data.data!;
  },

  async getTenant(id: string): Promise<any> {
    const response = await apiClient.get<ApiResponse<any>>(`/admin/tenants/${id}`);
    return response.data.data!;
  },

  async getSyncEvents(params?: { page?: number; limit?: number; status?: string; tenantId?: string }): Promise<any> {
    const response = await apiClient.get<ApiResponse<any>>('/admin/sync-events', { params });
    return response.data.data!;
  },

  async getSystemHealth(): Promise<any> {
    const response = await apiClient.get<ApiResponse<any>>('/admin/system-health');
    return response.data.data!;
  },
};

// ============================================================================
// Health API
// ============================================================================

export const healthApi = {
  async check(): Promise<{ status: string; timestamp: string }> {
    const response = await apiClient.get<{ status: string; timestamp: string }>('/health');
    return response.data;
  },

  async detailed(): Promise<{
    status: string;
    services: {
      database: boolean;
      redis: boolean;
      queues: boolean;
    };
  }> {
    const response = await apiClient.get('/health/detailed');
    return response.data;
  },
};

// ============================================================================
// WebSocket Client
// ============================================================================

export type WebSocketEventHandler = (event: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private handlers: Map<string, Set<WebSocketEventHandler>> = new Map();
  private isIntentionallyClosed = false;

  connect(): void {
    const token = getStoredToken();
    if (!token) {
      console.warn('No token available for WebSocket connection');
      return;
    }

    this.isIntentionallyClosed = false;
    const wsUrl = `${WS_BASE_URL}/ws?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.emit('connected', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        this.emit('disconnected', { code: event.code, reason: event.reason });

        if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        this.emit('error', { error });
      };
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error);
    }
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect();
      }
    }, delay);
  }

  on(event: string, handler: WebSocketEventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  off(event: string, handler: WebSocketEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[WebSocket] Handler error for event ${event}:`, error);
      }
    });

    // Also emit to wildcard handlers
    this.handlers.get('*')?.forEach((handler) => {
      try {
        handler({ type: event, ...data });
      } catch (error) {
        console.error(`[WebSocket] Wildcard handler error:`, error);
      }
    });
  }

  send(type: string, data?: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('[WebSocket] Cannot send - not connected');
    }
  }

  subscribe(room: string): void {
    this.send('subscribe', { room });
  }

  unsubscribe(room: string): void {
    this.send('unsubscribe', { room });
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton WebSocket client
export const wsClient = new WebSocketClient();

// ============================================================================
// Export Default API Client
// ============================================================================

export default apiClient;
