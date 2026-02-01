import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';
import { db } from '../db/index.js';
import { channels } from '../db/schema.js';
import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
  type ApiResponse,
  type Channel,
} from '../types/index.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';
import crypto from 'crypto';

// Wix OAuth configuration
const WIX_CLIENT_ID = process.env.WIX_CLIENT_ID || '';
const WIX_CLIENT_SECRET = process.env.WIX_CLIENT_SECRET || '';
const WIX_REDIRECT_URI = process.env.WIX_REDIRECT_URI || 'http://localhost:3001/api/oauth/wix/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const WIX_OAUTH_URL = 'https://www.wixapis.com/oauth';

// Temporary storage for OAuth state (use Redis in production)
const oauthStateMap = new Map<string, { tenantId: string; timestamp: number }>();

// Clean up expired OAuth states (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStateMap.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      oauthStateMap.delete(state);
    }
  }
}, 60000);

// Simple encryption for credentials (use a proper KMS in production)
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-char-encryption-key-here';

function encryptCredentials(credentials: Record<string, unknown>): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptCredentials(encryptedData: string): Record<string, unknown> {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', authenticateRequest);

  // GET /channels - List all channels for tenant
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      const tenantChannels = await db.query.channels.findMany({
        where: eq(channels.tenantId, tenantId),
        orderBy: (channels, { desc }) => [desc(channels.createdAt)],
      });

      // Remove encrypted credentials from response
      const safeChannels = tenantChannels.map(({ credentialsEncrypted, ...rest }) => rest);

      return reply.code(200).send({
        success: true,
        data: safeChannels,
      } satisfies ApiResponse<Omit<Channel, 'credentialsEncrypted'>[]>);
    } catch (error) {
      console.error('List channels error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch channels',
      } satisfies ApiResponse);
    }
  });

  // GET /channels/:id - Get single channel
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const channel = await db.query.channels.findFirst({
          where: and(eq(channels.id, id), eq(channels.tenantId, tenantId)),
        });

        if (!channel) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Channel not found',
          } satisfies ApiResponse);
        }

        // Remove encrypted credentials
        const { credentialsEncrypted, ...safeChannel } = channel;

        return reply.code(200).send({
          success: true,
          data: safeChannel,
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Get channel error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch channel',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /channels - Create new channel
  app.post<{ Body: CreateChannelInput }>(
    '/',
    async (request: FastifyRequest<{ Body: CreateChannelInput }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);

        const validation = createChannelSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { type, name, credentials } = validation.data;

        // Encrypt credentials if provided
        const credentialsEncrypted = credentials ? encryptCredentials(credentials) : null;

        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId,
            type,
            name,
            credentialsEncrypted,
          })
          .returning();

        // Remove encrypted credentials from response
        const { credentialsEncrypted: _, ...safeChannel } = newChannel;

        return reply.code(201).send({
          success: true,
          data: safeChannel,
          message: 'Channel created successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Create channel error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create channel',
        } satisfies ApiResponse);
      }
    }
  );

  // PATCH /channels/:id - Update channel
  app.patch<{ Params: { id: string }; Body: UpdateChannelInput }>(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateChannelInput }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const validation = updateChannelSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        // Check channel exists and belongs to tenant
        const existingChannel = await db.query.channels.findFirst({
          where: and(eq(channels.id, id), eq(channels.tenantId, tenantId)),
        });

        if (!existingChannel) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Channel not found',
          } satisfies ApiResponse);
        }

        const { credentials, ...updateData } = validation.data;

        // Build update object
        const updates: Record<string, unknown> = { ...updateData };
        if (credentials) {
          updates.credentialsEncrypted = encryptCredentials(credentials);
        }

        const [updatedChannel] = await db
          .update(channels)
          .set(updates)
          .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
          .returning();

        // Remove encrypted credentials
        const { credentialsEncrypted: _, ...safeChannel } = updatedChannel;

        return reply.code(200).send({
          success: true,
          data: safeChannel,
          message: 'Channel updated successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Update channel error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update channel',
        } satisfies ApiResponse);
      }
    }
  );

  // DELETE /channels/:id - Delete channel
  app.delete<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const deleted = await db
          .delete(channels)
          .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
          .returning();

        if (deleted.length === 0) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Channel not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          message: 'Channel deleted successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Delete channel error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to delete channel',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /channels/:id/test - Test channel connection
  app.post<{ Params: { id: string } }>(
    '/:id/test',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const channel = await db.query.channels.findFirst({
          where: and(eq(channels.id, id), eq(channels.tenantId, tenantId)),
        });

        if (!channel) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Channel not found',
          } satisfies ApiResponse);
        }

        // Decrypt credentials for testing
        let credentials: Record<string, unknown> | null = null;
        if (channel.credentialsEncrypted) {
          credentials = decryptCredentials(channel.credentialsEncrypted);
        }

        // TODO: Implement actual connection testing per channel type
        // This will be handled by Agent 2 (Integrations)
        const testResult = {
          channelId: id,
          type: channel.type,
          status: 'pending',
          message: 'Connection test will be implemented by integration layer',
        };

        return reply.code(200).send({
          success: true,
          data: testResult,
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Test channel error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to test channel connection',
        } satisfies ApiResponse);
      }
    }
  );

  // ============================================================================
  // Wix OAuth Flow
  // ============================================================================

  /**
   * GET /channels/wix/oauth-start
   * Start the Wix OAuth flow - returns authorization URL
   */
  app.get('/wix/oauth-start', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      if (!WIX_CLIENT_ID) {
        return reply.code(500).send({
          success: false,
          error: 'Configuration error',
          message: 'Wix OAuth not configured',
        } satisfies ApiResponse);
      }

      // Generate a random state for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');

      // Store the state with tenant ID for callback verification
      oauthStateMap.set(state, { tenantId, timestamp: Date.now() });

      // Build the authorization URL
      const params = new URLSearchParams({
        client_id: WIX_CLIENT_ID,
        redirect_uri: WIX_REDIRECT_URI,
        response_type: 'code',
        scope: 'wix.stores.inventory.read wix.stores.inventory.update wix.stores.products.read',
        state,
      });

      const authUrl = `${WIX_OAUTH_URL}/authorize?${params.toString()}`;

      return reply.code(200).send({
        success: true,
        data: { authUrl, state },
      } satisfies ApiResponse);
    } catch (error) {
      console.error('Wix OAuth start error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to start Wix OAuth flow',
      } satisfies ApiResponse);
    }
  });

  /**
   * GET /channels/wix/oauth-callback
   * Handle the Wix OAuth callback - exchanges code for tokens
   */
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>(
    '/wix/oauth-callback',
    { preHandler: [] }, // Skip auth for callback
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { code, state, error, error_description } = request.query;

        // Handle OAuth errors from Wix
        if (error) {
          console.error('Wix OAuth error:', error, error_description);
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent(error_description || error)}`
          );
        }

        // Validate state
        if (!state || !oauthStateMap.has(state)) {
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent('Invalid or expired OAuth state')}`
          );
        }

        const stateData = oauthStateMap.get(state)!;
        oauthStateMap.delete(state); // Use state only once

        // Validate code
        if (!code) {
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent('No authorization code received')}`
          );
        }

        // Exchange code for tokens
        const tokenResponse = await axios.post<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
        }>(`${WIX_OAUTH_URL}/access`, {
          grant_type: 'authorization_code',
          client_id: WIX_CLIENT_ID,
          client_secret: WIX_CLIENT_SECRET,
          code,
          redirect_uri: WIX_REDIRECT_URI,
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // Extract instance ID from token (Wix tokens contain this info)
        let instanceId = '';
        try {
          const tokenParts = access_token.split('.');
          if (tokenParts.length >= 2) {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            instanceId = payload.instanceId || payload.instance_id || '';
          }
        } catch {
          // Token parsing failed, continue without instance ID
        }

        // Store credentials encrypted
        const credentials = {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
          instanceId,
        };

        // Create the Wix channel
        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId: stateData.tenantId,
            type: 'wix',
            name: 'Wix Store',
            credentialsEncrypted: encryptCredentials(credentials),
            isActive: true,
          })
          .returning();

        // Redirect to frontend with success
        return reply.redirect(
          `${FRONTEND_URL}/onboarding?channel=${newChannel.id}&type=wix&success=true`
        );
      } catch (error) {
        console.error('Wix OAuth callback error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return reply.redirect(
          `${FRONTEND_URL}/onboarding?error=${encodeURIComponent(errorMessage)}`
        );
      }
    }
  );
}

/**
 * Wix OAuth public routes (no authentication required)
 * These need to be registered separately without the auth hook
 */
export async function wixOAuthPublicRoutes(app: FastifyInstance): Promise<void> {
  // This is a duplicate of the callback route for when it needs to be registered
  // at a different path without auth. The main channelRoutes version has auth.
  // In the route registration, use this for /api/oauth/wix/callback

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>(
    '/wix/callback',
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { code, state, error, error_description } = request.query;

        // Handle OAuth errors from Wix
        if (error) {
          console.error('Wix OAuth error:', error, error_description);
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent(error_description || error)}`
          );
        }

        // Validate state
        if (!state || !oauthStateMap.has(state)) {
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent('Invalid or expired OAuth state')}`
          );
        }

        const stateData = oauthStateMap.get(state)!;
        oauthStateMap.delete(state);

        if (!code) {
          return reply.redirect(
            `${FRONTEND_URL}/onboarding?error=${encodeURIComponent('No authorization code received')}`
          );
        }

        // Exchange code for tokens
        const tokenResponse = await axios.post<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
        }>(`${WIX_OAUTH_URL}/access`, {
          grant_type: 'authorization_code',
          client_id: WIX_CLIENT_ID,
          client_secret: WIX_CLIENT_SECRET,
          code,
          redirect_uri: WIX_REDIRECT_URI,
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // Extract instance ID from token
        let instanceId = '';
        try {
          const tokenParts = access_token.split('.');
          if (tokenParts.length >= 2) {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            instanceId = payload.instanceId || payload.instance_id || '';
          }
        } catch {
          // Token parsing failed
        }

        const credentials = {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
          instanceId,
        };

        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId: stateData.tenantId,
            type: 'wix',
            name: 'Wix Store',
            credentialsEncrypted: encryptCredentials(credentials),
            isActive: true,
          })
          .returning();

        return reply.redirect(
          `${FRONTEND_URL}/onboarding?channel=${newChannel.id}&type=wix&success=true`
        );
      } catch (error) {
        console.error('Wix OAuth callback error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return reply.redirect(
          `${FRONTEND_URL}/onboarding?error=${encodeURIComponent(errorMessage)}`
        );
      }
    }
  );
}

// Export helper functions for other agents
export { encryptCredentials, decryptCredentials, oauthStateMap };

export default channelRoutes;
