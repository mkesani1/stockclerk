// Channel Types
export type ChannelType = 'eposnow' | 'wix' | 'deliveroo';

// Alert Types
export type AlertType = 'low_stock' | 'sync_error' | 'channel_disconnected' | 'system';

export interface Alert {
  id: string;
  tenantId: string;
  type: AlertType;
  message: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

// Tenant Types
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

// Sync Event Types
export type SyncEventStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SyncEvent {
  id: string;
  tenantId: string;
  eventType: string;
  channelId?: string | null;
  productId?: string | null;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  status: SyncEventStatus;
  errorMessage?: string | null;
  createdAt: string;
}

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  status: 'connected' | 'syncing' | 'error' | 'disconnected';
  lastSync: string | null;
  productCount: number;
  credentials?: Record<string, string>;
}

// Product Types
export interface Product {
  id: string;
  sku: string;
  name: string;
  stock: number;
  bufferStock: number;
  price: number;
  channels: ChannelProduct[];
  lastSync: string | null;
  imageUrl?: string;
}

export interface ChannelProduct {
  channelId: string;
  channelType: ChannelType;
  externalId: string;
  stock: number;
  price: number;
  lastSync: string | null;
  status: 'synced' | 'pending' | 'error';
}

// AI Agent Types
export type AgentType = 'watcher' | 'sync' | 'guardian' | 'alert';

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  status: 'active' | 'idle' | 'processing' | 'error';
  lastActivity: string | null;
  tasksCompleted: number;
  icon: string;
}

// Sync Activity Types
export interface SyncActivity {
  id: string;
  type: 'stock_update' | 'product_sync' | 'channel_connect' | 'alert' | 'error';
  message: string;
  timestamp: string;
  channelType?: ChannelType;
  productId?: string;
  productName?: string;
  oldValue?: number;
  newValue?: number;
}

// User Types
export interface User {
  id: string;
  email: string;
  name: string;
  businessName: string;
  avatar?: string;
  onboardingComplete: boolean;
  role?: string;
  isSuperAdmin?: boolean;
  settings: UserSettings;
}

export interface UserSettings {
  lowStockThreshold: number;
  defaultBufferStock: number;
  notificationsEnabled: boolean;
  emailAlerts: boolean;
  syncInterval: number; // minutes
}

// Dashboard Stats
export interface DashboardStats {
  totalProducts: number;
  syncedToday: number;
  activeChannels: number;
  alertsCount: number;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// WebSocket Event Types
export interface WSEvent {
  type: 'sync_update' | 'stock_change' | 'channel_status' | 'agent_activity' | 'alert';
  payload: unknown;
  timestamp: string;
}
