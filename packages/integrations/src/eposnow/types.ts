/**
 * Eposnow API Types
 * Based on Eposnow REST API specification
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface EposnowApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface EposnowErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ============================================================================
// Product/Item Types
// ============================================================================

export interface EposnowProduct {
  Id: number;
  Name: string;
  Description: string | null;
  Barcode: string | null;
  SKU: string | null;
  CostPrice: number;
  SalePrice: number;
  TaxRateId: number;
  CategoryId: number | null;
  SupplierId: number | null;
  ProductType: EposnowProductType;
  IsDeleted: boolean;
  CreatedDate: string;
  UpdatedDate: string;
  CurrentStockLevel: number;
  ReorderLevel: number;
  OptimalStockLevel: number;
  LocationStockLevels: EposnowLocationStock[];
  Variants: EposnowProductVariant[];
  Images: EposnowProductImage[];
}

export type EposnowProductType = 'Standard' | 'Variant' | 'Composite' | 'Service';

export interface EposnowProductVariant {
  Id: number;
  ProductId: number;
  Name: string;
  SKU: string | null;
  Barcode: string | null;
  CostPrice: number;
  SalePrice: number;
  CurrentStockLevel: number;
}

export interface EposnowProductImage {
  Id: number;
  ProductId: number;
  Url: string;
  IsPrimary: boolean;
}

export interface EposnowLocationStock {
  LocationId: number;
  LocationName: string;
  StockLevel: number;
  ReorderLevel: number;
}

// ============================================================================
// Stock/Inventory Types
// ============================================================================

export interface EposnowStockUpdate {
  ProductId: number;
  LocationId?: number;
  Quantity: number;
  Reason: EposnowStockAdjustmentReason;
  Notes?: string;
}

export type EposnowStockAdjustmentReason =
  | 'Sale'
  | 'Return'
  | 'StockTake'
  | 'Transfer'
  | 'Adjustment'
  | 'Received'
  | 'Damaged'
  | 'Expired'
  | 'Other';

export interface EposnowStockAdjustment {
  Id: number;
  ProductId: number;
  LocationId: number;
  PreviousQuantity: number;
  NewQuantity: number;
  AdjustmentQuantity: number;
  Reason: EposnowStockAdjustmentReason;
  Notes: string | null;
  CreatedDate: string;
  CreatedByUserId: number;
}

export interface EposnowStockMovement {
  Id: number;
  ProductId: number;
  FromLocationId: number | null;
  ToLocationId: number | null;
  Quantity: number;
  MovementType: 'In' | 'Out' | 'Transfer';
  ReferenceType: string;
  ReferenceId: number | null;
  CreatedDate: string;
}

// ============================================================================
// Location Types
// ============================================================================

export interface EposnowLocation {
  Id: number;
  Name: string;
  Address: string | null;
  City: string | null;
  PostCode: string | null;
  Country: string | null;
  IsDefault: boolean;
  IsActive: boolean;
}

// ============================================================================
// Category Types
// ============================================================================

export interface EposnowCategory {
  Id: number;
  Name: string;
  ParentCategoryId: number | null;
  ColourHex: string | null;
  ImageUrl: string | null;
  SortOrder: number;
}

// ============================================================================
// Transaction/Sale Types
// ============================================================================

export interface EposnowTransaction {
  Id: number;
  TransactionNumber: string;
  LocationId: number;
  DeviceId: number;
  StaffId: number;
  CustomerId: number | null;
  TotalAmount: number;
  TaxAmount: number;
  DiscountAmount: number;
  Status: EposnowTransactionStatus;
  CreatedDate: string;
  CompletedDate: string | null;
  Items: EposnowTransactionItem[];
}

export type EposnowTransactionStatus = 'Open' | 'Complete' | 'Voided' | 'Refunded';

export interface EposnowTransactionItem {
  Id: number;
  TransactionId: number;
  ProductId: number;
  ProductName: string;
  Quantity: number;
  UnitPrice: number;
  TotalPrice: number;
  TaxAmount: number;
  DiscountAmount: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface EposnowWebhookConfig {
  Url: string;
  Events: EposnowWebhookEvent[];
  IsActive: boolean;
  SecretKey?: string;
}

export type EposnowWebhookEvent =
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'stock.updated'
  | 'transaction.created'
  | 'transaction.completed'
  | 'transaction.voided';

export interface EposnowWebhookPayload {
  Event: EposnowWebhookEvent;
  WebhookId: number;
  Timestamp: string;
  Data: EposnowWebhookData;
  Signature: string;
}

export type EposnowWebhookData =
  | EposnowProductWebhookData
  | EposnowStockWebhookData
  | EposnowTransactionWebhookData;

export interface EposnowProductWebhookData {
  ProductId: number;
  Product?: EposnowProduct;
  ChangeType: 'Created' | 'Updated' | 'Deleted';
}

export interface EposnowStockWebhookData {
  ProductId: number;
  LocationId: number;
  PreviousQuantity: number;
  NewQuantity: number;
  Reason: EposnowStockAdjustmentReason;
}

export interface EposnowTransactionWebhookData {
  TransactionId: number;
  Transaction?: EposnowTransaction;
  Status: EposnowTransactionStatus;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface EposnowProductQuery {
  page?: number;
  pageSize?: number;
  categoryId?: number;
  includeDeleted?: boolean;
  modifiedSince?: string;
  search?: string;
}

export interface EposnowStockQuery {
  productId?: number;
  locationId?: number;
  page?: number;
  pageSize?: number;
}

export interface EposnowTransactionQuery {
  startDate?: string;
  endDate?: string;
  locationId?: number;
  status?: EposnowTransactionStatus;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface EposnowClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  locationId?: number;
  timeout?: number;
  retryAttempts?: number;
}

export interface EposnowAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}
