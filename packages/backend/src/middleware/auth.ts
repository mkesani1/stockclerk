import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { JWTPayload, UserRole } from '../types/index.js';

// JWT verification middleware
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await request.jwtVerify<JWTPayload>();
    request.user = decoded;
  } catch (error) {
    reply.code(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

// Role-based access control middleware factory
export function requireRole(...allowedRoles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // First verify JWT
    await authenticateRequest(request, reply);

    // If auth failed, the response is already sent
    if (!request.user) {
      return;
    }

    // Check role
    if (!allowedRoles.includes(request.user.role)) {
      reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
    }
  };
}

// Helper to get current user from request (assumes auth middleware has run)
export function getCurrentUser(request: FastifyRequest): JWTPayload {
  if (!request.user) {
    throw new Error('User not authenticated. Ensure auth middleware is applied.');
  }
  return request.user;
}

// Helper to get tenant ID from authenticated request
export function getTenantId(request: FastifyRequest): string {
  return getCurrentUser(request).tenantId;
}

// Register JWT plugin configuration
export function configureJWT(app: FastifyInstance): void {
  app.register(import('@fastify/jwt'), {
    secret: process.env.JWT_SECRET ?? (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production');
      }
      return 'stockclerk-development-secret-key-32chars';
    })(),
    sign: {
      expiresIn: '7d', // Token expires in 7 days
    },
  });

  // Decorator to access user in routes
  app.decorateRequest('user', null);
}
