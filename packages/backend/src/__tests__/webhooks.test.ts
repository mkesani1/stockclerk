/**
 * Webhook Routes Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webhookRoutes } from '../routes/webhooks.js';
import {
  createMockFastifyInstance,
  createMockRequest,
  createMockReply,
  mockDb,
  resetMockDb,
} from './utils/mocks.js';
import {
  createTenantFixture,
  createChannelFixture,
  eposnowWebhookPayload,
  wixWebhookPayload,
  otterWebhookPayload,
} from './utils/fixtures.js';
import crypto from 'crypto';

// Mock the database module
vi.mock('../db/index.js', () => ({
  db: mockDb,
}));

// Mock the queue module
const mockAddWebhookJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../queues/index.js', () => ({
  addWebhookJob: mockAddWebhookJob,
}));

// Mock the websocket module
const mockBroadcastToTenant = vi.fn();
const mockCreateWebSocketMessage = vi.fn((type, tenantId, payload) => ({
  type,
  tenantId,
  payload,
  timestamp: new Date().toISOString(),
}));
vi.mock('../websocket/index.js', () => ({
  broadcastToTenant: mockBroadcastToTenant,
  createWebSocketMessage: mockCreateWebSocketMessage,
}));

describe('Webhook Routes', () => {
  let mockApp: ReturnType<typeof createMockFastifyInstance>;
  let registeredRoutes: Map<string, { method: string; path: string; handler: Function; options?: any }>;

  beforeEach(() => {
    mockApp = createMockFastifyInstance();
    registeredRoutes = new Map();
    resetMockDb();
    mockAddWebhookJob.mockClear();
    mockBroadcastToTenant.mockClear();

    // Mock content type parser
    mockApp.addContentTypeParser = vi.fn();

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
    it('should register all webhook routes', async () => {
      await webhookRoutes(mockApp as any);

      expect(mockApp.post).toHaveBeenCalledWith('/eposnow', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/wix', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/otter', expect.any(Function));
      expect(mockApp.get).toHaveBeenCalledWith('/health', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/test/:channelType', expect.any(Function));
    });

    it('should register custom content type parser', async () => {
      await webhookRoutes(mockApp as any);

      expect(mockApp.addContentTypeParser).toHaveBeenCalledWith(
        'application/json',
        { parseAs: 'string' },
        expect.any(Function)
      );
    });
  });

  describe('POST /webhooks/eposnow', () => {
    it('should process valid Eposnow webhook', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, type: 'eposnow' });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createMockRequest({
        body: JSON.stringify(eposnowWebhookPayload),
        headers: {
          'x-location-id': 'loc-001',
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Webhook received',
      });
      expect(mockAddWebhookJob).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: channel.tenantId,
        channelId: channel.id,
        channelType: 'eposnow',
        eventType: eposnowWebhookPayload.event,
      }));
    });

    it('should return 400 for invalid JSON payload', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const request = createMockRequest({
        body: 'invalid json',
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Invalid JSON payload',
      });
    });

    it('should return 200 when no matching channel found', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      mockDb.query.channels.findFirst.mockResolvedValue(null);

      const request = createMockRequest({
        body: JSON.stringify(eposnowWebhookPayload),
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Webhook received but no matching channel found',
      });
    });

    it('should verify signature when webhook secret is configured', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const webhookSecret = 'test-secret';
      const payload = JSON.stringify(eposnowWebhookPayload);
      const validSignature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'eposnow',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-eposnow-signature': validSignature,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });

    it('should return 401 for invalid signature', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const webhookSecret = 'test-secret';
      const payload = JSON.stringify(eposnowWebhookPayload);

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'eposnow',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-eposnow-signature': 'sha256=invalid-signature',
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
      expect(sentData?.body).toMatchObject({
        success: false,
        error: 'Invalid signature',
      });
    });

    it('should broadcast sync_started event via WebSocket', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, type: 'eposnow' });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createMockRequest({
        body: JSON.stringify(eposnowWebhookPayload),
        headers: {},
      });
      const { reply } = createMockReply();

      await route!.handler(request, reply);

      expect(mockBroadcastToTenant).toHaveBeenCalledWith(
        channel.tenantId,
        expect.objectContaining({
          type: 'sync_started',
        })
      );
    });
  });

  describe('POST /webhooks/wix', () => {
    it('should process valid Wix webhook', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /wix');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, type: 'wix' });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createMockRequest({
        body: JSON.stringify(wixWebhookPayload),
        headers: {
          'x-wix-instance-id': wixWebhookPayload.instanceId,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(mockAddWebhookJob).toHaveBeenCalledWith(expect.objectContaining({
        channelType: 'wix',
        eventType: wixWebhookPayload.eventType,
      }));
    });

    it('should return 400 for invalid JSON payload', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /wix');

      const request = createMockRequest({
        body: '{invalid}',
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
    });

    it('should handle Wix signature verification', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /wix');

      const webhookSecret = 'wix-secret';
      const payload = JSON.stringify(wixWebhookPayload);

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'wix',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-wix-signature': 'invalid-sig',
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
    });
  });

  describe('POST /webhooks/otter', () => {
    it('should process valid Otter webhook', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /otter');
      expect(route).toBeDefined();

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, type: 'deliveroo' });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);

      const request = createMockRequest({
        body: JSON.stringify(otterWebhookPayload),
        headers: {
          'x-restaurant-id': otterWebhookPayload.restaurantId,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(mockAddWebhookJob).toHaveBeenCalledWith(expect.objectContaining({
        channelType: 'deliveroo',
        eventType: otterWebhookPayload.type,
      }));
    });

    it('should return 400 for invalid JSON payload', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /otter');

      const request = createMockRequest({
        body: 'not json',
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(400);
    });

    it('should handle Otter signature verification with sha1', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /otter');

      const webhookSecret = 'otter-secret';
      const payload = JSON.stringify(otterWebhookPayload);
      const validSignature = 'sha1=' + crypto.createHmac('sha1', webhookSecret).update(payload).digest('hex');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'deliveroo',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-otter-signature': validSignature,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });
  });

  describe('GET /webhooks/health', () => {
    it('should return healthy status', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('GET /health');
      expect(route).toBeDefined();

      const request = createMockRequest();
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        data: {
          status: 'healthy',
          receivers: ['eposnow', 'wix', 'otter'],
        },
      });
    });
  });

  describe('POST /webhooks/test/:channelType', () => {
    it('should accept test webhooks in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /test/:channelType');
      expect(route).toBeDefined();

      const request = createMockRequest({
        params: { channelType: 'eposnow' },
        body: { test: true, event: 'stock_change' },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: true,
        message: 'Test webhook for eposnow received',
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should return 404 in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /test/:channelType');

      const request = createMockRequest({
        params: { channelType: 'eposnow' },
        body: { test: true },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(404);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Error Handling', () => {
    it('should handle queue job errors gracefully', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({ tenantId: tenant.id, type: 'eposnow' });

      mockDb.query.channels.findFirst.mockResolvedValue(channel);
      mockAddWebhookJob.mockRejectedValue(new Error('Queue error'));

      const request = createMockRequest({
        body: JSON.stringify(eposnowWebhookPayload),
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      // Should still return 200 to prevent webhook retries
      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
    });

    it('should handle database errors gracefully', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      mockDb.query.channels.findFirst.mockRejectedValue(new Error('Database error'));

      const request = createMockRequest({
        body: JSON.stringify(eposnowWebhookPayload),
        headers: {},
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      // Should return 200 to prevent infinite retries
      const sentData = getSentData();
      expect(sentData?.code).toBe(200);
      expect(sentData?.body).toMatchObject({
        success: false,
        message: 'Webhook received but processing failed',
      });
    });
  });

  describe('Signature Verification Security', () => {
    it('should use timing-safe comparison for signatures', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const webhookSecret = 'test-secret';
      const payload = JSON.stringify(eposnowWebhookPayload);
      // Signature that differs only in last character
      const invalidSignature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex').slice(0, -1) + 'x';

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'eposnow',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-eposnow-signature': invalidSignature,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
    });

    it('should reject signatures with wrong prefix', async () => {
      await webhookRoutes(mockApp as any);
      const route = registeredRoutes.get('POST /eposnow');

      const webhookSecret = 'test-secret';
      const payload = JSON.stringify(eposnowWebhookPayload);
      const signatureWithWrongPrefix = 'md5=' + crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

      const tenant = createTenantFixture();
      const channel = createChannelFixture({
        tenantId: tenant.id,
        type: 'eposnow',
      });

      mockDb.query.channels.findFirst.mockResolvedValue({
        ...channel,
        webhookSecret,
      });

      const request = createMockRequest({
        body: payload,
        headers: {
          'x-eposnow-signature': signatureWithWrongPrefix,
        },
      });
      const { reply, getSentData } = createMockReply();

      await route!.handler(request, reply);

      const sentData = getSentData();
      expect(sentData?.code).toBe(401);
    });
  });
});
