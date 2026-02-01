/**
 * Mock Wix API Server
 * Simulates Wix eCommerce API responses for testing
 */

import { vi } from 'vitest';

// Types
export interface WixProduct {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  productType: 'physical' | 'digital';
  description: string;
  sku: string;
  price: {
    amount: string;
    currency: string;
  };
  stock: {
    trackInventory: boolean;
    quantity: number;
    inStock: boolean;
  };
  media: {
    mainMedia: {
      image: {
        url: string;
      };
    };
  };
  createdDate: string;
  lastUpdatedDate: string;
}

export interface WixInventoryItem {
  id: string;
  productId: string;
  variantId?: string;
  trackQuantity: boolean;
  quantity: number;
  inStock: boolean;
  lastUpdatedDate: string;
}

export interface WixApiResponse<T> {
  data: T;
}

export interface WixPagedResponse<T> {
  items: T[];
  metadata: {
    count: number;
    offset: number;
    total: number;
  };
}

// Mock data store
const mockProducts: Map<string, WixProduct> = new Map();
const mockInventory: Map<string, WixInventoryItem> = new Map();

// Initialize with sample data
function initializeMockData() {
  const sampleProducts: WixProduct[] = [
    {
      id: 'wix-prod-001',
      name: 'Espresso Beans 1kg',
      slug: 'espresso-beans-1kg',
      visible: true,
      productType: 'physical',
      description: 'Premium espresso beans',
      sku: 'SKU-001',
      price: {
        amount: '24.99',
        currency: 'GBP',
      },
      stock: {
        trackInventory: true,
        quantity: 100,
        inStock: true,
      },
      media: {
        mainMedia: {
          image: {
            url: 'https://example.com/espresso.jpg',
          },
        },
      },
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString(),
    },
    {
      id: 'wix-prod-002',
      name: 'Latte Beans 1kg',
      slug: 'latte-beans-1kg',
      visible: true,
      productType: 'physical',
      description: 'Smooth latte blend',
      sku: 'SKU-002',
      price: {
        amount: '22.99',
        currency: 'GBP',
      },
      stock: {
        trackInventory: true,
        quantity: 50,
        inStock: true,
      },
      media: {
        mainMedia: {
          image: {
            url: 'https://example.com/latte.jpg',
          },
        },
      },
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString(),
    },
  ];

  sampleProducts.forEach((product) => {
    mockProducts.set(product.id, product);
    mockInventory.set(product.id, {
      id: `inv-${product.id}`,
      productId: product.id,
      trackQuantity: product.stock.trackInventory,
      quantity: product.stock.quantity,
      inStock: product.stock.inStock,
      lastUpdatedDate: product.lastUpdatedDate,
    });
  });
}

initializeMockData();

// Mock API handlers
export const mockWixApi = {
  // Products
  queryProducts: vi.fn(async (query?: { filter?: Record<string, unknown> }): Promise<WixPagedResponse<WixProduct>> => {
    const products = Array.from(mockProducts.values());
    return {
      items: products,
      metadata: {
        count: products.length,
        offset: 0,
        total: products.length,
      },
    };
  }),

  getProduct: vi.fn(async (productId: string): Promise<WixApiResponse<WixProduct | null>> => {
    return {
      data: mockProducts.get(productId) || null,
    };
  }),

  createProduct: vi.fn(async (productData: Partial<WixProduct>): Promise<WixApiResponse<WixProduct>> => {
    const id = `wix-prod-${Date.now()}`;
    const newProduct: WixProduct = {
      id,
      name: productData.name || 'New Product',
      slug: productData.slug || `product-${id}`,
      visible: productData.visible ?? true,
      productType: productData.productType || 'physical',
      description: productData.description || '',
      sku: productData.sku || id,
      price: productData.price || { amount: '0', currency: 'GBP' },
      stock: productData.stock || { trackInventory: true, quantity: 0, inStock: false },
      media: productData.media || { mainMedia: { image: { url: '' } } },
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString(),
    };

    mockProducts.set(id, newProduct);
    mockInventory.set(id, {
      id: `inv-${id}`,
      productId: id,
      trackQuantity: newProduct.stock.trackInventory,
      quantity: newProduct.stock.quantity,
      inStock: newProduct.stock.inStock,
      lastUpdatedDate: newProduct.lastUpdatedDate,
    });

    return { data: newProduct };
  }),

  updateProduct: vi.fn(async (productId: string, updates: Partial<WixProduct>): Promise<WixApiResponse<WixProduct | null>> => {
    const product = mockProducts.get(productId);
    if (!product) {
      return { data: null };
    }

    const updatedProduct = {
      ...product,
      ...updates,
      lastUpdatedDate: new Date().toISOString(),
    };
    mockProducts.set(productId, updatedProduct);

    return { data: updatedProduct };
  }),

  deleteProduct: vi.fn(async (productId: string): Promise<WixApiResponse<boolean>> => {
    const deleted = mockProducts.delete(productId);
    mockInventory.delete(productId);
    return { data: deleted };
  }),

  // Inventory
  getInventoryItems: vi.fn(async (): Promise<WixPagedResponse<WixInventoryItem>> => {
    const items = Array.from(mockInventory.values());
    return {
      items,
      metadata: {
        count: items.length,
        offset: 0,
        total: items.length,
      },
    };
  }),

  getInventoryItem: vi.fn(async (productId: string): Promise<WixApiResponse<WixInventoryItem | null>> => {
    return {
      data: mockInventory.get(productId) || null,
    };
  }),

  updateInventory: vi.fn(async (productId: string, quantity: number): Promise<WixApiResponse<WixInventoryItem | null>> => {
    const inventory = mockInventory.get(productId);
    if (!inventory) {
      return { data: null };
    }

    const updatedInventory: WixInventoryItem = {
      ...inventory,
      quantity,
      inStock: quantity > 0,
      lastUpdatedDate: new Date().toISOString(),
    };
    mockInventory.set(productId, updatedInventory);

    // Also update product stock
    const product = mockProducts.get(productId);
    if (product) {
      mockProducts.set(productId, {
        ...product,
        stock: {
          ...product.stock,
          quantity,
          inStock: quantity > 0,
        },
        lastUpdatedDate: new Date().toISOString(),
      });
    }

    return { data: updatedInventory };
  }),

  incrementInventory: vi.fn(async (productId: string, incrementBy: number): Promise<WixApiResponse<WixInventoryItem | null>> => {
    const inventory = mockInventory.get(productId);
    if (!inventory) {
      return { data: null };
    }

    const newQuantity = Math.max(0, inventory.quantity + incrementBy);
    return mockWixApi.updateInventory(productId, newQuantity);
  }),

  decrementInventory: vi.fn(async (productId: string, decrementBy: number): Promise<WixApiResponse<WixInventoryItem | null>> => {
    const inventory = mockInventory.get(productId);
    if (!inventory) {
      return { data: null };
    }

    const newQuantity = Math.max(0, inventory.quantity - decrementBy);
    return mockWixApi.updateInventory(productId, newQuantity);
  }),

  // OAuth / Auth
  getAccessToken: vi.fn(async (refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> => {
    return {
      accessToken: `wix-access-token-${Date.now()}`,
      expiresIn: 3600,
    };
  }),

  // Webhooks
  registerWebhook: vi.fn(async (appId: string, eventType: string, callbackUrl: string): Promise<{ webhookId: string }> => {
    return {
      webhookId: `wix-webhook-${Date.now()}`,
    };
  }),

  // Simulate webhook payload
  simulateWebhook: vi.fn((eventType: string, productId: string): { eventType: string; instanceId: string; data: Record<string, unknown>; timestamp: string } => {
    const product = mockProducts.get(productId);
    const inventory = mockInventory.get(productId);

    return {
      eventType,
      instanceId: 'wix-instance-test-123',
      data: {
        productId,
        product: product || null,
        inventory: inventory ? {
          quantity: inventory.quantity,
          trackQuantity: inventory.trackQuantity,
        } : null,
      },
      timestamp: new Date().toISOString(),
    };
  }),
};

// Error simulation helpers
export const simulateWixError = {
  unauthorized: () => {
    const error = new Error('Unauthorized - Invalid access token');
    (error as any).status = 401;
    (error as any).code = 'UNAUTHORIZED';
    throw error;
  },

  forbidden: () => {
    const error = new Error('Forbidden - Insufficient permissions');
    (error as any).status = 403;
    (error as any).code = 'FORBIDDEN';
    throw error;
  },

  notFound: () => {
    const error = new Error('Resource not found');
    (error as any).status = 404;
    (error as any).code = 'NOT_FOUND';
    throw error;
  },

  rateLimit: () => {
    const error = new Error('Rate limit exceeded');
    (error as any).status = 429;
    (error as any).code = 'RATE_LIMIT_EXCEEDED';
    (error as any).retryAfter = 60;
    throw error;
  },

  serverError: () => {
    const error = new Error('Internal server error');
    (error as any).status = 500;
    (error as any).code = 'INTERNAL_ERROR';
    throw error;
  },
};

// Reset mock state
export function resetMockData() {
  mockProducts.clear();
  mockInventory.clear();
  initializeMockData();

  Object.values(mockWixApi).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      fn.mockClear();
    }
  });
}

// Export for testing
export { mockProducts, mockInventory };
