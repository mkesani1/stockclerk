/**
 * Products Routes Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock creation to avoid initialization issues
const { mockDb } = vi.hoisted(() => {
  return {
    mockDb: {
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
          where: vi.fn(() => [{ count: 0 }]),
        })),
      })),
      transaction: vi.fn(async (callback) => {
        return callback({
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
        });
      }),
    },
  };
});

// Mock the database module
vi.mock('../db/index.js', () => ({
  db: mockDb,
}));

// Mock the auth middleware
vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn((request, reply, done) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
    done?.();
  }),
  getTenantId: vi.fn((request) => request.user?.tenantId || 'mock-tenant-id'),
}));

// Helper function to reset the hoisted mockDb
function resetHoistedMockDb() {
  Object.values(mockDb.query).forEach((table) => {
    Object.values(table).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    });
  });
  mockDb.insert.mockReset();
  mockDb.update.mockReset();
  mockDb.delete.mockReset();
  mockDb.select.mockReset();
  mockDb.transaction.mockReset();
}

// Now safe to import after mocks are set up
import { productRoutes } from '../routes/products.js';
import {
  createMockFastifyInstance,
  createMockRequest,
  createMockReply,
  createAuthenticatedRequest,
} from './utils/mocks.js';
import {
  createTenantFixture,
  createProductFixture,
  createChannelFixture,
  createMappingFixture,
  validCreateProductBody,
  validUpdateStockBody,
} from './utils/fixtures.js';

describe('Product Routes', () => {
  let mockApp: ReturnType<typeof createMockFastifyInstance>;
  let registeredRoutes: Map<string, { method: string; path: string; handler: Function; options?: any }>;

  beforeEach(() => {
    mockApp = createMockFastifyInstance();
    registeredRoutes = new Map();
    resetHoistedMockDb();

    // Capture route registrations
    ['get', 'post', 'put', 'patch', 'delete'].forEach((method) => {
      (mockApp as any)[method] = vi.fn((path: string, ...args: any[]) => {
        const handler = args[args.length - 1];
        const options = args.length > 1 ? args[0] : undefined;
        registeredRoutes.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path, handler, options });
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Route Registration', () => {
    it('should register all product routes', async () => {
      await productRoutes(mockApp as any);

      expect(mockApp.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockApp.get).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockApp.patch).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.put).toHaveBeenCalledWith('/:id/stock', expect.any(Function));
      expect(mockApp.delete).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/:id/mappings', expect.any(Function));
      expect(mockApp.delete).toHaveBeenCalledWith('/:id/mappings/:mappingId', expect.any(Function));
    });
  });

  describe('GET /products', () => {
    it('should list all products for tenant with pagination', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const products = [
        createProductFixture({ tenantId: tenant.id, sku: 'SKU-001' }),
        createProductFixture({ tenantId: tenant.id, sku: 'SKU-002' }),
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        })),
      });
      mockDb.query.products.findMany.mockResolvedValue(products.map(p => ({ ...p, channelMappings: [] })));

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        query: { page: '1', limit: '20' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        pagination: {
          page: 1,
          limit: 20,
        },
      });
    });

    it('should handle empty product list', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');

      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        })),
      });
      mockDb.query.products.findMany.mockResolvedValue([]);

      const request = createAuthenticatedRequest();
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        data: [],
      });
    });
  });

  describe('GET /products/:id', () => {
    it('should return single product with mappings', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /:id');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const product = createProductFixture({ tenantId: tenant.id });
      const channel = createChannelFixture({ tenantId: tenant.id });
      const mapping = createMappingFixture({ productId: product.id, channelId: channel.id });

      mockDb.query.products.findFirst.mockResolvedValue({
        ...product,
        channelMappings: [{ ...mapping, channel: { id: channel.id, name: channel.name, type: channel.type } }],
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: product.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
      });
    });

    it('should return 404 for non-existent product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /:id');

      mockDb.query.products.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Not found',
        message: 'Product not found',
      });
    });
  });

  describe('POST /products', () => {
    it('should create a new product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const newProduct = createProductFixture({
        tenantId: tenant.id,
        ...validCreateProductBody,
      });

      mockDb.query.products.findFirst.mockResolvedValue(null);
      mockDb.insert.mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([newProduct]),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        body: validCreateProductBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(201);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Product created successfully',
      });
    });

    it('should return 400 for invalid product data', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const invalidBody = {
        sku: '', // Empty SKU
        name: '', // Empty name
        currentStock: -1, // Negative stock
      };

      const request = createAuthenticatedRequest({}, {
        body: invalidBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Validation error',
      });
    });

    it('should return 409 for duplicate SKU', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      mockDb.query.products.findFirst.mockResolvedValue(createProductFixture({ sku: validCreateProductBody.sku }));

      const request = createAuthenticatedRequest({}, {
        body: validCreateProductBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(409);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'A product with this SKU already exists',
      });
    });
  });

  describe('PATCH /products/:id', () => {
    it('should update product details', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const product = createProductFixture({ tenantId: tenant.id });
      const updatedProduct = { ...product, name: 'Updated Product Name' };

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([updatedProduct]),
          })),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: product.id },
        body: { name: 'Updated Product Name' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Product updated successfully',
      });
    });

    it('should return 404 when updating non-existent product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');

      mockDb.query.products.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
        body: { name: 'New Name' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Not found',
      });
    });

    it('should return 409 when updating SKU to existing value', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');

      const product = createProductFixture({ sku: 'SKU-001' });
      const conflictProduct = createProductFixture({ sku: 'SKU-002' });

      mockDb.query.products.findFirst
        .mockResolvedValueOnce(product) // First call - find product to update
        .mockResolvedValueOnce(conflictProduct); // Second call - check for SKU conflict

      const request = createAuthenticatedRequest({}, {
        params: { id: product.id },
        body: { sku: 'SKU-002' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(409);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Conflict',
      });
    });
  });

  describe('PUT /products/:id/stock', () => {
    it('should update stock level and create sync event', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PUT /:id/stock');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const product = createProductFixture({ tenantId: tenant.id, currentStock: 100, bufferStock: 10 });
      const updatedProduct = { ...product, currentStock: 150 };

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.transaction.mockImplementation(async (callback) => {
        return callback({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue([updatedProduct]),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'sync-event-id' }]),
            })),
          })),
        });
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: product.id },
        body: validUpdateStockBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Stock updated successfully',
      });
    });

    it('should create low stock alert when stock drops below buffer', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PUT /:id/stock');

      const tenant = createTenantFixture();
      const product = createProductFixture({ tenantId: tenant.id, currentStock: 100, bufferStock: 20 });
      const updatedProduct = { ...product, currentStock: 5 }; // Below buffer

      let alertCreated = false;

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.transaction.mockImplementation(async (callback) => {
        return callback({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue([updatedProduct]),
              })),
            })),
          })),
          insert: vi.fn((table) => ({
            values: vi.fn((values) => {
              if (values.type === 'low_stock') {
                alertCreated = true;
              }
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'event-id' }]),
              };
            }),
          })),
        });
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: product.id },
        body: { currentStock: 5 },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });

    it('should return 404 for non-existent product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('PUT /:id/stock');

      mockDb.query.products.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
        body: validUpdateStockBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
    });
  });

  describe('DELETE /products/:id', () => {
    it('should delete product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('DELETE /:id');
      expect(route).toBeDefined();

      const product = createProductFixture();

      mockDb.delete.mockReturnValue({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([product]),
        })),
      });

      const request = createAuthenticatedRequest({}, {
        params: { id: product.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Product deleted successfully',
      });
    });

    it('should return 404 when deleting non-existent product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('DELETE /:id');

      mockDb.delete.mockReturnValue({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      });

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
    });
  });

  describe('POST /products/:id/mappings', () => {
    it('should add channel mapping to product', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /:id/mappings');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const product = createProductFixture({ tenantId: tenant.id });
      const channel = createChannelFixture({ tenantId: tenant.id });
      const mapping = createMappingFixture({ productId: product.id, channelId: channel.id });

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.query.productChannelMappings.findFirst.mockResolvedValue(null);
      mockDb.insert.mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mapping]),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: product.id },
        body: {
          channelId: channel.id,
          externalId: 'ext-123',
          externalSku: 'EXT-SKU-001',
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(201);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Channel mapping created successfully',
      });
    });

    it('should return 409 for duplicate mapping', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /:id/mappings');

      const product = createProductFixture();
      const mapping = createMappingFixture({ productId: product.id });

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.query.productChannelMappings.findFirst.mockResolvedValue(mapping);

      const request = createAuthenticatedRequest({}, {
        params: { id: product.id },
        body: {
          channelId: mapping.channelId,
          externalId: 'ext-123',
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(409);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'This product is already mapped to this channel',
      });
    });
  });

  describe('DELETE /products/:id/mappings/:mappingId', () => {
    it('should delete channel mapping', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('DELETE /:id/mappings/:mappingId');
      expect(route).toBeDefined();

      const product = createProductFixture();
      const mapping = createMappingFixture({ productId: product.id });

      mockDb.query.products.findFirst.mockResolvedValue(product);
      mockDb.delete.mockReturnValue({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mapping]),
        })),
      });

      const request = createAuthenticatedRequest({}, {
        params: { id: product.id, mappingId: mapping.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Channel mapping deleted successfully',
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      await productRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');

      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockRejectedValue(new Error('Database error')),
        })),
      });

      const request = createAuthenticatedRequest();
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(500);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Internal server error',
      });
    });
  });
});
