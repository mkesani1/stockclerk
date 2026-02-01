/**
 * Test Database Utilities
 * Provides setup and teardown helpers for integration tests
 */

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../db/schema.js';

// Test database connection string
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5433/stockclerk_test';

let testDb: PostgresJsDatabase<typeof schema> | null = null;
let queryClient: ReturnType<typeof postgres> | null = null;

/**
 * Initialize test database connection
 */
export async function initTestDb(): Promise<PostgresJsDatabase<typeof schema>> {
  if (testDb) return testDb;

  queryClient = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
  });

  testDb = drizzle(queryClient, { schema });
  return testDb;
}

/**
 * Close test database connection
 */
export async function closeTestDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = null;
    testDb = null;
  }
}

/**
 * Get test database instance
 */
export function getTestDb(): PostgresJsDatabase<typeof schema> {
  if (!testDb) {
    throw new Error('Test database not initialized. Call initTestDb() first.');
  }
  return testDb;
}

/**
 * Clean all tables in the test database
 */
export async function cleanDatabase(): Promise<void> {
  const db = getTestDb();

  // Delete in order respecting foreign key constraints
  await db.delete(schema.alerts);
  await db.delete(schema.syncEvents);
  await db.delete(schema.productChannelMappings);
  await db.delete(schema.products);
  await db.delete(schema.channels);
  await db.delete(schema.users);
  await db.delete(schema.tenants);
}

/**
 * Setup test database with schema
 */
export async function setupTestDb(): Promise<void> {
  const db = getTestDb();

  // Clean existing data
  await cleanDatabase();
}

/**
 * Seed test database with initial data
 */
export async function seedTestDb(): Promise<{
  tenant: schema.Tenant;
  user: schema.User;
  channel: schema.Channel;
  product: schema.Product;
}> {
  const db = getTestDb();

  // Create test tenant
  const [tenant] = await db.insert(schema.tenants).values({
    name: 'Test Company',
    slug: 'test-company',
  }).returning();

  // Create test user
  const [user] = await db.insert(schema.users).values({
    tenantId: tenant.id,
    email: 'test@example.com',
    passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.AerMLt1WCOOxFi', // "password123"
    role: 'owner',
  }).returning();

  // Create test channel
  const [channel] = await db.insert(schema.channels).values({
    tenantId: tenant.id,
    type: 'eposnow',
    name: 'Test POS',
    isActive: true,
  }).returning();

  // Create test product
  const [product] = await db.insert(schema.products).values({
    tenantId: tenant.id,
    sku: 'TEST-001',
    name: 'Test Product',
    currentStock: 100,
    bufferStock: 10,
  }).returning();

  return { tenant, user, channel, product };
}

/**
 * Create a mock database for unit tests
 * Returns a mock object that simulates database operations
 */
export function createMockDb() {
  const mockData = {
    tenants: new Map<string, schema.Tenant>(),
    users: new Map<string, schema.User>(),
    channels: new Map<string, schema.Channel>(),
    products: new Map<string, schema.Product>(),
    productChannelMappings: new Map<string, schema.ProductChannelMapping>(),
    syncEvents: new Map<string, schema.SyncEvent>(),
    alerts: new Map<string, schema.Alert>(),
  };

  return {
    mockData,

    query: {
      tenants: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      users: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      channels: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      products: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      productChannelMappings: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      syncEvents: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      alerts: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },

    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),

    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),

    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),

    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),

    transaction: vi.fn((callback) => callback({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
  };
}

// Import vi from vitest for mocking
import { vi } from 'vitest';
