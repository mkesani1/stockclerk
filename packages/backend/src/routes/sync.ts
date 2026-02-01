/**
 * Sync Routes - Trigger and manage inventory synchronization
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { syncEvents, channels, products, productChannelMappings } from '../db/schema.js';
import {
  paginationSchema,
  type ApiResponse,
  type PaginatedResponse,
  type SyncEventWithRelations,
  type SyncJobData,
  type ChannelType,
} from '../types/index.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';
import {
  addSyncJob,
  addBulkSyncJobs,
  getQueueStats,
  getSyncQueue,
} from '../queues/index.js';
import {
  emitSyncStarted,
  broadcastToTenant,
  createWebSocketMessage,
} from '../websocket/index.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', authenticateRequest);

  // ============================================================================
  // Sync Event Listing & Details
  // ============================================================================

  // GET /sync/events - List sync events with pagination
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: string;
      channelId?: string;
      productId?: string;
    };
  }>(
    '/events',
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          status?: string;
          channelId?: string;
          productId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const pagination = paginationSchema.parse(request.query);
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;
        const { status, channelId, productId } = request.query;

        // Build where conditions
        const conditions = [eq(syncEvents.tenantId, tenantId)];

        if (status) {
          conditions.push(sql`${syncEvents.status} = ${status}`);
        }
        if (channelId) {
          conditions.push(eq(syncEvents.channelId, channelId));
        }
        if (productId) {
          conditions.push(eq(syncEvents.productId, productId));
        }

        // Get total count
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(syncEvents)
          .where(and(...conditions));

        // Get paginated sync events with relations
        const events = await db.query.syncEvents.findMany({
          where: and(...conditions),
          with: {
            channel: {
              columns: {
                id: true,
                name: true,
                type: true,
              },
            },
            product: {
              columns: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
          orderBy: [desc(syncEvents.createdAt)],
          limit,
          offset,
        });

        return reply.code(200).send({
          success: true,
          data: events,
          pagination: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
          },
        } satisfies PaginatedResponse<SyncEventWithRelations>);
      } catch (error) {
        console.error('List sync events error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch sync events',
        } satisfies ApiResponse);
      }
    }
  );

  // GET /sync/events/:id - Get single sync event
  app.get<{ Params: { id: string } }>(
    '/events/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const event = await db.query.syncEvents.findFirst({
          where: and(eq(syncEvents.id, id), eq(syncEvents.tenantId, tenantId)),
          with: {
            channel: {
              columns: {
                id: true,
                name: true,
                type: true,
              },
            },
            product: {
              columns: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        });

        if (!event) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Sync event not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: event,
        } satisfies ApiResponse<SyncEventWithRelations>);
      } catch (error) {
        console.error('Get sync event error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch sync event',
        } satisfies ApiResponse);
      }
    }
  );

  // GET /sync/stats - Get sync statistics
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      // Get counts by status
      const statusCounts = await db
        .select({
          status: syncEvents.status,
          count: sql<number>`count(*)::int`,
        })
        .from(syncEvents)
        .where(eq(syncEvents.tenantId, tenantId))
        .groupBy(syncEvents.status);

      // Get counts for last 24 hours
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [{ recentCount }] = await db
        .select({ recentCount: sql<number>`count(*)::int` })
        .from(syncEvents)
        .where(and(eq(syncEvents.tenantId, tenantId), sql`${syncEvents.createdAt} > ${last24Hours}`));

      // Get failed events count in last 24 hours
      const [{ failedRecent }] = await db
        .select({ failedRecent: sql<number>`count(*)::int` })
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.tenantId, tenantId),
            sql`${syncEvents.status} = 'failed'`,
            sql`${syncEvents.createdAt} > ${last24Hours}`
          )
        );

      const stats = {
        byStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s.count])),
        last24Hours: {
          total: recentCount,
          failed: failedRecent,
        },
      };

      return reply.code(200).send({
        success: true,
        data: stats,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Get sync stats error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch sync statistics',
      } satisfies ApiResponse);
    }
  });

  // ============================================================================
  // Sync Trigger Endpoints
  // ============================================================================

  /**
   * POST /sync/full - Trigger full reconciliation across all channels
   */
  app.post<{
    Body?: {
      force?: boolean;
    };
  }>(
    '/full',
    async (
      request: FastifyRequest<{ Body?: { force?: boolean } }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const force = request.body?.force || false;

        // Get all active channels for this tenant
        const activeChannels = await db.query.channels.findMany({
          where: and(eq(channels.tenantId, tenantId), eq(channels.isActive, true)),
          columns: {
            id: true,
            name: true,
            type: true,
          },
        });

        if (activeChannels.length === 0) {
          return reply.code(400).send({
            success: false,
            error: 'No active channels',
            message: 'No active channels found. Please connect at least one channel first.',
          } satisfies ApiResponse);
        }

        // Create sync jobs for each channel
        const syncJobs: { data: SyncJobData; options?: { priority?: number } }[] =
          activeChannels.map((channel) => ({
            data: {
              tenantId,
              channelId: channel.id,
              channelType: channel.type as ChannelType,
              operation: 'full_sync',
            },
            options: {
              priority: force ? 1 : 3, // Higher priority if forced
            },
          }));

        // Add jobs to queue
        const jobs = await addBulkSyncJobs(syncJobs);

        // Broadcast sync started event
        broadcastToTenant(
          tenantId,
          createWebSocketMessage('sync_started', tenantId, {
            operation: 'full_sync',
            channelCount: activeChannels.length,
            jobIds: jobs.map((j) => j.id),
          })
        );

        return reply.code(202).send({
          success: true,
          message: 'Full sync triggered',
          data: {
            jobIds: jobs.map((j) => j.id),
            channelsQueued: activeChannels.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
            })),
            status: 'queued',
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Trigger full sync error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to trigger full sync',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /sync/channel/:id - Sync specific channel
   */
  app.post<{
    Params: { id: string };
    Body?: {
      operation?: 'full_sync' | 'incremental_sync';
      productIds?: string[];
    };
  }>(
    '/channel/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: {
          operation?: 'full_sync' | 'incremental_sync';
          productIds?: string[];
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id: channelId } = request.params;
        const operation = request.body?.operation || 'incremental_sync';
        const productIds = request.body?.productIds;

        // Verify channel exists and belongs to tenant
        const channel = await db.query.channels.findFirst({
          where: and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)),
          columns: {
            id: true,
            name: true,
            type: true,
            isActive: true,
          },
        });

        if (!channel) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Channel not found',
          } satisfies ApiResponse);
        }

        if (!channel.isActive) {
          return reply.code(400).send({
            success: false,
            error: 'Channel inactive',
            message: 'Channel is not active. Please activate it first.',
          } satisfies ApiResponse);
        }

        // Create sync job
        const job = await addSyncJob({
          tenantId,
          channelId: channel.id,
          channelType: channel.type as ChannelType,
          operation,
          productIds,
        });

        // Emit sync started event
        emitSyncStarted(tenantId, {
          channelId: channel.id,
          channelName: channel.name,
          channelType: channel.type as ChannelType,
          operation,
        });

        return reply.code(202).send({
          success: true,
          message: 'Sync triggered',
          data: {
            jobId: job.id,
            channelId: channel.id,
            channelName: channel.name,
            channelType: channel.type,
            operation,
            status: 'queued',
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Trigger channel sync error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to trigger sync',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /sync/product/:id - Sync specific product across all channels
   */
  app.post<{
    Params: { id: string };
    Body?: {
      channelIds?: string[];
    };
  }>(
    '/product/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: {
          channelIds?: string[];
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id: productId } = request.params;
        const specificChannelIds = request.body?.channelIds;

        // Verify product exists and belongs to tenant
        const product = await db.query.products.findFirst({
          where: and(eq(products.id, productId), eq(products.tenantId, tenantId)),
          columns: {
            id: true,
            sku: true,
            name: true,
          },
        });

        if (!product) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        // Get channels this product is mapped to
        const mappings = await db.query.productChannelMappings.findMany({
          where: eq(productChannelMappings.productId, productId),
          with: {
            channel: {
              columns: {
                id: true,
                name: true,
                type: true,
                isActive: true,
              },
            },
          },
        });

        // Filter to only active channels and optionally specific channel IDs
        let targetChannels = mappings
          .filter((m) => m.channel.isActive)
          .map((m) => m.channel);

        if (specificChannelIds && specificChannelIds.length > 0) {
          targetChannels = targetChannels.filter((c) =>
            specificChannelIds.includes(c.id)
          );
        }

        if (targetChannels.length === 0) {
          return reply.code(400).send({
            success: false,
            error: 'No target channels',
            message:
              'Product is not mapped to any active channels, or specified channels are not active.',
          } satisfies ApiResponse);
        }

        // Create sync jobs for each channel
        const syncJobs: { data: SyncJobData; options?: { priority?: number } }[] =
          targetChannels.map((channel) => ({
            data: {
              tenantId,
              channelId: channel.id,
              channelType: channel.type as ChannelType,
              operation: 'push_update',
              productIds: [productId],
            },
            options: {
              priority: 2, // Medium-high priority for single product updates
            },
          }));

        // Add jobs to queue
        const jobs = await addBulkSyncJobs(syncJobs);

        // Broadcast sync started event
        broadcastToTenant(
          tenantId,
          createWebSocketMessage('sync_started', tenantId, {
            operation: 'product_sync',
            productId,
            productSku: product.sku,
            productName: product.name,
            channelCount: targetChannels.length,
            jobIds: jobs.map((j) => j.id),
          })
        );

        return reply.code(202).send({
          success: true,
          message: 'Product sync triggered',
          data: {
            jobIds: jobs.map((j) => j.id),
            productId,
            productSku: product.sku,
            channelsQueued: targetChannels.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
            })),
            status: 'queued',
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Trigger product sync error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to trigger product sync',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /sync/status - Get current sync queue status
   */
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      // Get queue statistics
      let queueStats;
      try {
        queueStats = await getQueueStats();
      } catch (error) {
        app.log.warn('Failed to get queue stats:', error);
        queueStats = null;
      }

      // Get recent pending/processing events for this tenant
      const pendingEvents = await db.query.syncEvents.findMany({
        where: and(
          eq(syncEvents.tenantId, tenantId),
          sql`${syncEvents.status} in ('pending', 'processing')`
        ),
        orderBy: [desc(syncEvents.createdAt)],
        limit: 20,
        with: {
          channel: {
            columns: {
              id: true,
              name: true,
              type: true,
            },
          },
          product: {
            columns: {
              id: true,
              sku: true,
              name: true,
            },
          },
        },
      });

      // Try to get active jobs from the queue for this tenant
      let activeJobs: Array<{
        id: string | undefined;
        channelId: string;
        operation: string;
        timestamp: number;
      }> = [];

      try {
        const queue = getSyncQueue();
        const jobs = await queue.getActive();
        activeJobs = jobs
          .filter((j) => j.data.tenantId === tenantId)
          .map((j) => ({
            id: j.id,
            channelId: j.data.channelId,
            operation: j.data.operation,
            timestamp: j.timestamp,
          }));
      } catch (error) {
        app.log.warn('Failed to get active jobs:', error);
      }

      return reply.code(200).send({
        success: true,
        data: {
          queueStats: queueStats
            ? {
                sync: {
                  waiting: queueStats.sync.waiting,
                  active: queueStats.sync.active,
                  completed: queueStats.sync.completed,
                  failed: queueStats.sync.failed,
                },
                webhook: {
                  waiting: queueStats.webhook.waiting,
                  active: queueStats.webhook.active,
                },
              }
            : null,
          pendingEvents,
          activeJobs,
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Get sync status error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch sync status',
      } satisfies ApiResponse);
    }
  });

  // ============================================================================
  // Legacy/Alias Endpoints (for backwards compatibility)
  // ============================================================================

  // POST /sync/trigger/:channelId - Alias for /sync/channel/:id
  app.post<{ Params: { channelId: string } }>(
    '/trigger/:channelId',
    async (request: FastifyRequest<{ Params: { channelId: string } }>, reply: FastifyReply) => {
      // Redirect to new endpoint
      return reply.redirect(307, `/api/sync/channel/${request.params.channelId}`);
    }
  );

  // POST /sync/trigger-all - Alias for /sync/full
  app.post('/trigger-all', async (request: FastifyRequest, reply: FastifyReply) => {
    // Redirect to new endpoint
    return reply.redirect(307, '/api/sync/full');
  });
}

export default syncRoutes;
