import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const channelTypeEnum = pgEnum('channel_type', ['eposnow', 'wix', 'deliveroo']);
export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'staff']);
export const syncEventStatusEnum = pgEnum('sync_event_status', ['pending', 'processing', 'completed', 'failed']);
export const alertTypeEnum = pgEnum('alert_type', ['low_stock', 'sync_error', 'channel_disconnected', 'system']);

// Tenants table
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  source: varchar('source', { length: 50 }).notNull().default('direct'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  plan: varchar('plan', { length: 50 }).notNull().default('trial'),
  planStatus: varchar('plan_status', { length: 50 }).notNull().default('trialing'),
  planShopLimit: integer('plan_shop_limit').notNull().default(3),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }),
  role: userRoleEnum('role').notNull().default('staff'),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  authMethod: varchar('auth_method', { length: 50 }).notNull().default('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Channels table (integrations with Eposnow, Wix, Deliveroo)
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  type: channelTypeEnum('type').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  credentialsEncrypted: text('credentials_encrypted'),
  isActive: boolean('is_active').notNull().default(true),
  lastSyncAt: timestamp('last_sync_at'),
  externalInstanceId: varchar('external_instance_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Products table
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  currentStock: integer('current_stock').notNull().default(0),
  bufferStock: integer('buffer_stock').notNull().default(0),
  metadata: jsonb('metadata'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Product Channel Mappings table
export const productChannelMappings = pgTable('product_channel_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  externalSku: varchar('external_sku', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Sync Events table (audit log)
export const syncEvents = pgTable('sync_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  status: syncEventStatusEnum('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Alerts table
export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  type: alertTypeEnum('type').notNull(),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  channels: many(channels),
  products: many(products),
  syncEvents: many(syncEvents),
  alerts: many(alerts),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [channels.tenantId],
    references: [tenants.id],
  }),
  productMappings: many(productChannelMappings),
  syncEvents: many(syncEvents),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [products.tenantId],
    references: [tenants.id],
  }),
  channelMappings: many(productChannelMappings),
  syncEvents: many(syncEvents),
}));

export const productChannelMappingsRelations = relations(productChannelMappings, ({ one }) => ({
  product: one(products, {
    fields: [productChannelMappings.productId],
    references: [products.id],
  }),
  channel: one(channels, {
    fields: [productChannelMappings.channelId],
    references: [channels.id],
  }),
}));

export const syncEventsRelations = relations(syncEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [syncEvents.tenantId],
    references: [tenants.id],
  }),
  channel: one(channels, {
    fields: [syncEvents.channelId],
    references: [channels.id],
  }),
  product: one(products, {
    fields: [syncEvents.productId],
    references: [products.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [alerts.tenantId],
    references: [tenants.id],
  }),
}));

// Export table types for use in other modules
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type ProductChannelMapping = typeof productChannelMappings.$inferSelect;
export type NewProductChannelMapping = typeof productChannelMappings.$inferInsert;

export type SyncEvent = typeof syncEvents.$inferSelect;
export type NewSyncEvent = typeof syncEvents.$inferInsert;

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;

// Enum types
export type ChannelType = 'eposnow' | 'wix' | 'deliveroo';
export type UserRole = 'owner' | 'admin' | 'staff';
export type SyncEventStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AlertType = 'low_stock' | 'sync_error' | 'channel_disconnected' | 'system';
