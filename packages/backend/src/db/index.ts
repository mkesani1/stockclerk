import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

// Database configuration from environment
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/stockclerk';

// Create connection pool with sensible defaults for a multi-tenant SaaS
const pool = new Pool({
  connectionString,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection cannot be established
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

// Create drizzle instance with schema
export const db = drizzle(pool, { schema });

// Export pool for health checks and cleanup
export { pool };

// Export schema for convenience
export * from './schema.js';

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
}

// Run database migrations on startup
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');

    // Create enum types (idempotent)
    await client.query(`DO $$ BEGIN CREATE TYPE channel_type AS ENUM ('eposnow', 'wix', 'deliveroo'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await client.query(`DO $$ BEGIN CREATE TYPE user_role AS ENUM ('owner', 'admin', 'staff'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await client.query(`DO $$ BEGIN CREATE TYPE sync_event_status AS ENUM ('pending', 'processing', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await client.query(`DO $$ BEGIN CREATE TYPE alert_type AS ENUM ('low_stock', 'sync_error', 'channel_disconnected', 'system'); EXCEPTION WHEN duplicate_object THEN null; END $$`);

    // Enable UUID extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create tables (idempotent with IF NOT EXISTS)
    await client.query(`CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(255) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE, source VARCHAR(50) NOT NULL DEFAULT 'direct', stripe_customer_id VARCHAR(255), stripe_subscription_id VARCHAR(255), plan VARCHAR(50) NOT NULL DEFAULT 'trial', plan_status VARCHAR(50) NOT NULL DEFAULT 'trialing', plan_shop_limit INTEGER NOT NULL DEFAULT 3, trial_ends_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, email VARCHAR(255) NOT NULL UNIQUE, password_hash TEXT NOT NULL, name VARCHAR(255), role user_role NOT NULL DEFAULT 'staff', onboarding_complete BOOLEAN NOT NULL DEFAULT false, is_super_admin BOOLEAN NOT NULL DEFAULT false, auth_method VARCHAR(50) NOT NULL DEFAULT 'password', created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS channels (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, type channel_type NOT NULL, name VARCHAR(255) NOT NULL, credentials_encrypted TEXT, is_active BOOLEAN NOT NULL DEFAULT true, last_sync_at TIMESTAMP WITH TIME ZONE, external_instance_id VARCHAR(255), created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS products (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, sku VARCHAR(100) NOT NULL, name VARCHAR(255) NOT NULL, current_stock INTEGER NOT NULL DEFAULT 0, buffer_stock INTEGER NOT NULL DEFAULT 0, metadata JSONB, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS product_channel_mappings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE, external_id VARCHAR(255) NOT NULL, external_sku VARCHAR(255), created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS sync_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_type VARCHAR(50) NOT NULL, channel_id UUID REFERENCES channels(id) ON DELETE SET NULL, product_id UUID REFERENCES products(id) ON DELETE SET NULL, old_value JSONB, new_value JSONB, status sync_event_status NOT NULL DEFAULT 'pending', error_message TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS alerts (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, type alert_type NOT NULL, message TEXT NOT NULL, metadata JSONB, is_read BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS enquiries (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), business_name VARCHAR(255) NOT NULL, contact_name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, phone VARCHAR(50), shop_count VARCHAR(50) NOT NULL, message TEXT, status VARCHAR(50) NOT NULL DEFAULT 'new', created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL)`);

    // Create indexes (idempotent)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_channels_tenant_id ON channels(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_channels_is_active ON channels(is_active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku ON products(tenant_id, sku)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pcm_product_id ON product_channel_mappings(product_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pcm_channel_id ON product_channel_mappings(channel_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pcm_external_id ON product_channel_mappings(external_id)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pcm_channel_external ON product_channel_mappings(channel_id, external_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_events_tenant_id ON sync_events(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_events_channel_id ON sync_events(channel_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_events_product_id ON sync_events(product_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_events_status ON sync_events(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_events(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id ON alerts(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC)`);

    console.log('Database migrations completed successfully');
  } finally {
    client.release();
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
}
