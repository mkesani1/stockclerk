/**
 * Alert Routes - Manage alerts and alert rules
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { alerts } from '../db/schema.js';
import {
  createAlertSchema,
  markAlertReadSchema,
  paginationSchema,
  type CreateAlertInput,
  type ApiResponse,
  type PaginatedResponse,
  type Alert,
  type AlertType,
} from '../types/index.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';
import { emitAlertNew } from '../websocket/index.js';
import { addAlertJob, type AlertJobData } from '../queues/index.js';

// ============================================================================
// Alert Rules Storage (in-memory for now, should be in database in production)
// ============================================================================

interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  type: 'low_stock' | 'sync_failure' | 'channel_disconnect' | 'custom';
  conditions: {
    threshold?: number;
    productIds?: string[];
    channelIds?: string[];
    timeWindow?: number; // in minutes
    failureCount?: number;
  };
  actions: {
    createAlert?: boolean;
    webhookUrl?: string;
    emailNotify?: boolean;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory storage for alert rules (use database in production)
const alertRulesStore = new Map<string, AlertRule[]>();

// Schema for creating alert rules
const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['low_stock', 'sync_failure', 'channel_disconnect', 'custom']),
  conditions: z.object({
    threshold: z.number().int().min(0).optional(),
    productIds: z.array(z.string().uuid()).optional(),
    channelIds: z.array(z.string().uuid()).optional(),
    timeWindow: z.number().int().min(1).optional(),
    failureCount: z.number().int().min(1).optional(),
  }),
  actions: z.object({
    createAlert: z.boolean().default(true),
    webhookUrl: z.string().url().optional(),
    emailNotify: z.boolean().optional(),
  }),
  isActive: z.boolean().default(true),
});

const updateAlertRuleSchema = createAlertRuleSchema.partial();

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', authenticateRequest);

  // ============================================================================
  // Alert CRUD Operations
  // ============================================================================

  // GET /alerts - List all alerts for tenant with pagination
  app.get<{ Querystring: { page?: string; limit?: string; unreadOnly?: string; type?: string } }>(
    '/',
    async (
      request: FastifyRequest<{
        Querystring: { page?: string; limit?: string; unreadOnly?: string; type?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const pagination = paginationSchema.parse(request.query);
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;
        const unreadOnly = request.query.unreadOnly === 'true';
        const alertType = request.query.type;

        // Build where conditions
        const conditions = [eq(alerts.tenantId, tenantId)];

        if (unreadOnly) {
          conditions.push(eq(alerts.isRead, false));
        }

        if (alertType) {
          conditions.push(sql`${alerts.type} = ${alertType}`);
        }

        const whereClause = and(...conditions);

        // Get total count
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(alerts)
          .where(whereClause);

        // Get paginated alerts
        const tenantAlerts = await db.query.alerts.findMany({
          where: whereClause,
          orderBy: [desc(alerts.createdAt)],
          limit,
          offset,
        });

        return reply.code(200).send({
          success: true,
          data: tenantAlerts,
          pagination: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
          },
        } satisfies PaginatedResponse<Alert>);
      } catch (error) {
        console.error('List alerts error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch alerts',
        } satisfies ApiResponse);
      }
    }
  );

  // GET /alerts/unread-count - Get count of unread alerts
  app.get('/unread-count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alerts)
        .where(and(eq(alerts.tenantId, tenantId), eq(alerts.isRead, false)));

      return reply.code(200).send({
        success: true,
        data: { unreadCount: count },
      } satisfies ApiResponse<{ unreadCount: number }>);
    } catch (error) {
      console.error('Get unread count error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch unread count',
      } satisfies ApiResponse);
    }
  });

  // GET /alerts/:id - Get single alert
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const alert = await db.query.alerts.findFirst({
          where: and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)),
        });

        if (!alert) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: alert,
        } satisfies ApiResponse<Alert>);
      } catch (error) {
        console.error('Get alert error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch alert',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /alerts - Create new alert (internal use, typically by sync engine)
  app.post<{ Body: CreateAlertInput }>(
    '/',
    async (request: FastifyRequest<{ Body: CreateAlertInput }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);

        const validation = createAlertSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { type, message, metadata } = validation.data;

        const [newAlert] = await db
          .insert(alerts)
          .values({
            tenantId,
            type,
            message,
            metadata,
          } as typeof alerts.$inferInsert)
          .returning();

        // Emit WebSocket event for new alert
        emitAlertNew(tenantId, {
          alertId: newAlert.id,
          type: newAlert.type,
          message: newAlert.message,
          metadata: newAlert.metadata as Record<string, unknown> | undefined,
        });

        return reply.code(201).send({
          success: true,
          data: newAlert,
          message: 'Alert created successfully',
        } satisfies ApiResponse<Alert>);
      } catch (error) {
        console.error('Create alert error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create alert',
        } satisfies ApiResponse);
      }
    }
  );

  // PATCH /alerts/:id - Mark alert as read/unread
  app.patch<{ Params: { id: string }; Body: { isRead: boolean } }>(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { isRead: boolean } }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const validation = markAlertReadSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const [updatedAlert] = await db
          .update(alerts)
          .set({ isRead: validation.data.isRead } as Partial<typeof alerts.$inferSelect>)
          .where(and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)))
          .returning();

        if (!updatedAlert) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: updatedAlert,
        } satisfies ApiResponse<Alert>);
      } catch (error) {
        console.error('Update alert error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update alert',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /alerts/mark-all-read - Mark all alerts as read
  app.post('/mark-all-read', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const result = await db
        .update(alerts)
        .set({ isRead: true } as Partial<typeof alerts.$inferSelect>)
        .where(and(eq(alerts.tenantId, tenantId), eq(alerts.isRead, false)));

      return reply.code(200).send({
        success: true,
        message: 'All alerts marked as read',
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Mark all read error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to mark alerts as read',
      } satisfies ApiResponse);
    }
  });

  // DELETE /alerts/:id - Delete alert
  app.delete<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const deleted = await db
          .delete(alerts)
          .where(and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)))
          .returning();

        if (deleted.length === 0) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          message: 'Alert deleted successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Delete alert error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to delete alert',
        } satisfies ApiResponse);
      }
    }
  );

  // ============================================================================
  // Alert Rules CRUD Operations
  // ============================================================================

  /**
   * GET /alerts/rules - List all alert rules for tenant
   */
  app.get('/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const rules = alertRulesStore.get(tenantId) || [];

      return reply.code(200).send({
        success: true,
        data: rules,
      } satisfies ApiResponse<AlertRule[]>);
    } catch (error) {
      console.error('List alert rules error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch alert rules',
      } satisfies ApiResponse);
    }
  });

  /**
   * GET /alerts/rules/:id - Get single alert rule
   */
  app.get<{ Params: { id: string } }>(
    '/rules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const rules = alertRulesStore.get(tenantId) || [];
        const rule = rules.find((r) => r.id === id);

        if (!rule) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert rule not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: rule,
        } satisfies ApiResponse<AlertRule>);
      } catch (error) {
        console.error('Get alert rule error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch alert rule',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /alerts/rules - Create new alert rule
   */
  app.post<{ Body: z.infer<typeof createAlertRuleSchema> }>(
    '/rules',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof createAlertRuleSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);

        const validation = createAlertRuleSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { name, type, conditions, actions, isActive } = validation.data;

        // Generate unique ID
        const ruleId = `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const newRule: AlertRule = {
          id: ruleId,
          tenantId,
          name,
          type,
          conditions,
          actions,
          isActive,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Store the rule
        if (!alertRulesStore.has(tenantId)) {
          alertRulesStore.set(tenantId, []);
        }
        alertRulesStore.get(tenantId)!.push(newRule);

        // If this is a low_stock rule with a threshold, queue an immediate check
        if (type === 'low_stock' && conditions.threshold !== undefined && isActive) {
          await addAlertJob({
            tenantId,
            checkType: 'low_stock',
            threshold: conditions.threshold,
          });
        }

        return reply.code(201).send({
          success: true,
          data: newRule,
          message: 'Alert rule created successfully',
        } satisfies ApiResponse<AlertRule>);
      } catch (error) {
        console.error('Create alert rule error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create alert rule',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * PUT /alerts/rules/:id - Update alert rule
   */
  app.put<{ Params: { id: string }; Body: z.infer<typeof updateAlertRuleSchema> }>(
    '/rules/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: z.infer<typeof updateAlertRuleSchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const validation = updateAlertRuleSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const rules = alertRulesStore.get(tenantId) || [];
        const ruleIndex = rules.findIndex((r) => r.id === id);

        if (ruleIndex === -1) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert rule not found',
          } satisfies ApiResponse);
        }

        // Update the rule
        const updatedRule: AlertRule = {
          ...rules[ruleIndex],
          ...validation.data,
          updatedAt: new Date(),
        };
        rules[ruleIndex] = updatedRule;

        return reply.code(200).send({
          success: true,
          data: updatedRule,
          message: 'Alert rule updated successfully',
        } satisfies ApiResponse<AlertRule>);
      } catch (error) {
        console.error('Update alert rule error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update alert rule',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * DELETE /alerts/rules/:id - Delete alert rule
   */
  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const rules = alertRulesStore.get(tenantId) || [];
        const ruleIndex = rules.findIndex((r) => r.id === id);

        if (ruleIndex === -1) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert rule not found',
          } satisfies ApiResponse);
        }

        // Remove the rule
        rules.splice(ruleIndex, 1);

        return reply.code(200).send({
          success: true,
          message: 'Alert rule deleted successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Delete alert rule error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to delete alert rule',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /alerts/rules/:id/test - Test an alert rule
   */
  app.post<{ Params: { id: string } }>(
    '/rules/:id/test',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const rules = alertRulesStore.get(tenantId) || [];
        const rule = rules.find((r) => r.id === id);

        if (!rule) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Alert rule not found',
          } satisfies ApiResponse);
        }

        // Queue an alert check job
        const jobData: AlertJobData = {
          tenantId,
          checkType: rule.type === 'low_stock' ? 'low_stock' : rule.type === 'channel_disconnect' ? 'channel_status' : 'all',
          threshold: rule.conditions.threshold,
        };

        await addAlertJob(jobData);

        return reply.code(200).send({
          success: true,
          message: 'Alert rule test triggered',
          data: {
            ruleId: id,
            ruleName: rule.name,
            status: 'queued',
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Test alert rule error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to test alert rule',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /alerts/check - Trigger manual alert check
   */
  app.post<{
    Body?: {
      checkType?: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
      productId?: string;
      channelId?: string;
    };
  }>(
    '/check',
    async (
      request: FastifyRequest<{
        Body?: {
          checkType?: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
          productId?: string;
          channelId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const checkType = request.body?.checkType || 'all';
        const productId = request.body?.productId;
        const channelId = request.body?.channelId;

        // Queue the alert check
        await addAlertJob({
          tenantId,
          checkType,
          productId,
          channelId,
        });

        return reply.code(202).send({
          success: true,
          message: 'Alert check triggered',
          data: {
            checkType,
            productId,
            channelId,
            status: 'queued',
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Trigger alert check error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to trigger alert check',
        } satisfies ApiResponse);
      }
    }
  );
}

// Export helper to get rules for a tenant (used by sync-engine)
export function getAlertRulesForTenant(tenantId: string): AlertRule[] {
  return alertRulesStore.get(tenantId) || [];
}

// Export helper to check low stock rules
export function getLowStockThresholds(tenantId: string): number[] {
  const rules = alertRulesStore.get(tenantId) || [];
  return rules
    .filter((r) => r.type === 'low_stock' && r.isActive && r.conditions.threshold !== undefined)
    .map((r) => r.conditions.threshold!);
}

export default alertRoutes;
