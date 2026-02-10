/**
 * Eposnow App Store Landing Flow Routes
 * Handles merchant onboarding from Eposnow App Store
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { db } from '../db/index.js';
import { tenants, users, channels } from '../db/schema.js';
import { encryptCredentials } from './channels.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';
import type { ApiResponse } from '../types/index.js';
import bcrypt from 'bcryptjs';

// Types for request bodies
interface ConnectRequest {
  apiKey: string;
  apiSecret: string;
  deviceId: string;
}

interface RegisterAndConnectRequest {
  name: string;
  businessName: string;
  email: string;
  password: string;
  apiKey: string;
  apiSecret: string;
  deviceId: string;
}

interface ValidateCredentialsRequest {
  apiKey: string;
  apiSecret: string;
}

// Eposnow API base URL
const EPOSNOW_API_BASE = 'https://api.eposnowhq.com';

/**
 * Validates Eposnow API credentials by attempting Basic Auth token exchange
 */
async function validateEposnowCredentials(apiKey: string, apiSecret: string): Promise<boolean> {
  try {
    const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const response = await axios.post(
      `${EPOSNOW_API_BASE}/api/v4/auth/token`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return response.status === 200 && !!response.data?.access_token;
  } catch {
    return false;
  }
}

export async function eposnowAppStoreRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /eposnow/connect
   * Connect an Eposnow device to an existing authenticated user's tenant
   */
  app.post<{ Body: ConnectRequest }>(
    '/eposnow/connect',
    { preHandler: authenticateRequest },
    async (request: FastifyRequest<{ Body: ConnectRequest }>, reply: FastifyReply) => {
      try {
        const { apiKey, apiSecret, deviceId } = request.body;
        const tenantId = getTenantId(request);

        // Validate input
        if (!apiKey || !apiSecret || !deviceId) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Missing required fields: apiKey, apiSecret, deviceId',
          } satisfies ApiResponse);
        }

        // Validate Eposnow credentials
        const isValid = await validateEposnowCredentials(apiKey, apiSecret);
        if (!isValid) {
          return reply.code(401).send({
            success: false,
            error: 'Invalid credentials',
            message: 'Unable to authenticate with Eposnow. Please check your API key and secret.',
          } satisfies ApiResponse);
        }

        // Encrypt credentials
        const credentialsEncrypted = encryptCredentials({
          apiKey,
          apiSecret,
          deviceId,
        });

        // Create channel for this tenant
        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId,
            type: 'eposnow',
            name: `Eposnow POS (${deviceId})`,
            credentialsEncrypted,
            externalInstanceId: deviceId,
          } as typeof channels.$inferInsert)
          .returning();

        // Remove encrypted credentials from response
        const { credentialsEncrypted: _, ...safeChannel } = newChannel;

        return reply.code(201).send({
          success: true,
          data: safeChannel,
          message: 'Eposnow device connected successfully',
        } satisfies ApiResponse);
      } catch (error) {
        app.log.error({ err: error }, 'Eposnow connect error');
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to connect Eposnow device',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /eposnow/register-and-connect
   * Register a new user AND connect their Eposnow device in one step
   * Unprotected — handles its own auth
   */
  app.post<{ Body: RegisterAndConnectRequest }>(
    '/eposnow/register-and-connect',
    async (request: FastifyRequest<{ Body: RegisterAndConnectRequest }>, reply: FastifyReply) => {
      try {
        const {
          name,
          businessName,
          email,
          password,
          apiKey,
          apiSecret,
          deviceId,
        } = request.body;

        // Validate input
        if (!name || !businessName || !email || !password || !apiKey || !apiSecret || !deviceId) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'All fields are required',
          } satisfies ApiResponse);
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Invalid email format',
          } satisfies ApiResponse);
        }

        if (password.length < 8) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'Password must be at least 8 characters',
          } satisfies ApiResponse);
        }

        // Check if user already exists
        const existingUser = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (existingUser) {
          return reply.code(409).send({
            success: false,
            error: 'Conflict',
            message: 'An account with this email already exists. Please sign in instead.',
          } satisfies ApiResponse);
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Generate tenant slug
        const slug = `epos-${businessName
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .substring(0, 40)}-${Date.now().toString(36)}`;

        // Encrypt Eposnow credentials
        const credentialsEncrypted = encryptCredentials({
          apiKey,
          apiSecret,
          deviceId,
        });

        // Create tenant → user → channel
        const [newTenant] = await db
          .insert(tenants)
          .values({
            name: businessName,
            slug,
            source: 'eposnow_appstore',
          } as typeof tenants.$inferInsert)
          .returning();

        const [newUser] = await db
          .insert(users)
          .values({
            tenantId: newTenant.id,
            email,
            passwordHash,
            name,
            role: 'owner',
            authMethod: 'password',
            onboardingComplete: false,
          } as typeof users.$inferInsert)
          .returning();

        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId: newTenant.id,
            type: 'eposnow',
            name: `Eposnow POS (${deviceId})`,
            credentialsEncrypted,
            externalInstanceId: deviceId,
          } as typeof channels.$inferInsert)
          .returning();

        // Generate JWT token
        const token = app.jwt.sign({
          userId: newUser.id,
          tenantId: newTenant.id,
          email: newUser.email,
          role: newUser.role,
          isSuperAdmin: false,
        });

        app.log.info(
          `Eposnow App Store registration complete: tenant=${newTenant.id}, user=${newUser.id}, channel=${newChannel.id}`
        );

        const { credentialsEncrypted: _, ...safeChannel } = newChannel;

        return reply.code(201).send({
          success: true,
          data: {
            tokens: {
              accessToken: token,
            },
            user: {
              id: newUser.id,
              email: newUser.email,
              name: newUser.name,
              role: newUser.role,
              onboardingComplete: false,
            },
            tenant: {
              id: newTenant.id,
              name: newTenant.name,
            },
            channel: safeChannel,
          },
          message: 'Account created and Eposnow device connected',
        } satisfies ApiResponse);
      } catch (error) {
        app.log.error({ err: error }, 'Eposnow register-and-connect error');
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create account. Please try again.',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /eposnow/validate-credentials
   * Quick test of Eposnow API credentials (doesn't store anything)
   */
  app.post<{ Body: ValidateCredentialsRequest }>(
    '/eposnow/validate-credentials',
    async (request: FastifyRequest<{ Body: ValidateCredentialsRequest }>, reply: FastifyReply) => {
      try {
        const { apiKey, apiSecret } = request.body;

        if (!apiKey || !apiSecret) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: 'apiKey and apiSecret are required',
          } satisfies ApiResponse);
        }

        const isValid = await validateEposnowCredentials(apiKey, apiSecret);

        return reply.code(200).send({
          success: true,
          data: {
            valid: isValid,
            message: isValid
              ? 'Eposnow credentials are valid'
              : 'Unable to authenticate with Eposnow. Please check your credentials.',
          },
        } satisfies ApiResponse);
      } catch (error) {
        app.log.error({ err: error }, 'Eposnow validate credentials error');
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to validate credentials',
        } satisfies ApiResponse);
      }
    }
  );
}

export default eposnowAppStoreRoutes;
