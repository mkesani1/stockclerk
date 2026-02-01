/**
 * Common types for all integrations
 */

export interface IntegrationConfig {
  apiKey?: string;
  apiSecret?: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  lastUpdated: Date;
  metadata?: Record<string, unknown>;
}

export interface StockUpdate {
  productId: string;
  sku: string;
  quantity: number;
  source: IntegrationSource;
  timestamp: Date;
}

export type IntegrationSource = 'eposnow' | 'wix' | 'otter';

export interface SyncResult {
  success: boolean;
  source: IntegrationSource;
  productsUpdated: number;
  errors: SyncError[];
  timestamp: Date;
}

export interface SyncError {
  productId?: string;
  sku?: string;
  message: string;
  code: string;
}

export interface WebhookPayload {
  source: IntegrationSource;
  event: string;
  data: unknown;
  timestamp: Date;
}

export interface IntegrationClient {
  name: IntegrationSource;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  updateStock(updates: StockUpdate[]): Promise<SyncResult>;
  healthCheck(): Promise<boolean>;
}
