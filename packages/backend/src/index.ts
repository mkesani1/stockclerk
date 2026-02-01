import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import { closeDatabaseConnection } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { channelRoutes, wixOAuthPublicRoutes } from './routes/channels.js';
import { productRoutes } from './routes/products.js';
import { alertRoutes } from './routes/alerts.js';
import { syncRoutes } from './routes/sync.js';
import { webhookRoutes } from './routes/webhooks.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { registerWebSocketRoutes, closeAllConnections } from './websocket/index.js';
import { initializeQueues, closeQueues } from './queues/index.js';
import {
  initializeSyncEngineIntegration,
  cleanupSyncEngineIntegration,
} from './sync-integration.js';

// Create Fastify instance
const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      config.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
  },
});

// Register plugins
async function registerPlugins() {
  // CORS
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // JWT
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_EXPIRES_IN,
    },
  });

  // WebSocket support
  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });
}

// Register routes
async function registerRoutes() {
  // Health check routes (unprotected)
  await app.register(healthRoutes, { prefix: '/health' });

  // Auth routes
  await app.register(authRoutes, { prefix: '/api/auth' });

  // Protected API routes
  await app.register(channelRoutes, { prefix: '/api/channels' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(alertRoutes, { prefix: '/api/alerts' });
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });

  // Webhook routes (unprotected - use signature verification)
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  // OAuth callback routes (unprotected - handles OAuth redirects)
  await app.register(wixOAuthPublicRoutes, { prefix: '/api/oauth' });

  // WebSocket routes
  await registerWebSocketRoutes(app);

  // Root route
  app.get('/', async () => {
    return {
      name: 'StockClerk API',
      version: '1.0.0',
      status: 'running',
      documentation: '/docs',
      endpoints: {
        health: '/health',
        auth: '/api/auth',
        channels: '/api/channels',
        products: '/api/products',
        alerts: '/api/alerts',
        sync: '/api/sync',
        dashboard: '/api/dashboard',
        webhooks: '/webhooks',
        websocket: '/ws',
      },
    };
  });
}

// Global error handler
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  // Handle known error types
  if (error.validation) {
    return reply.code(400).send({
      success: false,
      error: 'Validation Error',
      message: error.message,
    });
  }

  // Handle JWT errors
  if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
    return reply.code(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'No authorization header provided',
    });
  }

  // Generic error response
  const statusCode = error.statusCode || 500;
  return reply.code(statusCode).send({
    success: false,
    error: error.name || 'Internal Server Error',
    message: config.NODE_ENV === 'production' ? 'An error occurred' : error.message,
  });
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  app.log.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close WebSocket connections
    closeAllConnections('Server shutting down');
    app.log.info('WebSocket connections closed');

    // Close HTTP server
    await app.close();
    app.log.info('HTTP server closed');

    // Cleanup sync engine integration
    cleanupSyncEngineIntegration();
    app.log.info('Sync engine integration cleaned up');

    // Close queues
    await closeQueues();
    app.log.info('Queue connections closed');

    // Close database connection
    await closeDatabaseConnection();
    app.log.info('Database connection closed');

    process.exit(0);
  } catch (error) {
    app.log.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start server
async function start() {
  try {
    // Register all plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Initialize queues (may fail gracefully if Redis is not available)
    try {
      await initializeQueues();
      app.log.info('Queue system initialized');

      // Initialize sync engine integration (depends on queues)
      initializeSyncEngineIntegration();
      app.log.info('Sync engine integration initialized');
    } catch (error) {
      app.log.warn('Failed to initialize queues (Redis may not be available):', error);
      app.log.warn('The server will continue without queue functionality');
    }

    // Start listening
    const address = await app.listen({
      port: config.PORT,
      host: config.HOST,
    });

    app.log.info(`StockClerk Backend running at ${address}`);
    app.log.info(`Environment: ${config.NODE_ENV}`);
    app.log.info('Available endpoints:');
    app.log.info('  - Health:    /health');
    app.log.info('  - Auth:      /api/auth');
    app.log.info('  - Channels:  /api/channels');
    app.log.info('  - Products:  /api/products');
    app.log.info('  - Alerts:    /api/alerts');
    app.log.info('  - Sync:      /api/sync');
    app.log.info('  - Dashboard: /api/dashboard');
    app.log.info('  - Webhooks:  /webhooks');
    app.log.info('  - WebSocket: /ws');

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    app.log.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export app for testing
export { app };

// Start if running directly
start();
