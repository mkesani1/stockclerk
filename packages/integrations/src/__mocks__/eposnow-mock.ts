/**
 * Mock Eposnow API Server
 * Simulates Eposnow POS API responses for testing
 */

import { vi } from 'vitest';

// Types
export interface EposnowProduct {
  Id: number;
  Name: string;
  Description: string;
  SalePrice: number;
  CostPrice: number;
  Barcode: string;
  StockLevel: number;
  CategoryId: number;
  TaxGroupId: number;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface EposnowStock {
  ProductId: number;
  LocationId: number;
  Quantity: number;
  MinStockLevel: number;
  ReorderLevel: number;
}

export interface EposnowApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

// Mock data store
const mockProducts: Map<number, EposnowProduct> = new Map();
const mockStock: Map<string, EposnowStock> = new Map(); // key: `${productId}-${locationId}`

// Initialize with sample data
function initializeMockData() {
  const sampleProducts: EposnowProduct[] = [
    {
      Id: 1,
      Name: 'Espresso Beans 1kg',
      Description: 'Premium espresso beans',
      SalePrice: 24.99,
      CostPrice: 12.00,
      Barcode: '1234567890',
      StockLevel: 100,
      CategoryId: 1,
      TaxGroupId: 1,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    },
    {
      Id: 2,
      Name: 'Latte Beans 1kg',
      Description: 'Smooth latte blend',
      SalePrice: 22.99,
      CostPrice: 11.00,
      Barcode: '1234567891',
      StockLevel: 50,
      CategoryId: 1,
      TaxGroupId: 1,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    },
  ];

  sampleProducts.forEach((product) => {
    mockProducts.set(product.Id, product);
    mockStock.set(`${product.Id}-1`, {
      ProductId: product.Id,
      LocationId: 1,
      Quantity: product.StockLevel,
      MinStockLevel: 10,
      ReorderLevel: 20,
    });
  });
}

initializeMockData();

// Mock API handlers
export const mockEposnowApi = {
  // Products
  getProducts: vi.fn(async (): Promise<EposnowApiResponse<EposnowProduct[]>> => {
    return {
      data: Array.from(mockProducts.values()),
      success: true,
    };
  }),

  getProduct: vi.fn(async (productId: number): Promise<EposnowApiResponse<EposnowProduct | null>> => {
    const product = mockProducts.get(productId);
    return {
      data: product || null,
      success: !!product,
      message: product ? undefined : 'Product not found',
    };
  }),

  createProduct: vi.fn(async (productData: Partial<EposnowProduct>): Promise<EposnowApiResponse<EposnowProduct>> => {
    const id = Math.max(...Array.from(mockProducts.keys()), 0) + 1;
    const newProduct: EposnowProduct = {
      Id: id,
      Name: productData.Name || 'New Product',
      Description: productData.Description || '',
      SalePrice: productData.SalePrice || 0,
      CostPrice: productData.CostPrice || 0,
      Barcode: productData.Barcode || '',
      StockLevel: productData.StockLevel || 0,
      CategoryId: productData.CategoryId || 1,
      TaxGroupId: productData.TaxGroupId || 1,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    };

    mockProducts.set(id, newProduct);
    mockStock.set(`${id}-1`, {
      ProductId: id,
      LocationId: 1,
      Quantity: newProduct.StockLevel,
      MinStockLevel: 10,
      ReorderLevel: 20,
    });

    return {
      data: newProduct,
      success: true,
    };
  }),

  updateProduct: vi.fn(async (productId: number, updates: Partial<EposnowProduct>): Promise<EposnowApiResponse<EposnowProduct | null>> => {
    const product = mockProducts.get(productId);
    if (!product) {
      return {
        data: null,
        success: false,
        message: 'Product not found',
      };
    }

    const updatedProduct = {
      ...product,
      ...updates,
      UpdatedAt: new Date().toISOString(),
    };
    mockProducts.set(productId, updatedProduct);

    return {
      data: updatedProduct,
      success: true,
    };
  }),

  deleteProduct: vi.fn(async (productId: number): Promise<EposnowApiResponse<boolean>> => {
    const deleted = mockProducts.delete(productId);
    mockStock.delete(`${productId}-1`);

    return {
      data: deleted,
      success: deleted,
      message: deleted ? undefined : 'Product not found',
    };
  }),

  // Stock
  getStock: vi.fn(async (productId: number, locationId: number = 1): Promise<EposnowApiResponse<EposnowStock | null>> => {
    const stock = mockStock.get(`${productId}-${locationId}`);
    return {
      data: stock || null,
      success: !!stock,
    };
  }),

  updateStock: vi.fn(async (productId: number, quantity: number, locationId: number = 1): Promise<EposnowApiResponse<EposnowStock | null>> => {
    const key = `${productId}-${locationId}`;
    const stock = mockStock.get(key);

    if (!stock) {
      return {
        data: null,
        success: false,
        message: 'Stock record not found',
      };
    }

    const updatedStock = { ...stock, Quantity: quantity };
    mockStock.set(key, updatedStock);

    // Also update product stock level
    const product = mockProducts.get(productId);
    if (product) {
      mockProducts.set(productId, { ...product, StockLevel: quantity, UpdatedAt: new Date().toISOString() });
    }

    return {
      data: updatedStock,
      success: true,
    };
  }),

  adjustStock: vi.fn(async (productId: number, adjustment: number, locationId: number = 1): Promise<EposnowApiResponse<EposnowStock | null>> => {
    const key = `${productId}-${locationId}`;
    const stock = mockStock.get(key);

    if (!stock) {
      return {
        data: null,
        success: false,
        message: 'Stock record not found',
      };
    }

    const newQuantity = Math.max(0, stock.Quantity + adjustment);
    const updatedStock = { ...stock, Quantity: newQuantity };
    mockStock.set(key, updatedStock);

    const product = mockProducts.get(productId);
    if (product) {
      mockProducts.set(productId, { ...product, StockLevel: newQuantity, UpdatedAt: new Date().toISOString() });
    }

    return {
      data: updatedStock,
      success: true,
    };
  }),

  // Webhooks
  registerWebhook: vi.fn(async (url: string, events: string[]): Promise<EposnowApiResponse<{ webhookId: string }>> => {
    return {
      data: { webhookId: `webhook-${Date.now()}` },
      success: true,
    };
  }),

  unregisterWebhook: vi.fn(async (webhookId: string): Promise<EposnowApiResponse<boolean>> => {
    return {
      data: true,
      success: true,
    };
  }),

  // Simulate webhook payload
  simulateWebhook: vi.fn((event: string, productId: number): { event: string; productId: number; stockLevel: number; previousStockLevel: number; timestamp: string } => {
    const product = mockProducts.get(productId);
    return {
      event,
      productId,
      stockLevel: product?.StockLevel || 0,
      previousStockLevel: (product?.StockLevel || 0) + 10,
      timestamp: new Date().toISOString(),
    };
  }),
};

// Error simulation helpers
export const simulateApiError = {
  rateLimit: () => {
    const error = new Error('Rate limit exceeded');
    (error as any).status = 429;
    (error as any).retryAfter = 60;
    throw error;
  },

  unauthorized: () => {
    const error = new Error('Invalid API credentials');
    (error as any).status = 401;
    throw error;
  },

  serverError: () => {
    const error = new Error('Internal server error');
    (error as any).status = 500;
    throw error;
  },

  timeout: () => {
    const error = new Error('Request timeout');
    (error as any).code = 'ETIMEDOUT';
    throw error;
  },
};

// Reset mock state
export function resetMockData() {
  mockProducts.clear();
  mockStock.clear();
  initializeMockData();

  Object.values(mockEposnowApi).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      fn.mockClear();
    }
  });
}

// Export for testing
export { mockProducts, mockStock };
