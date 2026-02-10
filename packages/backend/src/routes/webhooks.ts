/**
 * Webhook Receivers for External API Integrations
 * Receives webhooks from Eposnow, Wix, and Otter (Deliveroo)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { channels } from '../db/schema.js';
import { addWebhookJob } from '../queues/index.js';
import { broadcastToTenant, createWebSocketMessage } from '../websocket/index.js';
import type { ChannelType, ApiResponse } from '../types/index.js';

// Webhook signature verification utilities
function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm = 'sha256'
): boolean {
  const expectedSignature = crypto
    .createHmac(algorithm, secret)
    .update(payload, 'utf8')
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

function verifyHmacSignatureWithPrefix(
  payload: string,
  signatureHeader: string,
  secret: string,
  prefix: string,
  algorithm = 'sha256'
): boolean {
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }
  const signature = signatureHeader.substring(prefix.length);
  return verifyHmacSignature(payload, signature, secret, algorithm);
}

// Generic webhook payload type
interface WebhookPayload {
  event?: string;
  eventType?: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// Channel lookup cache (in production, consider Redis)
const channelSecretCache = new Map<string, { tenantId: string; webhookSecret: string }>();

// Exported for testing - clears the webhook secret cache
export function clearChannelSecretCache(): void {
  channelSecretCache.clear();
}

// Helper to get channel credentials
async function getChannelByExternalId(
  channelType: ChannelType,
  externalIdentifier: string
): Promise<{ id: string; tenantId: string; webhookSecret?: string } | null> {
  if (!externalIdentifier) {
    return null;
  }

  // Check cache first
  const cacheKey = `${channelType}:${externalIdentifier}`;
  const cached = channelSecretCache.get(cacheKey);
  if (cached) {
    const channel = await db.query.channels.findFirst({
      where: and(
        eq(channels.type, channelType),
        eq(channels.externalInstanceId, externalIdentifier),
        eq(channels.isActive, true)
      ),
    });
    if (channel) {
      return {
        id: channel.id,
        tenantId: channel.tenantId,
        webhookSecret: cached.webhookSecret || (channel as any).webhookSecret,
      };
    }
  }

  // Query database by external instance ID for proper multi-tenant routing
  const channel = await db.query.channels.findFirst({
    where: and(
      eq(channels.type, channelType),
      eq(channels.externalInstanceId, externalIdentifier),
      eq(channels.isActive, true)
    ),
  });

  if (channel) {
    const webhookSecret = (channel as any).webhookSecret || '';
    // Cache for future lookups
    channelSecretCache.set(cacheKey, {
      tenantId: channel.tenantId,
      webhookSecret,
    });
    return { id: channel.id, tenantId: channel.tenantId, webhookSecret: webhookSecret || undefined };
  }

  // Fallback: try finding any active channel of this type (for backwards compatibility)
  const fallbackChannel = await db.query.channels.findFirst({
    where: and(
      eq(channels.type, channelType),
      eq(channels.isActive, true)
    ),
  });

  if (fallbackChannel) {
    const webhookSecret = (fallbackChannel as any).webhookSecret || '';
    return {
      id: fallbackChannel.id,
      tenantId: fallbackChannel.tenantId,
      webhookSecret: webhookSecret || undefined,
    };
  }

  return null;
}

// Eposnow webhook payload types
interface EposnowWebhookPayload {
  event: 'stock_change' | 'product_update' | 'product_create' | 'product_delete';
  locationId?: string;
  productId: string;
  sku?: string;
  stockLevel?: number;
  previousStockLevel?: number;
  timestamp: string;
  data?: Record<string, unknown>;
}

// Wix webhook payload types
interface WixWebhookPayload {
  eventType: string;
  instanceId: string;
  data: {
    productId?: string;
    variantId?: string;
    inventory?: {
      quantity?: number;
      trackQuantity?: boolean;
    };
    product?: Record<string, unknown>;
  };
  timestamp: string;
}

// Otter webhook payload types
interface OtterWebhookPayload {
  type: 'item_availability_changed' | 'menu_update' | 'order_status';
  restaurantId: string;
  payload: {
    itemId?: string;
    externalId?: string;
    available?: boolean;
    quantity?: number;
    reason?: string;
    items?: Array<{
      id: string;
      available: boolean;
      quantity?: number;
    }>;
  };
  timestamp: string;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Disable content type parsing for webhooks to get raw body for signature verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  /**
   * POST /webhooks/eposnow
   * Receive webhooks from Eposnow POS system
   */
  app.post<{
    Body: string;
    Headers: {
      'x-eposnow-signature'?: string;
      'x-location-id'?: string;
    };
  }>(
    '/eposnow',
    async (
      request: FastifyRequest<{
        Body: string;
        Headers: {
          'x-eposnow-signature'?: string;
          'x-location-id'?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const startTime = Date.now();

      try {
        const rawBody = request.body;
        const signature = request.headers['x-eposnow-signature'];
        const locationId = request.headers['x-location-id'];

        // Parse the payload
        let payload: EposnowWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          app.log.warn('Invalid JSON in Eposnow webhook');
          return reply.code(400).send({
            success: false,
            error: 'Invalid JSON payload',
          } satisfies ApiResponse);
        }

        // Find the channel by location ID or try to match
        const channel = await getChannelByExternalId(
          'eposnow',
          locationId || payload.locationId || ''
        );

        if (!channel) {
          app.log.warn('No matching Eposnow channel found for webhook');
          // Return 200 to prevent retries for unknown channels
          return reply.code(200).send({
            success: true,
            message: 'Webhook received but no matching channel found',
          } satisfies ApiResponse);
        }

        // Verify signature if secret is configured
        if (channel.webhookSecret && signature) {
          const isValid = verifyHmacSignatureWithPrefix(
            rawBody,
            signature,
            channel.webhookSecret,
            'sha256='
          );

          if (!isValid) {
            app.log.warn('Invalid Eposnow webhook signature');
            return reply.code(401).send({
              success: false,
              error: 'Invalid signature',
            } satisfies ApiResponse);
          }
        }

        // Return 200 immediately (async processing)
        reply.code(200).send({
          success: true,
          message: 'Webhook received',
        } satisfies ApiResponse);

        // Queue the webhook for async processing
        await addWebhookJob({
          tenantId: channel.tenantId,
          channelId: channel.id,
          channelType: 'eposnow',
          eventType: payload.event,
          payload: payload as unknown as Record<string, unknown>,
        });

        // Broadcast webhook received event
        broadcastToTenant(
          channel.tenantId,
          createWebSocketMessage('sync_started', channel.tenantId, {
            source: 'webhook',
            channelType: 'eposnow',
            eventType: payload.event,
          })
        );

        app.log.info(
          `Eposnow webhook processed in ${Date.now() - startTime}ms: ${payload.event}`
        );
      } catch (error) {
        app.log.error({ err: error }, 'Eposnow webhook error');
        // Still return 200 to prevent infinite retries
        return reply.code(200).send({
          success: false,
          message: 'Webhook received but processing failed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /webhooks/wix
   * Receive webhooks from Wix eCommerce
   */
  app.post<{
    Body: string;
    Headers: {
      'x-wix-signature'?: string;
      'x-wix-instance-id'?: string;
    };
  }>(
    '/wix',
    async (
      request: FastifyRequest<{
        Body: string;
        Headers: {
          'x-wix-signature'?: string;
          'x-wix-instance-id'?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const startTime = Date.now();

      try {
        const rawBody = request.body;
        const signature = request.headers['x-wix-signature'];
        const instanceId = request.headers['x-wix-instance-id'];

        // Parse the payload
        let payload: WixWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          app.log.warn('Invalid JSON in Wix webhook');
          return reply.code(400).send({
            success: false,
            error: 'Invalid JSON payload',
          } satisfies ApiResponse);
        }

        // Find the channel by instance ID
        const channel = await getChannelByExternalId(
          'wix',
          instanceId || payload.instanceId || ''
        );

        if (!channel) {
          app.log.warn('No matching Wix channel found for webhook');
          return reply.code(200).send({
            success: true,
            message: 'Webhook received but no matching channel found',
          } satisfies ApiResponse);
        }

        // Verify signature if secret is configured
        if (channel.webhookSecret && signature) {
          const isValid = verifyHmacSignature(
            rawBody,
            signature,
            channel.webhookSecret,
            'sha256'
          );

          if (!isValid) {
            app.log.warn('Invalid Wix webhook signature');
            return reply.code(401).send({
              success: false,
              error: 'Invalid signature',
            } satisfies ApiResponse);
          }
        }

        // Return 200 immediately
        reply.code(200).send({
          success: true,
          message: 'Webhook received',
        } satisfies ApiResponse);

        // Queue for async processing
        await addWebhookJob({
          tenantId: channel.tenantId,
          channelId: channel.id,
          channelType: 'wix',
          eventType: payload.eventType,
          payload: payload as unknown as Record<string, unknown>,
        });

        // Broadcast webhook received event
        broadcastToTenant(
          channel.tenantId,
          createWebSocketMessage('sync_started', channel.tenantId, {
            source: 'webhook',
            channelType: 'wix',
            eventType: payload.eventType,
          })
        );

        app.log.info(
          `Wix webhook processed in ${Date.now() - startTime}ms: ${payload.eventType}`
        );
      } catch (error) {
        app.log.error({ err: error }, 'Wix webhook error');
        return reply.code(200).send({
          success: false,
          message: 'Webhook received but processing failed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /webhooks/otter
   * Receive webhooks from Otter (Deliveroo integration)
   */
  app.post<{
    Body: string;
    Headers: {
      'x-otter-signature'?: string;
      'x-restaurant-id'?: string;
    };
  }>(
    '/otter',
    async (
      request: FastifyRequest<{
        Body: string;
        Headers: {
          'x-otter-signature'?: string;
          'x-restaurant-id'?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const startTime = Date.now();

      try {
        const rawBody = request.body;
        const signature = request.headers['x-otter-signature'];
        const restaurantId = request.headers['x-restaurant-id'];

        // Parse the payload
        let payload: OtterWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          app.log.warn('Invalid JSON in Otter webhook');
          return reply.code(400).send({
            success: false,
            error: 'Invalid JSON payload',
          } satisfies ApiResponse);
        }

        // Find the channel by restaurant ID
        const channel = await getChannelByExternalId(
          'deliveroo',
          restaurantId || payload.restaurantId || ''
        );

        if (!channel) {
          app.log.warn('No matching Otter/Deliveroo channel found for webhook');
          return reply.code(200).send({
            success: true,
            message: 'Webhook received but no matching channel found',
          } satisfies ApiResponse);
        }

        // Verify signature if secret is configured
        if (channel.webhookSecret && signature) {
          const isValid = verifyHmacSignatureWithPrefix(
            rawBody,
            signature,
            channel.webhookSecret,
            'sha1=',
            'sha1'
          );

          if (!isValid) {
            app.log.warn('Invalid Otter webhook signature');
            return reply.code(401).send({
              success: false,
              error: 'Invalid signature',
            } satisfies ApiResponse);
          }
        }

        // Return 200 immediately
        reply.code(200).send({
          success: true,
          message: 'Webhook received',
        } satisfies ApiResponse);

        // Queue for async processing
        await addWebhookJob({
          tenantId: channel.tenantId,
          channelId: channel.id,
          channelType: 'deliveroo',
          eventType: payload.type,
          payload: payload as unknown as Record<string, unknown>,
        });

        // Broadcast webhook received event
        broadcastToTenant(
          channel.tenantId,
          createWebSocketMessage('sync_started', channel.tenantId, {
            source: 'webhook',
            channelType: 'deliveroo',
            eventType: payload.type,
          })
        );

        app.log.info(
          `Otter webhook processed in ${Date.now() - startTime}ms: ${payload.type}`
        );
      } catch (error) {
        app.log.error({ err: error }, 'Otter webhook error');
        return reply.code(200).send({
          success: false,
          message: 'Webhook received but processing failed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /webhooks/health
   * Health check endpoint for webhook receivers
   */
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      success: true,
      data: {
        status: 'healthy',
        receivers: ['eposnow', 'wix', 'otter'],
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse);
  });

  /**
   * POST /webhooks/test/:channelType
   * Test endpoint for webhook simulation (development only)
   */
  app.post<{
    Params: { channelType: 'eposnow' | 'wix' | 'otter' };
    Body: WebhookPayload;
  }>(
    '/test/:channelType',
    async (
      request: FastifyRequest<{
        Params: { channelType: 'eposnow' | 'wix' | 'otter' };
        Body: WebhookPayload;
      }>,
      reply: FastifyReply
    ) => {
      // Only allow in development
      if (process.env.NODE_ENV === 'production') {
        return reply.code(404).send({
          success: false,
          error: 'Not found',
        } satisfies ApiResponse);
      }

      const { channelType } = request.params;
      const payload = request.body;

      app.log.info({ payload }, `Test webhook received for ${channelType}`);

      return reply.code(200).send({
        success: true,
        message: `Test webhook for ${channelType} received`,
        data: {
          channelType,
          payload,
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse);
    }
  );
}

export default webhookRoutes;
