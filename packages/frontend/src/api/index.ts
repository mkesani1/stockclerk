/**
 * API Client Exports
 * Re-exports all API utilities and types
 */

export {
  // API Client
  default as apiClient,

  // Token Management
  getStoredToken,
  setStoredToken,
  clearStoredToken,

  // API Modules
  authApi,
  productsApi,
  channelsApi,
  alertsApi,
  syncApi,
  dashboardApi,
  healthApi,

  // WebSocket Client
  WebSocketClient,
  wsClient,

  // Types
  type ApiResponse,
  type PaginatedResponse,
  type LoginCredentials,
  type RegisterData,
  type AuthResponse,
  type CreateProductData,
  type UpdateProductData,
  type CreateChannelData,
  type UpdateChannelData,
  type CreateMappingData,
  type DashboardStats,
  type AgentStatus,
  type EngineStatus,
  type WebSocketEventHandler,
} from './client.js';
