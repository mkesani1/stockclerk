/**
 * Dashboard Statistics Endpoint
 * Provides aggregated stats for the frontend dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { products, channels, alerts, syncEvents } from '../db/schema.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';
import { getQueueStats } from '../queues/index.js';
import { getTenantConnectionCount } from '../websocket/index.js';
import type { ApiResponse, SyncEvent } from '../types/index.js';

// AI Agent status type
type AgentStatus = 'active' | 'idle' | 'error';

interface AIAgentStatus {
  watcher: AgentStatus;
  sync: AgentStatus;
  guardian: AgentStatus;
  alert: AgentStatus;
}

interface DashboardStats {
  totalProducts: number;
  syncedToday: number;
  activeChannels: number;
  pendingAlerts: number;
  aiAgentStatus: AIAgentStatus;
  recentActivity: SyncEvent[];
  additionalStats?: {
    lowStockProducts: number;
    totalSyncEvents: number;
    failedSyncsToday: number;
    activeConnections: number;
    queueStats?: {
      sync: { waiting: number; active: number };
      webhook: { waiting: number; active: number };
    };
  };
}

// In-memory agent status (in production, use Redis or database)
const agentStatusStore: Record<string, AIAgentStatus> = {};

// Update agent status (called by sync-engine or AI agents)
export function updateAgentStatus(tenantId: string, agent: keyof AIAgentStatus, status: AgentStatus): void {
  if (!agentStatusStore[tenantId]) {
    agentStatusStore[tenantId] = {
      watcher: 'idle',
      sync: 'idle',
      guardian: 'idle',
      alert: 'idle',
    };
  }
  agentStatusStore[tenantId][agent] = status;
}

// Get agent status for a tenant
export function getAgentStatus(tenantId: string): AIAgentStatus {
  return agentStatusStore[tenantId] || {
    watcher: 'idle',
    sync: 'idle',
    guardian: 'idle',
    alert: 'idle',
  };
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', authenticateRequest);

  /**
   * GET /dashboard/stats
   * Get aggregated dashboard statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      // Get date boundaries
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Run all queries in parallel for better performance
      const [
        productCountResult,
        activeChannelsResult,
        pendingAlertsResult,
        syncedTodayResult,
        recentActivityResult,
        lowStockResult,
        totalSyncEventsResult,
        failedSyncsTodayResult,
      ] = await Promise.all([
        // Total products count
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(eq(products.tenantId, tenantId)),

        // Active channels count
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(channels)
          .where(and(eq(channels.tenantId, tenantId), eq(channels.isActive, true))),

        // Pending (unread) alerts count
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(alerts)
          .where(and(eq(alerts.tenantId, tenantId), eq(alerts.isRead, false))),

        // Products synced today (distinct products with sync events today)
        db
          .select({ count: sql<number>`count(distinct ${syncEvents.productId})::int` })
          .from(syncEvents)
          .where(
            and(
              eq(syncEvents.tenantId, tenantId),
              gte(syncEvents.createdAt, today),
              sql`${syncEvents.productId} is not null`
            )
          ),

        // Recent activity (last 10 sync events)
        db.query.syncEvents.findMany({
          where: eq(syncEvents.tenantId, tenantId),
          orderBy: [desc(syncEvents.createdAt)],
          limit: 10,
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
        }),

        // Low stock products (below buffer stock)
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(
            and(
              eq(products.tenantId, tenantId),
              sql`${products.currentStock} <= ${products.bufferStock}`
            )
          ),

        // Total sync events
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(syncEvents)
          .where(eq(syncEvents.tenantId, tenantId)),

        // Failed syncs today
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(syncEvents)
          .where(
            and(
              eq(syncEvents.tenantId, tenantId),
              sql`${syncEvents.status} = 'failed'`,
              gte(syncEvents.createdAt, today)
            )
          ),
      ]);

      // Get queue stats (may fail if Redis is not connected)
      let queueStats = null;
      try {
        queueStats = await getQueueStats();
      } catch (error) {
        app.log.warn('Failed to get queue stats:', error);
      }

      // Get active WebSocket connections for this tenant
      const activeConnections = getTenantConnectionCount(tenantId);

      // Get AI agent status
      const aiAgentStatus = getAgentStatus(tenantId);

      // Determine agent status based on queue activity
      if (queueStats) {
        if (queueStats.sync.active > 0) {
          aiAgentStatus.sync = 'active';
        }
        if (queueStats.webhook.active > 0) {
          aiAgentStatus.watcher = 'active';
        }
        if (queueStats.alert.active > 0) {
          aiAgentStatus.alert = 'active';
        }
      }

      const stats: DashboardStats = {
        totalProducts: productCountResult[0]?.count || 0,
        syncedToday: syncedTodayResult[0]?.count || 0,
        activeChannels: activeChannelsResult[0]?.count || 0,
        pendingAlerts: pendingAlertsResult[0]?.count || 0,
        aiAgentStatus,
        recentActivity: recentActivityResult,
        additionalStats: {
          lowStockProducts: lowStockResult[0]?.count || 0,
          totalSyncEvents: totalSyncEventsResult[0]?.count || 0,
          failedSyncsToday: failedSyncsTodayResult[0]?.count || 0,
          activeConnections,
          queueStats: queueStats
            ? {
                sync: {
                  waiting: queueStats.sync.waiting,
                  active: queueStats.sync.active,
                },
                webhook: {
                  waiting: queueStats.webhook.waiting,
                  active: queueStats.webhook.active,
                },
              }
            : undefined,
        },
      };

      return reply.code(200).send({
        success: true,
        data: stats,
      } satisfies ApiResponse<DashboardStats>);
    } catch (error) {
      console.error('Dashboard stats error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch dashboard statistics',
      } satisfies ApiResponse);
    }
  });

  /**
   * GET /dashboard/activity
   * Get paginated activity feed
   */
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      type?: string;
    };
  }>(
    '/activity',
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          type?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const page = parseInt(request.query.page || '1', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        const offset = (page - 1) * limit;
        const eventType = request.query.type;

        // Build conditions
        const conditions = [eq(syncEvents.tenantId, tenantId)];
        if (eventType) {
          conditions.push(eq(syncEvents.eventType, eventType));
        }

        // Get total count
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(syncEvents)
          .where(and(...conditions));

        // Get paginated events
        const events = await db.query.syncEvents.findMany({
          where: and(...conditions),
          orderBy: [desc(syncEvents.createdAt)],
          limit,
          offset,
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

        return reply.code(200).send({
          success: true,
          data: events,
          pagination: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
          },
        });
      } catch (error) {
        console.error('Activity feed error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch activity feed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /dashboard/channels-status
   * Get status of all channels
   */
  app.get('/channels-status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const channelList = await db.query.channels.findMany({
        where: eq(channels.tenantId, tenantId),
        columns: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          lastSyncAt: true,
          createdAt: true,
        },
      });

      // Get sync stats for each channel
      const channelStats = await Promise.all(
        channelList.map(async (channel) => {
          const [syncStats] = await db
            .select({
              totalSyncs: sql<number>`count(*)::int`,
              lastSync: sql<Date>`max(${syncEvents.createdAt})`,
              failedRecent: sql<number>`count(*) filter (where ${syncEvents.status} = 'failed' and ${syncEvents.createdAt} > now() - interval '24 hours')::int`,
            })
            .from(syncEvents)
            .where(
              and(eq(syncEvents.tenantId, tenantId), eq(syncEvents.channelId, channel.id))
            );

          return {
            ...channel,
            stats: {
              totalSyncs: syncStats?.totalSyncs || 0,
              lastSync: syncStats?.lastSync || channel.lastSyncAt,
              failedRecent: syncStats?.failedRecent || 0,
            },
            status: determineChannelStatus(channel, syncStats),
          };
        })
      );

      return reply.code(200).send({
        success: true,
        data: channelStats,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Channel status error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch channel status',
      } satisfies ApiResponse);
    }
  });

  /**
   * GET /dashboard/stock-overview
   * Get stock level overview
   */
  app.get('/stock-overview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const [stockStats] = await db
        .select({
          totalProducts: sql<number>`count(*)::int`,
          inStock: sql<number>`count(*) filter (where ${products.currentStock} > ${products.bufferStock})::int`,
          lowStock: sql<number>`count(*) filter (where ${products.currentStock} <= ${products.bufferStock} and ${products.currentStock} > 0)::int`,
          outOfStock: sql<number>`count(*) filter (where ${products.currentStock} = 0)::int`,
          totalStockValue: sql<number>`sum(${products.currentStock})::int`,
        })
        .from(products)
        .where(eq(products.tenantId, tenantId));

      // Get top low stock items
      const lowStockItems = await db.query.products.findMany({
        where: and(
          eq(products.tenantId, tenantId),
          sql`${products.currentStock} <= ${products.bufferStock}`
        ),
        orderBy: [sql`${products.currentStock} asc`],
        limit: 5,
        columns: {
          id: true,
          sku: true,
          name: true,
          currentStock: true,
          bufferStock: true,
        },
      });

      return reply.code(200).send({
        success: true,
        data: {
          overview: {
            total: stockStats?.totalProducts || 0,
            inStock: stockStats?.inStock || 0,
            lowStock: stockStats?.lowStock || 0,
            outOfStock: stockStats?.outOfStock || 0,
            totalUnits: stockStats?.totalStockValue || 0,
          },
          lowStockItems,
        },
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Stock overview error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch stock overview',
      } satisfies ApiResponse);
    }
  });

  /**
   * POST /dashboard/agent-status
   * Update AI agent status (internal API for sync-engine)
   */
  app.post<{
    Body: {
      agent: keyof AIAgentStatus;
      status: AgentStatus;
    };
  }>(
    '/agent-status',
    async (
      request: FastifyRequest<{
        Body: {
          agent: keyof AIAgentStatus;
          status: AgentStatus;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { agent, status } = request.body;

        if (!['watcher', 'sync', 'guardian', 'alert'].includes(agent)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid agent',
            message: 'Agent must be one of: watcher, sync, guardian, alert',
          } satisfies ApiResponse);
        }

        if (!['active', 'idle', 'error'].includes(status)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid status',
            message: 'Status must be one of: active, idle, error',
          } satisfies ApiResponse);
        }

        updateAgentStatus(tenantId, agent, status);

        return reply.code(200).send({
          success: true,
          message: `Agent ${agent} status updated to ${status}`,
          data: getAgentStatus(tenantId),
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Update agent status error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update agent status',
        } satisfies ApiResponse);
      }
    }
  );
}

// Helper function to determine channel status
function determineChannelStatus(
  channel: { isActive: boolean; lastSyncAt: Date | null },
  syncStats: { failedRecent: number } | null
): 'healthy' | 'warning' | 'error' | 'inactive' {
  if (!channel.isActive) {
    return 'inactive';
  }

  if (syncStats && syncStats.failedRecent > 0) {
    return syncStats.failedRecent >= 3 ? 'error' : 'warning';
  }

  if (!channel.lastSyncAt) {
    return 'warning'; // Never synced
  }

  // Check if last sync was more than 24 hours ago
  const hoursSinceLastSync =
    (Date.now() - new Date(channel.lastSyncAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastSync > 24) {
    return 'warning';
  }

  return 'healthy';
}

export default dashboardRoutes;
