/**
 * Admin Routes
 * Protected endpoints for super admin access to cross-tenant system management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc, count, sql, and, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tenants, users, channels, products, syncEvents, alerts } from '../db/schema.js';
import { authenticateRequest } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/admin.js';
import type { ApiResponse, PaginatedResponse } from '../types/index.js';

interface GlobalStats {
  tenantCount: number;
  userCount: number;
  productCount: number;
  channelCount: number;
  syncEventsLast24h: number;
  failedSyncEventsLast24h: number;
  unreadAlerts: number;
}

interface TenantWithCounts {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  userCount: number;
  productCount: number;
  channelCount: number;
  syncEventCountLast24h: number;
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  channels: any[];
  recentSyncEvents: any[];
  recentAlerts: any[];
}

interface SyncEventWithNames {
  id: string;
  tenantId: string;
  eventType: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  channelName?: string;
  tenantName?: string;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication AND super admin status
  app.addHook('preHandler', authenticateRequest);

  /**
   * GET /admin/stats
   * Global system statistics
   */
  app.get<{}>(
    '/stats',
    { preHandler: [requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          tenantCountResult,
          userCountResult,
          productCountResult,
          channelCountResult,
          syncEventsLast24hResult,
          failedSyncEventsLast24hResult,
          unreadAlertsResult,
        ] = await Promise.all([
          // Total tenants
          db.select({ count: sql<number>`count(*)::int` }).from(tenants),

          // Total users
          db.select({ count: sql<number>`count(*)::int` }).from(users),

          // Total products
          db.select({ count: sql<number>`count(*)::int` }).from(products),

          // Total channels
          db.select({ count: sql<number>`count(*)::int` }).from(channels),

          // Sync events in last 24h
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(syncEvents)
            .where(gte(syncEvents.createdAt, today)),

          // Failed sync events in last 24h
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(syncEvents)
            .where(and(gte(syncEvents.createdAt, today), eq(syncEvents.status, 'failed'))),

          // Unread alerts
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(alerts)
            .where(eq(alerts.isRead, false)),
        ]);

        const stats: GlobalStats = {
          tenantCount: tenantCountResult[0]?.count || 0,
          userCount: userCountResult[0]?.count || 0,
          productCount: productCountResult[0]?.count || 0,
          channelCount: channelCountResult[0]?.count || 0,
          syncEventsLast24h: syncEventsLast24hResult[0]?.count || 0,
          failedSyncEventsLast24h: failedSyncEventsLast24hResult[0]?.count || 0,
          unreadAlerts: unreadAlertsResult[0]?.count || 0,
        };

        return reply.code(200).send({
          success: true,
          data: stats,
        } satisfies ApiResponse<GlobalStats>);
      } catch (error) {
        console.error('Admin stats error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch global statistics',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /admin/tenants
   * List all tenants with related counts (paginated)
   */
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
    };
  }>(
    '/tenants',
    { preHandler: [requireSuperAdmin] },
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const page = parseInt(request.query.page || '1', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        const offset = (page - 1) * limit;

        // Get total count
        const [{ total }] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(tenants);

        // Get paginated tenants
        const tenantList = await db.query.tenants.findMany({
          orderBy: [desc(tenants.createdAt)],
          limit,
          offset,
        });

        // Get counts for each tenant
        const tenantWithCounts: TenantWithCounts[] = await Promise.all(
          tenantList.map(async (tenant) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [userCountResult, productCountResult, channelCountResult, syncCountResult] = await Promise.all([
              db
                .select({ count: sql<number>`count(*)::int` })
                .from(users)
                .where(eq(users.tenantId, tenant.id)),

              db
                .select({ count: sql<number>`count(*)::int` })
                .from(products)
                .where(eq(products.tenantId, tenant.id)),

              db
                .select({ count: sql<number>`count(*)::int` })
                .from(channels)
                .where(eq(channels.tenantId, tenant.id)),

              db
                .select({ count: sql<number>`count(*)::int` })
                .from(syncEvents)
                .where(and(eq(syncEvents.tenantId, tenant.id), gte(syncEvents.createdAt, today))),
            ]);

            return {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
              createdAt: tenant.createdAt,
              userCount: userCountResult[0]?.count || 0,
              productCount: productCountResult[0]?.count || 0,
              channelCount: channelCountResult[0]?.count || 0,
              syncEventCountLast24h: syncCountResult[0]?.count || 0,
            };
          })
        );

        return reply.code(200).send({
          success: true,
          data: tenantWithCounts,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } satisfies PaginatedResponse<TenantWithCounts>);
      } catch (error) {
        console.error('Admin tenants list error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch tenants',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /admin/tenants/:id
   * Single tenant detail with channels, recent sync events, and alerts
   */
  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/tenants/:id',
    { preHandler: [requireSuperAdmin] },
    async (
      request: FastifyRequest<{
        Params: {
          id: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { id: tenantId } = request.params;

        // Get tenant
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, tenantId),
        });

        if (!tenant) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Tenant not found',
          } satisfies ApiResponse);
        }

        // Get channels
        const channelList = await db.query.channels.findMany({
          where: eq(channels.tenantId, tenantId),
          orderBy: [desc(channels.createdAt)],
        });

        // Get recent sync events
        const recentSyncEvents = await db.query.syncEvents.findMany({
          where: eq(syncEvents.tenantId, tenantId),
          orderBy: [desc(syncEvents.createdAt)],
          limit: 20,
          with: {
            channel: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Get recent alerts
        const recentAlerts = await db.query.alerts.findMany({
          where: eq(alerts.tenantId, tenantId),
          orderBy: [desc(alerts.createdAt)],
          limit: 10,
        });

        const tenantDetail: TenantDetail = {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          createdAt: tenant.createdAt,
          channels: channelList,
          recentSyncEvents,
          recentAlerts,
        };

        return reply.code(200).send({
          success: true,
          data: tenantDetail,
        } satisfies ApiResponse<TenantDetail>);
      } catch (error) {
        console.error('Admin tenant detail error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch tenant details',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /admin/sync-events
   * Cross-tenant sync events with filtering and pagination
   */
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: string;
      tenantId?: string;
      channelId?: string;
    };
  }>(
    '/sync-events',
    { preHandler: [requireSuperAdmin] },
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          status?: string;
          tenantId?: string;
          channelId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const page = parseInt(request.query.page || '1', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        const offset = (page - 1) * limit;
        const { status, tenantId, channelId } = request.query;

        // Build conditions
        const conditions = [];
        if (status) {
          conditions.push(eq(syncEvents.status, status as any));
        }
        if (tenantId) {
          conditions.push(eq(syncEvents.tenantId, tenantId));
        }
        if (channelId) {
          conditions.push(eq(syncEvents.channelId, channelId));
        }

        // Get total count
        const [{ total }] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(syncEvents)
          .where(conditions.length > 0 ? and(...conditions) : undefined);

        // Get paginated events with relations
        const eventList = await db.query.syncEvents.findMany({
          where: conditions.length > 0 ? and(...conditions) : undefined,
          orderBy: [desc(syncEvents.createdAt)],
          limit,
          offset,
          with: {
            channel: {
              columns: {
                id: true,
                name: true,
              },
            },
            tenant: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Format response with channel and tenant names
        const formattedEvents = eventList.map((event) => ({
          id: event.id,
          tenantId: event.tenantId,
          eventType: event.eventType,
          status: event.status,
          errorMessage: event.errorMessage,
          createdAt: event.createdAt,
          channelName: event.channel?.name,
          tenantName: event.tenant?.name,
        }));

        return reply.code(200).send({
          success: true,
          data: formattedEvents,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } satisfies PaginatedResponse<SyncEventWithNames>);
      } catch (error) {
        console.error('Admin sync-events error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch sync events',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /admin/system-health
   * System health check including database connectivity
   */
  app.get<{}>(
    '/system-health',
    { preHandler: [requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        let dbHealthy = false;

        try {
          // Test database connection
          await db.execute(sql`SELECT 1`);
          dbHealthy = true;
        } catch (error) {
          console.error('Database health check failed:', error);
        }

        const healthResponse = {
          db: dbHealthy,
          timestamp: new Date().toISOString(),
        };

        const statusCode = dbHealthy ? 200 : 503;

        return reply.code(statusCode).send({
          success: dbHealthy,
          data: healthResponse,
        } satisfies ApiResponse);
      } catch (error) {
        console.error('System health check error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to check system health',
        } satisfies ApiResponse);
      }
    }
  );
}

export default adminRoutes;
