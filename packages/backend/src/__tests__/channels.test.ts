/**
 * Channel Routes Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { channelRoutes } from '../routes/channels.js';
import {
  createMockFastifyInstance,
  createMockRequest,
  createMockReply,
  createAuthenticatedRequest,
  mockDb,
  resetMockDb,
} from './utils/mocks.js';
import {
  createTenantFixture,
  createChannelFixture,
  validCreateChannelBody,
} from './utils/fixtures.js';

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

// Mock crypto for encryption
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => Buffer.alloc(size, 'a')),
    createCipheriv: vi.fn(() => ({
      update: vi.fn(() => 'encrypted'),
      final: vi.fn(() => ''),
      getAuthTag: vi.fn(() => Buffer.from('auth-tag-here-1234')),
    })),
    createDecipheriv: vi.fn(() => ({
      setAuthTag: vi.fn(),
      update: vi.fn(() => '{"apiKey": "decrypted-key"}'),
      final: vi.fn(() => ''),
    })),
    scryptSync: vi.fn(() => Buffer.alloc(32, 'k')),
  };
});

describe('Channel Routes', () => {
  let mockApp: ReturnType<typeof createMockFastifyInstance>;
  let registeredRoutes: Map<string, { method: string; path: string; handler: Function; options?: any }>;

  beforeEach(() => {
    mockApp = createMockFastifyInstance();
    registeredRoutes = new Map();
    resetMockDb();

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
    it('should register all channel routes', async () => {
      await channelRoutes(mockApp as any);

      expect(mockApp.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockApp.get).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockApp.patch).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.delete).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/:id/test', expect.any(Function));
    });
  });

  describe('GET /channels', () => {
    it('should list all channels for tenant', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channels = [
        createChannelFixture({ tenantId: tenant.id, type: 'eposnow', name: 'POS System' }),
        createChannelFixture({ tenantId: tenant.id, type: 'wix', name: 'Online Store' }),
        createChannelFixture({ tenantId: tenant.id, type: 'deliveroo', name: 'Delivery App' }),
      ];

      mockDb.query.channels.findMany.mockResolvedValue(channels);

      const request = createAuthenticatedRequest({ tenantId: tenant.id });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
      });
      // Verify credentials are not exposed
      const responseData = (sentData?.body as any).data;
      expect(responseData).toBeDefined();
      responseData.forEach((channel: any) => {
        expect(channel).not.toHaveProperty('credentialsEncrypted');
      });
    });

    it('should return empty array when no channels exist', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');

      mockDb.query.channels.findMany.mockResolvedValue([]);

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

  describe('GET /channels/:id', () => {
    it('should return single channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /:id');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: channel.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
      });
      // Verify credentials are not exposed
      expect((sentData?.body as any).data).not.toHaveProperty('credentialsEncrypted');
    });

    it('should return 404 for non-existent channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /:id');

      mockDb.query.channels.findFirst.mockResolvedValue(null);

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
        message: 'Channel not found',
      });
    });
  });

  describe('POST /channels', () => {
    it('should create a new channel with encrypted credentials', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const newChannel = createChannelFixture({
        tenantId: tenant.id,
        type: validCreateChannelBody.type,
        name: validCreateChannelBody.name,
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([newChannel]),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        body: validCreateChannelBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(201);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Channel created successfully',
      });
    });

    it('should return 400 for invalid channel type', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const invalidBody = {
        type: 'invalid-type',
        name: 'Test Channel',
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

    it('should return 400 for empty channel name', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const invalidBody = {
        type: 'eposnow',
        name: '',
      };

      const request = createAuthenticatedRequest({}, {
        body: invalidBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
    });

    it('should create channel without credentials', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const tenant = createTenantFixture();
      const newChannel = createChannelFixture({
        tenantId: tenant.id,
        type: 'wix',
        name: 'Wix Store',
        credentialsEncrypted: null,
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([newChannel]),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        body: { type: 'wix', name: 'Wix Store' }, // No credentials
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(201);
    });
  });

  describe('PATCH /channels/:id', () => {
    it('should update channel details', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id });
      const updatedChannel = { ...channel, name: 'Updated Channel Name' };

      mockDb.query.channels.findFirst.mockResolvedValue(channel);
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([updatedChannel]),
          })),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: channel.id },
        body: { name: 'Updated Channel Name' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Channel updated successfully',
      });
    });

    it('should update channel credentials', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([channel]),
          })),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: channel.id },
        body: {
          credentials: { apiKey: 'new-api-key', apiSecret: 'new-secret' },
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });

    it('should toggle channel active status', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, isActive: true });
      const updatedChannel = { ...channel, isActive: false };

      mockDb.query.channels.findFirst.mockResolvedValue(channel);
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([updatedChannel]),
          })),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: channel.id },
        body: { isActive: false },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });

    it('should return 404 when updating non-existent channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('PATCH /:id');

      mockDb.query.channels.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
        body: { name: 'New Name' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
    });
  });

  describe('DELETE /channels/:id', () => {
    it('should delete channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('DELETE /:id');
      expect(route).toBeDefined();

      const channel = createChannelFixture();

      mockDb.delete.mockReturnValue({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([channel]),
        })),
      });

      const request = createAuthenticatedRequest({}, {
        params: { id: channel.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Channel deleted successfully',
      });
    });

    it('should return 404 when deleting non-existent channel', async () => {
      await channelRoutes(mockApp as any);
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

  describe('POST /channels/:id/test', () => {
    it('should test channel connection', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /:id/test');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        credentialsEncrypted: 'encrypted-data',
      });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        params: { id: channel.id },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
      });
      expect((sentData?.body as any).data).toMatchObject({
        channelId: channel.id,
        type: channel.type,
        status: 'pending',
      });
    });

    it('should return 404 for non-existent channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /:id/test');

      mockDb.query.channels.findFirst.mockResolvedValue(null);

      const request = createAuthenticatedRequest({}, {
        params: { id: 'non-existent-id' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);
    });
  });

  describe('Credential Encryption', () => {
    it('should encrypt credentials when creating channel', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const tenant = createTenantFixture();
      let storedCredentials: string | null = null;

      mockDb.insert.mockReturnValue({
        values: vi.fn((data) => {
          storedCredentials = data.credentialsEncrypted;
          return {
            returning: vi.fn().mockResolvedValue([{ ...data, id: 'new-id' }]),
          };
        }),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        body: {
          type: 'eposnow',
          name: 'POS Channel',
          credentials: { apiKey: 'secret-key', apiSecret: 'secret-secret' },
        },
      });
      const { reply } = createMockReply();

      await route!.handler(request, reply);

      // Credentials should be encrypted (not stored as plain JSON)
      expect(storedCredentials).not.toContain('secret-key');
    });

    it('should never expose encrypted credentials in responses', async () => {
      await channelRoutes(mockApp as any);

      // Test GET /
      const getListRoute = registeredRoutes.get('GET /');
      const channelWithCreds = createChannelFixture({ credentialsEncrypted: 'encrypted-data' });
      mockDb.query.channels.findMany.mockResolvedValue([channelWithCreds]);

      const listRequest = createAuthenticatedRequest();
      const { reply: listReply, getSentData: getListData } = createMockReply();
      await getListRoute!.handler(listRequest, listReply);

      const listData = getListData();
      expect((listData?.body as any).data[0]).not.toHaveProperty('credentialsEncrypted');

      // Test GET /:id
      const getOneRoute = registeredRoutes.get('GET /:id');
      mockDb.query.channels.findFirst.mockResolvedValue(channelWithCreds);

      const oneRequest = createAuthenticatedRequest({}, { params: { id: channelWithCreds.id } });
      const { reply: oneReply, getSentData: getOneData } = createMockReply();
      await getOneRoute!.handler(oneRequest, oneReply);

      const oneData = getOneData();
      expect((oneData?.body as any).data).not.toHaveProperty('credentialsEncrypted');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /');

      mockDb.query.channels.findMany.mockRejectedValue(new Error('Database error'));

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

    it('should handle encryption errors gracefully', async () => {
      await channelRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /');

      const tenant = createTenantFixture();

      mockDb.insert.mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(new Error('Encryption failed')),
        })),
      });

      const request = createAuthenticatedRequest({ tenantId: tenant.id }, {
        body: validCreateChannelBody,
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(500);
    });
  });
});
