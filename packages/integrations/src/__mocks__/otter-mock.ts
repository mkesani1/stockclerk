/**
 * Mock Otter/Deliveroo API Server
 * Simulates Otter API responses for Deliveroo integration testing
 */

import { vi } from 'vitest';

// Types
export interface OtterMenuItem {
  id: string;
  externalId?: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  available: boolean;
  quantity?: number;
  modifiers: OtterModifier[];
  categoryId: string;
  imageUrl?: string;
  nutritionalInfo?: {
    calories?: number;
    allergens?: string[];
  };
}

export interface OtterModifier {
  id: string;
  name: string;
  price: number;
  available: boolean;
}

export interface OtterCategory {
  id: string;
  name: string;
  description?: string;
  items: string[]; // Item IDs
  sortOrder: number;
}

export interface OtterMenu {
  id: string;
  restaurantId: string;
  name: string;
  categories: OtterCategory[];
  lastUpdated: string;
}

export interface OtterApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// Mock data store
const mockMenuItems: Map<string, OtterMenuItem> = new Map();
const mockCategories: Map<string, OtterCategory> = new Map();
const mockMenu: OtterMenu | null = null;

// Initialize with sample data
function initializeMockData() {
  const sampleCategories: OtterCategory[] = [
    {
      id: 'cat-hot-drinks',
      name: 'Hot Drinks',
      description: 'Freshly made hot beverages',
      items: ['item-espresso', 'item-latte'],
      sortOrder: 1,
    },
    {
      id: 'cat-food',
      name: 'Food',
      description: 'Light bites and snacks',
      items: ['item-croissant'],
      sortOrder: 2,
    },
  ];

  const sampleItems: OtterMenuItem[] = [
    {
      id: 'item-espresso',
      externalId: 'espresso-001',
      name: 'Espresso',
      description: 'Double shot espresso',
      price: 2.50,
      currency: 'GBP',
      available: true,
      quantity: 100,
      modifiers: [
        { id: 'mod-extra-shot', name: 'Extra Shot', price: 0.50, available: true },
      ],
      categoryId: 'cat-hot-drinks',
      imageUrl: 'https://example.com/espresso.jpg',
      nutritionalInfo: {
        calories: 5,
        allergens: [],
      },
    },
    {
      id: 'item-latte',
      externalId: 'latte-001',
      name: 'Latte',
      description: 'Creamy latte with steamed milk',
      price: 3.50,
      currency: 'GBP',
      available: true,
      quantity: 50,
      modifiers: [
        { id: 'mod-oat-milk', name: 'Oat Milk', price: 0.40, available: true },
        { id: 'mod-soy-milk', name: 'Soy Milk', price: 0.40, available: true },
      ],
      categoryId: 'cat-hot-drinks',
      imageUrl: 'https://example.com/latte.jpg',
      nutritionalInfo: {
        calories: 150,
        allergens: ['milk'],
      },
    },
    {
      id: 'item-croissant',
      externalId: 'croissant-001',
      name: 'Butter Croissant',
      description: 'Freshly baked butter croissant',
      price: 2.00,
      currency: 'GBP',
      available: true,
      quantity: 20,
      modifiers: [],
      categoryId: 'cat-food',
      imageUrl: 'https://example.com/croissant.jpg',
      nutritionalInfo: {
        calories: 320,
        allergens: ['wheat', 'milk', 'eggs'],
      },
    },
  ];

  sampleCategories.forEach((cat) => mockCategories.set(cat.id, cat));
  sampleItems.forEach((item) => mockMenuItems.set(item.id, item));
}

initializeMockData();

// Mock API handlers
export const mockOtterApi = {
  // Menu Items
  getMenuItems: vi.fn(async (restaurantId: string): Promise<OtterApiResponse<OtterMenuItem[]>> => {
    return {
      success: true,
      data: Array.from(mockMenuItems.values()),
    };
  }),

  getMenuItem: vi.fn(async (restaurantId: string, itemId: string): Promise<OtterApiResponse<OtterMenuItem | null>> => {
    const item = mockMenuItems.get(itemId);
    return {
      success: !!item,
      data: item || null,
      error: item ? undefined : { code: 'NOT_FOUND', message: 'Item not found' },
    };
  }),

  getMenuItemByExternalId: vi.fn(async (restaurantId: string, externalId: string): Promise<OtterApiResponse<OtterMenuItem | null>> => {
    const item = Array.from(mockMenuItems.values()).find((i) => i.externalId === externalId);
    return {
      success: !!item,
      data: item || null,
    };
  }),

  updateMenuItem: vi.fn(async (restaurantId: string, itemId: string, updates: Partial<OtterMenuItem>): Promise<OtterApiResponse<OtterMenuItem | null>> => {
    const item = mockMenuItems.get(itemId);
    if (!item) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Item not found' },
      };
    }

    const updatedItem = { ...item, ...updates };
    mockMenuItems.set(itemId, updatedItem);

    return {
      success: true,
      data: updatedItem,
    };
  }),

  // Availability
  setItemAvailability: vi.fn(async (restaurantId: string, itemId: string, available: boolean): Promise<OtterApiResponse<OtterMenuItem | null>> => {
    const item = mockMenuItems.get(itemId);
    if (!item) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Item not found' },
      };
    }

    const updatedItem = { ...item, available };
    mockMenuItems.set(itemId, updatedItem);

    return {
      success: true,
      data: updatedItem,
    };
  }),

  setItemQuantity: vi.fn(async (restaurantId: string, itemId: string, quantity: number): Promise<OtterApiResponse<OtterMenuItem | null>> => {
    const item = mockMenuItems.get(itemId);
    if (!item) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Item not found' },
      };
    }

    const available = quantity > 0;
    const updatedItem = { ...item, quantity, available };
    mockMenuItems.set(itemId, updatedItem);

    return {
      success: true,
      data: updatedItem,
    };
  }),

  bulkSetAvailability: vi.fn(async (restaurantId: string, items: { itemId: string; available: boolean }[]): Promise<OtterApiResponse<{ updated: number; failed: number }>> => {
    let updated = 0;
    let failed = 0;

    for (const { itemId, available } of items) {
      const item = mockMenuItems.get(itemId);
      if (item) {
        mockMenuItems.set(itemId, { ...item, available });
        updated++;
      } else {
        failed++;
      }
    }

    return {
      success: true,
      data: { updated, failed },
    };
  }),

  // Categories
  getCategories: vi.fn(async (restaurantId: string): Promise<OtterApiResponse<OtterCategory[]>> => {
    return {
      success: true,
      data: Array.from(mockCategories.values()),
    };
  }),

  // Menu
  getMenu: vi.fn(async (restaurantId: string): Promise<OtterApiResponse<OtterMenu>> => {
    return {
      success: true,
      data: {
        id: 'menu-main',
        restaurantId,
        name: 'Main Menu',
        categories: Array.from(mockCategories.values()),
        lastUpdated: new Date().toISOString(),
      },
    };
  }),

  publishMenu: vi.fn(async (restaurantId: string): Promise<OtterApiResponse<{ published: boolean }>> => {
    return {
      success: true,
      data: { published: true },
    };
  }),

  // Modifiers
  setModifierAvailability: vi.fn(async (restaurantId: string, itemId: string, modifierId: string, available: boolean): Promise<OtterApiResponse<OtterModifier | null>> => {
    const item = mockMenuItems.get(itemId);
    if (!item) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Item not found' },
      };
    }

    const modifierIndex = item.modifiers.findIndex((m) => m.id === modifierId);
    if (modifierIndex === -1) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Modifier not found' },
      };
    }

    const updatedModifiers = [...item.modifiers];
    updatedModifiers[modifierIndex] = { ...updatedModifiers[modifierIndex], available };
    mockMenuItems.set(itemId, { ...item, modifiers: updatedModifiers });

    return {
      success: true,
      data: updatedModifiers[modifierIndex],
    };
  }),

  // Webhooks
  registerWebhook: vi.fn(async (restaurantId: string, eventType: string, callbackUrl: string): Promise<OtterApiResponse<{ webhookId: string }>> => {
    return {
      success: true,
      data: { webhookId: `otter-webhook-${Date.now()}` },
    };
  }),

  unregisterWebhook: vi.fn(async (webhookId: string): Promise<OtterApiResponse<boolean>> => {
    return {
      success: true,
      data: true,
    };
  }),

  // Simulate webhook payload
  simulateWebhook: vi.fn((eventType: string, itemId: string): {
    type: string;
    restaurantId: string;
    payload: {
      itemId: string;
      externalId?: string;
      available: boolean;
      quantity?: number;
    };
    timestamp: string;
  } => {
    const item = mockMenuItems.get(itemId);

    return {
      type: eventType,
      restaurantId: 'rest-test-123',
      payload: {
        itemId,
        externalId: item?.externalId,
        available: item?.available ?? false,
        quantity: item?.quantity,
      },
      timestamp: new Date().toISOString(),
    };
  }),

  // Store Status
  getStoreStatus: vi.fn(async (restaurantId: string): Promise<OtterApiResponse<{ open: boolean; acceptingOrders: boolean }>> => {
    return {
      success: true,
      data: { open: true, acceptingOrders: true },
    };
  }),

  setStoreStatus: vi.fn(async (restaurantId: string, open: boolean): Promise<OtterApiResponse<{ open: boolean }>> => {
    return {
      success: true,
      data: { open },
    };
  }),
};

// Error simulation helpers
export const simulateOtterError = {
  unauthorized: () => {
    const error = new Error('Invalid API key');
    (error as any).status = 401;
    (error as any).code = 'UNAUTHORIZED';
    throw error;
  },

  forbidden: () => {
    const error = new Error('Access denied to this restaurant');
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

  conflict: () => {
    const error = new Error('Menu update conflict');
    (error as any).status = 409;
    (error as any).code = 'CONFLICT';
    throw error;
  },

  rateLimit: () => {
    const error = new Error('Rate limit exceeded');
    (error as any).status = 429;
    (error as any).code = 'RATE_LIMIT_EXCEEDED';
    (error as any).retryAfter = 30;
    throw error;
  },

  serverError: () => {
    const error = new Error('Otter service unavailable');
    (error as any).status = 503;
    (error as any).code = 'SERVICE_UNAVAILABLE';
    throw error;
  },

  menuLocked: () => {
    const error = new Error('Menu is currently locked for editing');
    (error as any).status = 423;
    (error as any).code = 'MENU_LOCKED';
    throw error;
  },
};

// Reset mock state
export function resetMockData() {
  mockMenuItems.clear();
  mockCategories.clear();
  initializeMockData();

  Object.values(mockOtterApi).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      fn.mockClear();
    }
  });
}

// Export for testing
export { mockMenuItems, mockCategories };
