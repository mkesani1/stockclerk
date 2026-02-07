import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import {
  registerSchema,
  loginSchema,
  type RegisterInput,
  type LoginInput,
  type LoginResponse,
  type RegisterResponse,
  type ApiResponse,
  type SafeUser,
  type JWTPayload,
} from '../types/index.js';
import { authenticateRequest } from '../middleware/auth.js';

// Password hashing configuration
const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Remove sensitive data from user object
function toSafeUser(user: typeof users.$inferSelect): SafeUser {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register - Create new tenant and first user (owner)
  app.post<{ Body: RegisterInput }>(
    '/register',
    async (request: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) => {
      try {
        // Validate request body
        const validation = registerSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { tenantName, tenantSlug, email, password, name } = validation.data;

        // Check if tenant slug already exists
        const existingTenant = await db.query.tenants.findFirst({
          where: eq(tenants.slug, tenantSlug),
        });

        if (existingTenant) {
          return reply.code(409).send({
            success: false,
            error: 'Conflict',
            message: 'A tenant with this slug already exists',
          } satisfies ApiResponse);
        }

        // Check if email already exists
        const existingUser = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (existingUser) {
          return reply.code(409).send({
            success: false,
            error: 'Conflict',
            message: 'A user with this email already exists',
          } satisfies ApiResponse);
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        // Create tenant and user in a transaction
        const result = await db.transaction(async (tx) => {
          // Create tenant
          const [newTenant] = await tx
            .insert(tenants)
            .values({
              name: tenantName,
              slug: tenantSlug,
            })
            .returning();

          // Create owner user
          const [newUser] = await tx
            .insert(users)
            .values({
              tenantId: newTenant.id,
              email,
              passwordHash,
              name: name || null,
              role: 'owner',
              onboardingComplete: false,
            })
            .returning();

          return { tenant: newTenant, user: newUser };
        });

        // Generate JWT
        const payload: JWTPayload = {
          userId: result.user.id,
          tenantId: result.tenant.id,
          email: result.user.email,
          role: result.user.role,
          isSuperAdmin: result.user.isSuperAdmin,
        };

        const accessToken = app.jwt.sign(payload);

        const response: RegisterResponse = {
          user: toSafeUser(result.user),
          tenant: result.tenant,
          tokens: {
            accessToken,
            expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
          },
        };

        return reply.code(201).send({
          success: true,
          data: response,
          message: 'Registration successful',
        } satisfies ApiResponse<RegisterResponse>);
      } catch (error) {
        console.error('Registration error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to complete registration',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /auth/login - Authenticate user and return JWT
  app.post<{ Body: LoginInput }>(
    '/login',
    async (request: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) => {
      try {
        // Validate request body
        const validation = loginSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { email, password } = validation.data;

        // Find user by email
        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
          with: {
            tenant: true,
          },
        });

        if (!user) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
            message: 'Invalid email or password',
          } satisfies ApiResponse);
        }

        // Verify password
        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
            message: 'Invalid email or password',
          } satisfies ApiResponse);
        }

        // Generate JWT
        const payload: JWTPayload = {
          userId: user.id,
          tenantId: user.tenantId,
          email: user.email,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
        };

        const accessToken = app.jwt.sign(payload);

        const response: LoginResponse = {
          user: toSafeUser(user),
          tenant: user.tenant,
          tokens: {
            accessToken,
            expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
          },
        };

        return reply.code(200).send({
          success: true,
          data: response,
          message: 'Login successful',
        } satisfies ApiResponse<LoginResponse>);
      } catch (error) {
        console.error('Login error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to complete login',
        } satisfies ApiResponse);
      }
    }
  );

  // GET /auth/me - Get current user info (protected route)
  app.get(
    '/me',
    { preHandler: [authenticateRequest] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
          } satisfies ApiResponse);
        }

        // Fetch fresh user data
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.userId),
          with: {
            tenant: true,
          },
        });

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'User not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: {
            user: toSafeUser(user),
            tenant: user.tenant,
          },
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Get user error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch user data',
        } satisfies ApiResponse);
      }
    }
  );

  // PATCH /auth/onboarding-complete - Mark onboarding as complete (protected route)
  app.patch(
    '/onboarding-complete',
    { preHandler: [authenticateRequest] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
          } satisfies ApiResponse);
        }

        // Update user's onboarding status in the database
        const [updatedUser] = await db
          .update(users)
          .set({ onboardingComplete: true })
          .where(eq(users.id, request.user.userId))
          .returning();

        if (!updatedUser) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'User not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: { onboardingComplete: true },
          message: 'Onboarding marked as complete',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Onboarding complete error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update onboarding status',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /auth/refresh - Refresh JWT token (protected route)
  app.post(
    '/refresh',
    { preHandler: [authenticateRequest] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
          } satisfies ApiResponse);
        }

        // Verify user still exists and is active
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.userId),
        });

        if (!user) {
          return reply.code(401).send({
            success: false,
            error: 'Unauthorized',
            message: 'User no longer exists',
          } satisfies ApiResponse);
        }

        // Generate new JWT
        const payload: JWTPayload = {
          userId: user.id,
          tenantId: user.tenantId,
          email: user.email,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
        };

        const accessToken = app.jwt.sign(payload);

        return reply.code(200).send({
          success: true,
          data: {
            accessToken,
            expiresIn: 7 * 24 * 60 * 60,
          },
          message: 'Token refreshed successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Token refresh error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to refresh token',
        } satisfies ApiResponse);
      }
    }
  );
}

export default authRoutes;
