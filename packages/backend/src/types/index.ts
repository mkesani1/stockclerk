import { z } from 'zod';
import type {
  Tenant,
  User,
  Channel,
  Product,
  ProductChannelMapping,
  SyncEvent,
  Alert,
  ChannelType,
  UserRole,
  SyncEventStatus,
  AlertType,
} from '../db/schema.js';

// Re-export database types
export type {
  Tenant,
  User,
  Channel,
  Product,
  ProductChannelMapping,
  SyncEvent,
  Alert,
  ChannelType,
  UserRole,
  SyncEventStatus,
  AlertType,
};

// ============================================================================
// Zod Schemas for Request Validation
// ============================================================================

// Auth schemas
export const registerSchema = z.object({
  tenantName: z.string().min(2).max(255),
  tenantSlug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(255).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Channel schemas
export const createChannelSchema = z.object({
  type: z.enum(['eposnow', 'wix', 'deliveroo']),
  name: z.string().min(1).max(255),
  credentials: z.record(z.unknown()).optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  credentials: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

// Product schemas
export const createProductSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  currentStock: z.number().int().min(0).default(0),
  bufferStock: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

export const updateProductSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  currentStock: z.number().int().min(0).optional(),
  bufferStock: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateStockSchema = z.object({
  currentStock: z.number().int().min(0),
  reason: z.string().optional(),
});

// Product channel mapping schemas
export const createMappingSchema = z.object({
  productId: z.string().uuid(),
  channelId: z.string().uuid(),
  externalId: z.string().min(1).max(255),
  externalSku: z.string().max(255).optional(),
});

// Alert schemas
export const createAlertSchema = z.object({
  type: z.enum(['low_stock', 'sync_error', 'channel_disconnected', 'system']),
  message: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const markAlertReadSchema = z.object({
  isRead: z.boolean(),
});

// Pagination schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// API Response Types
// ============================================================================

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Paginated response
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Auth responses
export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: SafeUser;
  tenant: Tenant;
  tokens: AuthTokens;
}

export interface RegisterResponse {
  user: SafeUser;
  tenant: Tenant;
  tokens: AuthTokens;
}

// Safe user (without password hash)
export type SafeUser = Omit<User, 'passwordHash'>;

// Channel with decoded credentials type hint
export interface ChannelWithCredentials extends Omit<Channel, 'credentialsEncrypted'> {
  credentials?: Record<string, unknown>;
}

// Product with mappings
export interface ProductWithMappings extends Product {
  channelMappings: (ProductChannelMapping & {
    channel: Pick<Channel, 'id' | 'name' | 'type'>;
  })[];
}

// Sync event with related data
export interface SyncEventWithRelations extends SyncEvent {
  channel?: Pick<Channel, 'id' | 'name' | 'type'> | null;
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

export type WebSocketEventType =
  | 'stock_update'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'channel_connected'
  | 'channel_disconnected'
  | 'alert_created'
  | 'alert_resolved'
  | 'error'
  | 'connected'
  | 'pong'
  | 'subscribe'
  | 'unsubscribe';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  tenantId: string;
  payload: T;
  timestamp: string;
}

export interface StockUpdatePayload {
  productId: string;
  sku: string;
  productName: string;
  oldStock: number;
  newStock: number;
  channelId?: string;
  channelName?: string;
}

export interface SyncEventPayload {
  syncEventId: string;
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  status: SyncEventStatus;
  message?: string;
}

export interface AlertPayload {
  alertId: string;
  type: AlertType;
  message: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Queue Job Types (for BullMQ)
// ============================================================================

export interface SyncJobData {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  operation: 'full_sync' | 'incremental_sync' | 'push_update';
  productIds?: string[];
}

export interface StockUpdateJobData {
  tenantId: string;
  productId: string;
  newStock: number;
  sourceChannelId?: string;
  propagateToChannels: boolean;
}

export interface WebhookJobData {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  eventType: string;
  payload: Record<string, unknown>;
}

// ============================================================================
// JWT Payload Types
// ============================================================================

export interface JWTPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  isSuperAdmin?: boolean;
  iat?: number;
  exp?: number;
}

// Extend Fastify JWT to include proper payload typing
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload;
  }
}

// ============================================================================
// Integration Credential Types
// ============================================================================

export interface EposnowCredentials {
  apiKey: string;
  apiSecret: string;
  locationId?: string;
}

export interface WixCredentials {
  accessToken: string;
  refreshToken: string;
  siteId: string;
  instanceId: string;
}

export interface DeliverooCredentials {
  otterApiKey: string;
  restaurantId: string;
  locationId?: string;
}

export type ChannelCredentials = EposnowCredentials | WixCredentials | DeliverooCredentials;

// ============================================================================
// Inferred Types from Zod Schemas
// ============================================================================

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type CreateMappingInput = z.infer<typeof createMappingSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
