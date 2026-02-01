import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkDatabaseConnection } from '../db/index.js';
import type { ApiResponse } from '../types/index.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: 'up' | 'down';
      latency?: number;
    };
    redis?: {
      status: 'up' | 'down';
      latency?: number;
    };
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // GET /health - Basic health check
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    // Check database connectivity
    const dbHealthy = await checkDatabaseConnection();
    const dbLatency = Date.now() - startTime;

    // Determine overall status
    const isHealthy = dbHealthy;

    const healthStatus: HealthStatus = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      checks: {
        database: {
          status: dbHealthy ? 'up' : 'down',
          latency: dbLatency,
        },
      },
    };

    const statusCode = isHealthy ? 200 : 503;

    return reply.code(statusCode).send({
      success: isHealthy,
      data: healthStatus,
    } satisfies ApiResponse<HealthStatus>);
  });

  // GET /health/ready - Readiness probe (for Kubernetes)
  app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const dbHealthy = await checkDatabaseConnection();

    if (dbHealthy) {
      return reply.code(200).send({
        success: true,
        message: 'Service is ready',
      } satisfies ApiResponse);
    }

    return reply.code(503).send({
      success: false,
      error: 'Service not ready',
      message: 'Database connection not available',
    } satisfies ApiResponse);
  });

  // GET /health/live - Liveness probe (for Kubernetes)
  app.get('/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Simple liveness check - just verify the process is responsive
    return reply.code(200).send({
      success: true,
      message: 'Service is alive',
    } satisfies ApiResponse);
  });
}

export default healthRoutes;
