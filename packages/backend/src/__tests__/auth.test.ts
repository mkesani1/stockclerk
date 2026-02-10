/**
 * Auth Routes Unit Tests
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

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (password: string) => `$2a$12$hashed_${password}`),
    compare: vi.fn(async (password: string, hash: string) => {
      // Simple mock comparison
      return hash.includes('hashed') && password === 'securePassword123!';
    }),
  },
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
import { authRoutes } from '../routes/auth.js';
import bcrypt from 'bcryptjs';
import {
  createMockFastifyInstance,
  createMockRequest,
  createMockReply,
  createAuthenticatedRequest,
} from './utils/mocks.js';
import {
  createTenantFixture,
  createUserFixture,
  validRegisterBody,
  validLoginBody,
} from './utils/fixtures.js';

describe('Auth Routes', () => {
  let mockApp: ReturnType<typeof createMockFastifyInstance>;
  let registeredRoutes: Map<string, { method: string; path: string; handler: Function; options?: any }>;

  beforeEach(() => {
    mockApp = createMockFastifyInstance();
    registeredRoutes = new Map();
    resetHoistedMockDb();

    // Capture route registrations
    mockApp.post = vi.fn((path: string, ...args: any[]) => {
      const handler = args.length === 1 ? args[0] : args[1];
      const options = args.length === 2 ? args[0] : undefined;
      registeredRoutes.set(`POST ${path}`, { method: 'POST', path, handler, options });
    });

    mockApp.get = vi.fn((path: string, ...args: any[]) => {
      const handler = args.length === 1 ? args[0] : args[1];
      const options = args.length === 2 ? args[0] : undefined;
      registeredRoutes.set(`GET ${path}`, { method: 'GET', path, handler, options });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Route Registration', () => {
    it('should register all auth routes', async () => {
      await authRoutes(mockApp as any);

      expect(mockApp.post).toHaveBeenCalledWith('/register', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/login', expect.any(Function));
      expect(mockApp.get).toHaveBeenCalledWith('/me', expect.any(Object), expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/refresh', expect.any(Object), expect.any(Function));
    });
  });

  describe('POST /register', () => {
    it('should successfully register a new tenant and user', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /register');
      expect(route).toBeDefined();

      const tenant = createTenantFixture({ name: validRegisterBody.tenantName, slug: validRegisterBody.tenantSlug });
      const user = createUserFixture({ tenantId: tenant.id, email: validRegisterBody.email, role: 'owner' });

      // Setup mock returns
      mockDb.query.tenants.findFirst.mockResolvedValue(null);
      mockDb.query.users.findFirst.mockResolvedValue(null);
      mockDb.transaction.mockImplementation(async (callback) => {
        return callback({
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              returning: vi.fn()
                .mockResolvedValueOnce([tenant])
                .mockResolvedValueOnce([user]),
            })),
          })),
        });
      });

      const request = createMockRequest({ body: validRegisterBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(201);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Registration successful',
      });
    });

    it('should return 400 for invalid request body', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /register');

      const invalidBody = {
        tenantName: 'T', // Too short
        tenantSlug: 'INVALID SLUG', // Invalid format
        email: 'not-an-email',
        password: '123', // Too short
      };

      const request = createMockRequest({ body: invalidBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Validation error',
      });
    });

    it('should return 409 if tenant slug already exists', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /register');

      mockDb.query.tenants.findFirst.mockResolvedValue(createTenantFixture({ slug: validRegisterBody.tenantSlug }));

      const request = createMockRequest({ body: validRegisterBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(409);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'A tenant with this slug already exists',
      });
    });

    it('should return 409 if email already exists', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /register');

      mockDb.query.tenants.findFirst.mockResolvedValue(null);
      mockDb.query.users.findFirst.mockResolvedValue(createUserFixture({ email: validRegisterBody.email }));

      const request = createMockRequest({ body: validRegisterBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(409);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'A user with this email already exists',
      });
    });
  });

  describe('POST /login', () => {
    it('should successfully login with valid credentials', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /login');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const user = createUserFixture({
        tenantId: tenant.id,
        email: validLoginBody.email,
        passwordHash: '$2a$12$hashed_securePassword123!',
      });

      mockDb.query.users.findFirst.mockResolvedValue({ ...user, tenant });

      const request = createMockRequest({ body: validLoginBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Login successful',
      });
    });

    it('should return 400 for invalid request body', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /login');

      const invalidBody = {
        email: 'not-an-email',
        password: '',
      };

      const request = createMockRequest({ body: invalidBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Validation error',
      });
    });

    it('should return 401 for non-existent user', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /login');

      mockDb.query.users.findFirst.mockResolvedValue(null);

      const request = createMockRequest({ body: validLoginBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    });

    it('should return 401 for incorrect password', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /login');

      const tenant = createTenantFixture();
      const user = createUserFixture({
        tenantId: tenant.id,
        email: validLoginBody.email,
        passwordHash: '$2a$12$different_hash',
      });

      mockDb.query.users.findFirst.mockResolvedValue({ ...user, tenant });
      (bcrypt.compare as any).mockResolvedValueOnce(false);

      const request = createMockRequest({ body: validLoginBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    });
  });

  describe('GET /me', () => {
    it('should return current user data when authenticated', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /me');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const user = createUserFixture({ tenantId: tenant.id });

      mockDb.query.users.findFirst.mockResolvedValue({ ...user, tenant });

      const request = createAuthenticatedRequest({ userId: user.id, tenantId: tenant.id });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
      });
    });

    it('should return 401 when not authenticated', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /me');

      const request = createMockRequest(); // No user attached
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Unauthorized',
      });
    });

    it('should return 404 when user not found', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /me');

      mockDb.query.users.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest();
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Not found',
        message: 'User not found',
      });
    });
  });

  describe('POST /refresh', () => {
    it('should refresh token for authenticated user', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /refresh');
      expect(route).toBeDefined();

      const user = createUserFixture();
      mockDb.query.users.findFirst.mockResolvedValue(user);

      const request = createAuthenticatedRequest({ userId: user.id });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Token refreshed successfully',
      });
    });

    it('should return 401 when user no longer exists', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /refresh');

      mockDb.query.users.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest();
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Unauthorized',
        message: 'User no longer exists',
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully on register', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /register');

      mockDb.query.tenants.findFirst.mockRejectedValue(new Error('Database connection failed'));

      const request = createMockRequest({ body: validRegisterBody });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(500);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Internal server error',
      });
    });

    it('should handle database errors gracefully on login', async () => {
      await authRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /login');

      mockDb.query.users.findFirst.mockRejectedValue(new Error('Database connection failed'));

      const request = createMockRequest({ body: validLoginBody });
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
