import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, gt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, pool } from '../db/index.js';
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
import { sendEmail, passwordResetEmail, welcomeEmail } from '../services/email.js';
import { config } from '../config/index.js';

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
          // Set trial to end 14 days from now
          const trialEndsAt = new Date();
          trialEndsAt.setDate(trialEndsAt.getDate() + 14);

          // Create tenant
          const [newTenant] = await tx
            .insert(tenants)
            .values({
              name: tenantName,
              slug: tenantSlug,
              trialEndsAt,
            } as typeof tenants.$inferInsert)
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
            } as typeof users.$inferInsert)
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

        // Send welcome email (non-blocking)
        const welcomeContent = welcomeEmail(name || undefined, `${config.FRONTEND_URL}/login`);
        welcomeContent.to = email;
        sendEmail(welcomeContent).catch((err) => console.error('Failed to send welcome email:', err));

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
          .set({ onboardingComplete: true } as Partial<typeof users.$inferSelect>)
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
  // POST /auth/forgot-password - Request password reset email
  app.post<{ Body: { email: string } }>(
    '/forgot-password',
    async (request: FastifyRequest<{ Body: { email: string } }>, reply: FastifyReply) => {
      try {
        const { email } = request.body;
        if (!email) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Email is required',
          } satisfies ApiResponse);
        }

        // Always return success to prevent email enumeration
        const successResponse = {
          success: true,
          message: 'If an account with that email exists, a password reset link has been sent.',
        } satisfies ApiResponse;

        // Find user
        const user = await db.query.users.findFirst({
          where: eq(users.email, email.toLowerCase().trim()),
        });

        if (!user) {
          return reply.code(200).send(successResponse);
        }

        // Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Invalidate any existing tokens for this user and insert new one
        const client = await pool.connect();
        try {
          await client.query(
            'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
            [user.id]
          );
          await client.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt]
          );
        } finally {
          client.release();
        }

        // Send email
        const resetUrl = `${config.FRONTEND_URL}/reset-password?token=${token}`;
        const emailContent = passwordResetEmail(resetUrl, user.name || undefined);
        emailContent.to = user.email;
        await sendEmail(emailContent);

        return reply.code(200).send(successResponse);
      } catch (error) {
        console.error('Forgot password error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to process request',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /auth/reset-password - Reset password with token
  app.post<{ Body: { token: string; password: string } }>(
    '/reset-password',
    async (request: FastifyRequest<{ Body: { token: string; password: string } }>, reply: FastifyReply) => {
      try {
        const { token, password } = request.body;

        if (!token || !password) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Token and new password are required',
          } satisfies ApiResponse);
        }

        if (password.length < 8) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Password must be at least 8 characters',
          } satisfies ApiResponse);
        }

        // Find valid token
        const client = await pool.connect();
        try {
          const result = await client.query(
            'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()',
            [token]
          );

          if (result.rows.length === 0) {
            return reply.code(400).send({
              success: false,
              error: 'Invalid or expired token',
              message: 'This password reset link is invalid or has expired. Please request a new one.',
            } satisfies ApiResponse);
          }

          const resetToken = result.rows[0];

          // Hash new password
          const newPasswordHash = await hashPassword(password);

          // Update password and mark token as used
          await client.query('BEGIN');
          await client.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newPasswordHash, resetToken.user_id]
          );
          await client.query(
            'UPDATE password_reset_tokens SET used = true WHERE id = $1',
            [resetToken.id]
          );
          await client.query('COMMIT');

          return reply.code(200).send({
            success: true,
            message: 'Password has been reset successfully. You can now sign in with your new password.',
          } satisfies ApiResponse);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('Reset password error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to reset password',
        } satisfies ApiResponse);
      }
    }
  );
}

export default authRoutes;
