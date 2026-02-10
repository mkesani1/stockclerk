/**
 * Test Data Fixtures
 * Factory functions for generating consistent test data
 */

import { randomUUID } from 'crypto';
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
} from '../../db/schema.js';

// ============================================================================
// ID Generators
// ============================================================================

let idCounter = 0;

export function generateId(): string {
  return randomUUID();
}

export function generateSequentialId(): string {
  idCounter++;
  return `test-id-${idCounter.toString().padStart(6, '0')}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

// ============================================================================
// Tenant Fixtures
// ============================================================================

export interface TenantFixtureOptions {
  id?: string;
  name?: string;
  slug?: string;
  createdAt?: Date;
}

export function createTenantFixture(options: TenantFixtureOptions = {}): Tenant {
  const id = options.id || generateId();
  return {
    id,
    name: options.name || 'Test Company',
    slug: options.slug || `test-company-${id.slice(0, 8)}`,
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// User Fixtures
// ============================================================================

export interface UserFixtureOptions {
  id?: string;
  tenantId?: string;
  email?: string;
  passwordHash?: string;
  role?: UserRole;
  createdAt?: Date;
}

export function createUserFixture(options: UserFixtureOptions = {}): User {
  const id = options.id || generateId();
  return {
    id,
    tenantId: options.tenantId || generateId(),
    email: options.email || `user-${id.slice(0, 8)}@example.com`,
    // Default password: "password123"
    passwordHash: options.passwordHash || '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.AerMLt1WCOOxFi',
    role: options.role || 'staff',
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Channel Fixtures
// ============================================================================

export interface ChannelFixtureOptions {
  id?: string;
  tenantId?: string;
  type?: ChannelType;
  name?: string;
  externalInstanceId?: string;
  credentialsEncrypted?: string | null;
  isActive?: boolean;
  lastSyncAt?: Date | null;
  createdAt?: Date;
}

export function createChannelFixture(options: ChannelFixtureOptions = {}): Channel {
  const id = options.id || generateId();
  const type = options.type || 'eposnow';
  const externalInstanceId = options.externalInstanceId || (type === 'eposnow' ? 'loc-001' : `${type}-id-123`);
  return {
    id,
    tenantId: options.tenantId || generateId(),
    type,
    externalInstanceId,
    name: options.name || `${type.charAt(0).toUpperCase() + type.slice(1)} Channel`,
    credentialsEncrypted: options.credentialsEncrypted ?? null,
    isActive: options.isActive ?? true,
    lastSyncAt: options.lastSyncAt ?? null,
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Product Fixtures
// ============================================================================

export interface ProductFixtureOptions {
  id?: string;
  tenantId?: string;
  sku?: string;
  name?: string;
  currentStock?: number;
  bufferStock?: number;
  metadata?: Record<string, unknown> | null;
  updatedAt?: Date;
  createdAt?: Date;
}

export function createProductFixture(options: ProductFixtureOptions = {}): Product {
  const id = options.id || generateId();
  return {
    id,
    tenantId: options.tenantId || generateId(),
    sku: options.sku || `SKU-${id.slice(0, 8).toUpperCase()}`,
    name: options.name || `Test Product ${id.slice(0, 8)}`,
    currentStock: options.currentStock ?? 100,
    bufferStock: options.bufferStock ?? 10,
    metadata: options.metadata ?? null,
    updatedAt: options.updatedAt || new Date(),
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Product Channel Mapping Fixtures
// ============================================================================

export interface MappingFixtureOptions {
  id?: string;
  productId?: string;
  channelId?: string;
  externalId?: string;
  externalSku?: string | null;
  createdAt?: Date;
}

export function createMappingFixture(options: MappingFixtureOptions = {}): ProductChannelMapping {
  const id = options.id || generateId();
  return {
    id,
    productId: options.productId || generateId(),
    channelId: options.channelId || generateId(),
    externalId: options.externalId || `ext-${id.slice(0, 8)}`,
    externalSku: options.externalSku ?? null,
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Sync Event Fixtures
// ============================================================================

export interface SyncEventFixtureOptions {
  id?: string;
  tenantId?: string;
  eventType?: string;
  channelId?: string | null;
  productId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  status?: SyncEventStatus;
  errorMessage?: string | null;
  createdAt?: Date;
}

export function createSyncEventFixture(options: SyncEventFixtureOptions = {}): SyncEvent {
  const id = options.id || generateId();
  return {
    id,
    tenantId: options.tenantId || generateId(),
    eventType: options.eventType || 'stock_update',
    channelId: options.channelId ?? null,
    productId: options.productId ?? null,
    oldValue: options.oldValue ?? null,
    newValue: options.newValue ?? null,
    status: options.status || 'pending',
    errorMessage: options.errorMessage ?? null,
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Alert Fixtures
// ============================================================================

export interface AlertFixtureOptions {
  id?: string;
  tenantId?: string;
  type?: AlertType;
  message?: string;
  metadata?: Record<string, unknown> | null;
  isRead?: boolean;
  createdAt?: Date;
}

export function createAlertFixture(options: AlertFixtureOptions = {}): Alert {
  const id = options.id || generateId();
  return {
    id,
    tenantId: options.tenantId || generateId(),
    type: options.type || 'low_stock',
    message: options.message || 'Test alert message',
    metadata: options.metadata ?? null,
    isRead: options.isRead ?? false,
    createdAt: options.createdAt || new Date(),
  };
}

// ============================================================================
// Complete Test Scenario Fixtures
// ============================================================================

export interface TestScenarioData {
  tenant: Tenant;
  owner: User;
  admin: User;
  staff: User;
  eposnowChannel: Channel;
  wixChannel: Channel;
  deliverooChannel: Channel;
  products: Product[];
  mappings: ProductChannelMapping[];
  syncEvents: SyncEvent[];
  alerts: Alert[];
}

export function createTestScenario(): TestScenarioData {
  // Create tenant
  const tenant = createTenantFixture({
    name: 'Coffee Shop Ltd',
    slug: 'coffee-shop',
  });

  // Create users
  const owner = createUserFixture({
    tenantId: tenant.id,
    email: 'owner@coffeeshop.com',
    role: 'owner',
  });

  const admin = createUserFixture({
    tenantId: tenant.id,
    email: 'admin@coffeeshop.com',
    role: 'admin',
  });

  const staff = createUserFixture({
    tenantId: tenant.id,
    email: 'staff@coffeeshop.com',
    role: 'staff',
  });

  // Create channels
  const eposnowChannel = createChannelFixture({
    tenantId: tenant.id,
    type: 'eposnow',
    name: 'Main POS',
    isActive: true,
  });

  const wixChannel = createChannelFixture({
    tenantId: tenant.id,
    type: 'wix',
    name: 'Online Store',
    isActive: true,
  });

  const deliverooChannel = createChannelFixture({
    tenantId: tenant.id,
    type: 'deliveroo',
    name: 'Deliveroo Menu',
    isActive: true,
  });

  // Create products
  const products = [
    createProductFixture({
      tenantId: tenant.id,
      sku: 'COFFEE-001',
      name: 'Espresso Beans 1kg',
      currentStock: 50,
      bufferStock: 10,
    }),
    createProductFixture({
      tenantId: tenant.id,
      sku: 'COFFEE-002',
      name: 'Latte Beans 1kg',
      currentStock: 5, // Low stock
      bufferStock: 10,
    }),
    createProductFixture({
      tenantId: tenant.id,
      sku: 'MUG-001',
      name: 'Branded Coffee Mug',
      currentStock: 200,
      bufferStock: 20,
    }),
  ];

  // Create mappings
  const mappings = [
    createMappingFixture({
      productId: products[0].id,
      channelId: eposnowChannel.id,
      externalId: 'epos-12345',
    }),
    createMappingFixture({
      productId: products[0].id,
      channelId: wixChannel.id,
      externalId: 'wix-abc123',
    }),
    createMappingFixture({
      productId: products[1].id,
      channelId: eposnowChannel.id,
      externalId: 'epos-12346',
    }),
    createMappingFixture({
      productId: products[2].id,
      channelId: wixChannel.id,
      externalId: 'wix-def456',
    }),
  ];

  // Create sync events
  const syncEvents = [
    createSyncEventFixture({
      tenantId: tenant.id,
      eventType: 'stock_update',
      productId: products[0].id,
      channelId: eposnowChannel.id,
      oldValue: { stock: 60 },
      newValue: { stock: 50 },
      status: 'completed',
    }),
    createSyncEventFixture({
      tenantId: tenant.id,
      eventType: 'stock_update',
      productId: products[1].id,
      channelId: wixChannel.id,
      oldValue: { stock: 10 },
      newValue: { stock: 5 },
      status: 'completed',
    }),
  ];

  // Create alerts
  const alerts = [
    createAlertFixture({
      tenantId: tenant.id,
      type: 'low_stock',
      message: 'Latte Beans 1kg is running low (5 units remaining)',
      metadata: { productId: products[1].id, sku: products[1].sku },
    }),
  ];

  return {
    tenant,
    owner,
    admin,
    staff,
    eposnowChannel,
    wixChannel,
    deliverooChannel,
    products,
    mappings,
    syncEvents,
    alerts,
  };
}

// ============================================================================
// Request Body Fixtures
// ============================================================================

export const validRegisterBody = {
  tenantName: 'Test Company',
  tenantSlug: 'test-company',
  email: 'test@example.com',
  password: 'securePassword123!',
};

export const validLoginBody = {
  email: 'test@example.com',
  password: 'securePassword123!',
};

export const validCreateChannelBody = {
  type: 'eposnow' as ChannelType,
  name: 'Test POS Channel',
  credentials: {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  },
};

export const validCreateProductBody = {
  sku: 'TEST-001',
  name: 'Test Product',
  currentStock: 100,
  bufferStock: 10,
};

export const validUpdateStockBody = {
  currentStock: 150,
  reason: 'Manual stock adjustment',
};

// ============================================================================
// Webhook Payload Fixtures
// ============================================================================

export const eposnowWebhookPayload = {
  event: 'stock_change',
  productId: '12345',
  sku: 'TEST-001',
  stockLevel: 95,
  previousStockLevel: 100,
  timestamp: new Date().toISOString(),
  locationId: 'loc-001',
};

export const wixWebhookPayload = {
  eventType: 'inventory/updated',
  instanceId: 'wix-instance-123',
  data: {
    productId: 'wix-prod-123',
    inventory: {
      quantity: 50,
      trackQuantity: true,
    },
  },
  timestamp: new Date().toISOString(),
};

export const otterWebhookPayload = {
  type: 'item_availability_changed',
  restaurantId: 'rest-123',
  payload: {
    itemId: 'item-001',
    externalId: 'ext-001',
    available: true,
    quantity: 20,
  },
  timestamp: new Date().toISOString(),
};
