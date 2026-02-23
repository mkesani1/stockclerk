/**
 * Uber Eats API Types
 * Types for Uber Eats restaurant/delivery integration
 */

// ============================================================================
// Client Configuration
// ============================================================================

export interface UberEatsClientConfig {
  clientId: string;
  clientSecret: string;
  storeId: string;
  timeout?: number;
  retryAttempts?: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface UberEatsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// ============================================================================
// Store Types
// ============================================================================

export interface UberEatsStore {
  store_id: string;
  name: string;
  address: {
    street_address: string;
    city: string;
    country: string;
  };
  status: 'ACTIVE' | 'INACTIVE';
}

// ============================================================================
// Menu Types
// ============================================================================

export interface UberEatsMenu {
  menus: Array<{
    id: string;
    title: string;
    categories: UberEatsCategory[];
  }>;
}

export interface UberEatsCategory {
  id: string;
  title: string;
  items: UberEatsMenuItem[];
}

export interface UberEatsMenuItem {
  id: string;
  external_id?: string;
  title: string;
  price: number;
  available: boolean;
  suspension_info?: {
    suspension: {
      suspend_until: number;
      reason: string;
    };
  };
}

// ============================================================================
// Availability Types
// ============================================================================

export interface UberEatsAvailabilityUpdate {
  item_id: string;
  available: boolean;
  reason?: string;
}

// ============================================================================
// Order Types
// ============================================================================

export interface UberEatsOrder {
  id: string;
  display_id: string;
  store: {
    id: string;
  };
  items: UberEatsOrderItem[];
  status: string;
}

export interface UberEatsOrderItem {
  id: string;
  title: string;
  external_data: string;
  quantity: number;
  price: {
    unit_price: number;
  };
}

// ============================================================================
// Webhook Types
// ============================================================================

export type UberEatsWebhookEvent = 'orders.notification' | 'eats.order.status_update' | 'eats.store.status_update';

export interface UberEatsWebhookPayload {
  event_type: string;
  event_id: string;
  event_time: string;
  meta: {
    resource_id: string;
    status: string;
  };
  resource_href?: string;
}

export interface UberEatsWebhookConfig {
  secret: string;
  clientSecret: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface UberEatsApiResponse<T> {
  data?: T;
  result?: T;
  errors?: Array<{
    code: string;
    message: string;
  }>;
}

export interface UberEatsErrorResponse {
  error: string;
  error_description: string;
}
