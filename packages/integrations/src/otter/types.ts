/**
 * Otter API Types (for Deliveroo Integration)
 * Based on Otter's restaurant management API specification
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface OtterApiResponse<T> {
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface OtterPaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface OtterErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

// ============================================================================
// Restaurant/Location Types
// ============================================================================

export interface OtterRestaurant {
  id: string;
  name: string;
  externalId?: string;
  timezone: string;
  currency: string;
  status: OtterRestaurantStatus;
  address: OtterAddress;
  contact: OtterContact;
  operatingHours: OtterOperatingHours[];
  platforms: OtterPlatformIntegration[];
  createdAt: string;
  updatedAt: string;
}

export type OtterRestaurantStatus = 'active' | 'inactive' | 'suspended';

export interface OtterAddress {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export interface OtterContact {
  phone?: string;
  email?: string;
}

export interface OtterOperatingHours {
  dayOfWeek: number; // 0-6, Sunday = 0
  openTime: string; // HH:MM format
  closeTime: string; // HH:MM format
  isOpen: boolean;
}

export interface OtterPlatformIntegration {
  platform: OtterPlatform;
  storeId: string;
  status: 'connected' | 'disconnected' | 'pending';
  lastSyncAt?: string;
}

export type OtterPlatform = 'deliveroo' | 'uber_eats' | 'doordash' | 'grubhub' | 'just_eat';

// ============================================================================
// Menu Types
// ============================================================================

export interface OtterMenu {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  isActive: boolean;
  categories: OtterCategory[];
  createdAt: string;
  updatedAt: string;
}

export interface OtterCategory {
  id: string;
  menuId: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  items: OtterMenuItem[];
}

export interface OtterMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  sku?: string;
  price: OtterPrice;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  isAvailable: boolean;
  availabilityStatus: OtterAvailabilityStatus;
  stockQuantity?: number;
  trackInventory: boolean;
  modifierGroups?: OtterModifierGroup[];
  nutritionalInfo?: OtterNutritionalInfo;
  allergens?: string[];
  dietaryLabels?: OtterDietaryLabel[];
  platformPrices?: OtterPlatformPrice[];
  createdAt: string;
  updatedAt: string;
}

export type OtterAvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'sold_out'
  | 'temporarily_unavailable'
  | 'scheduled_unavailable';

export interface OtterPrice {
  amount: number;
  currency: string;
}

export interface OtterPlatformPrice {
  platform: OtterPlatform;
  price: OtterPrice;
}

export interface OtterModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  modifiers: OtterModifier[];
}

export interface OtterModifier {
  id: string;
  name: string;
  price: OtterPrice;
  isActive: boolean;
  isAvailable: boolean;
}

export interface OtterNutritionalInfo {
  calories?: number;
  protein?: number;
  carbohydrates?: number;
  fat?: number;
  fiber?: number;
  sodium?: number;
}

export type OtterDietaryLabel =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'dairy_free'
  | 'halal'
  | 'kosher'
  | 'nut_free';

// ============================================================================
// Item Availability Types
// ============================================================================

export interface OtterAvailabilityUpdate {
  itemId: string;
  isAvailable: boolean;
  reason?: OtterUnavailabilityReason;
  unavailableUntil?: string; // ISO datetime
  platforms?: OtterPlatform[]; // If empty, applies to all platforms
}

export type OtterUnavailabilityReason =
  | 'out_of_stock'
  | 'sold_out_today'
  | 'ingredient_shortage'
  | 'kitchen_capacity'
  | 'seasonal'
  | 'discontinued'
  | 'other';

export interface OtterBulkAvailabilityUpdate {
  restaurantId: string;
  items: OtterAvailabilityUpdate[];
}

export interface OtterAvailabilityResponse {
  itemId: string;
  success: boolean;
  error?: string;
  currentStatus: OtterAvailabilityStatus;
}

// ============================================================================
// Stock/Inventory Types
// ============================================================================

export interface OtterStockLevel {
  itemId: string;
  sku?: string;
  quantity: number;
  threshold?: number; // Low stock warning threshold
  lastUpdated: string;
}

export interface OtterStockUpdate {
  itemId: string;
  quantity: number;
  operation: 'set' | 'increment' | 'decrement';
  reason?: string;
}

export interface OtterStockUpdateResponse {
  itemId: string;
  previousQuantity: number;
  newQuantity: number;
  success: boolean;
  error?: string;
}

// ============================================================================
// Order Types (for stock deduction)
// ============================================================================

export interface OtterOrder {
  id: string;
  restaurantId: string;
  platform: OtterPlatform;
  externalOrderId: string;
  status: OtterOrderStatus;
  items: OtterOrderItem[];
  subtotal: OtterPrice;
  deliveryFee?: OtterPrice;
  tax: OtterPrice;
  total: OtterPrice;
  customer?: OtterCustomer;
  deliveryAddress?: OtterAddress;
  placedAt: string;
  acceptedAt?: string;
  preparedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}

export type OtterOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export interface OtterOrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: OtterPrice;
  totalPrice: OtterPrice;
  modifiers?: OtterOrderModifier[];
  specialInstructions?: string;
}

export interface OtterOrderModifier {
  id: string;
  name: string;
  price: OtterPrice;
}

export interface OtterCustomer {
  name: string;
  phone?: string;
  email?: string;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface OtterWebhookConfig {
  id?: string;
  url: string;
  events: OtterWebhookEvent[];
  secret?: string;
  isActive: boolean;
}

export type OtterWebhookEvent =
  | 'menu.updated'
  | 'item.availability_changed'
  | 'item.stock_updated'
  | 'order.created'
  | 'order.updated'
  | 'order.cancelled'
  | 'restaurant.status_changed';

export interface OtterWebhookPayload<T = unknown> {
  id: string;
  event: OtterWebhookEvent;
  restaurantId: string;
  timestamp: string;
  data: T;
  signature?: string;
}

export interface OtterItemAvailabilityWebhookData {
  itemId: string;
  itemName: string;
  sku?: string;
  previousStatus: OtterAvailabilityStatus;
  newStatus: OtterAvailabilityStatus;
  reason?: OtterUnavailabilityReason;
  platform?: OtterPlatform;
}

export interface OtterStockWebhookData {
  itemId: string;
  itemName: string;
  sku?: string;
  previousQuantity: number;
  newQuantity: number;
  operation: 'set' | 'increment' | 'decrement';
  reason?: string;
}

export interface OtterOrderWebhookData {
  orderId: string;
  externalOrderId: string;
  platform: OtterPlatform;
  status: OtterOrderStatus;
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
  }>;
}

export interface OtterMenuWebhookData {
  menuId: string;
  menuName: string;
  changeType: 'created' | 'updated' | 'deleted';
  affectedItems?: string[];
}

// ============================================================================
// Query Types
// ============================================================================

export interface OtterMenuQuery {
  restaurantId: string;
  includeInactive?: boolean;
  platform?: OtterPlatform;
}

export interface OtterItemQuery {
  restaurantId: string;
  categoryId?: string;
  search?: string;
  isAvailable?: boolean;
  limit?: number;
  offset?: number;
}

export interface OtterOrderQuery {
  restaurantId: string;
  startDate?: string;
  endDate?: string;
  status?: OtterOrderStatus;
  platform?: OtterPlatform;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface OtterClientConfig {
  apiKey: string;
  restaurantId: string;
  baseUrl?: string;
  timeout?: number;
  retryAttempts?: number;
}
