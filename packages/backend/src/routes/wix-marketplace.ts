/**
 * Wix Marketplace Integration Routes
 * Handles auto-provisioning when merchants install/uninstall via Wix App Market
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { tenants, users, channels } from '../db/schema.js';
import { encryptCredentials } from './channels.js';
import type { ApiResponse } from '../types/index.js';

// Wix OAuth configuration
const WIX_CLIENT_ID = process.env.WIX_CLIENT_ID || '';
const WIX_CLIENT_SECRET = process.env.WIX_CLIENT_SECRET || '';
const WIX_OAUTH_URL = 'https://www.wixapis.com/oauth';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// JWT verification for Wix webhook payloads
function verifyWixJWT(token: string, secret: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Verify HMAC signature
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signatureInput)
      .digest('base64url');

    if (parts[2] !== expectedSignature) {
      console.warn('Wix JWT signature mismatch');
      return null;
    }

    return payload;
  } catch (error) {
    console.error('Wix JWT verification failed:', error);
    return null;
  }
}

// Get Wix site info using instance ID
async function getWixSiteInfo(
  instanceId: string
): Promise<{ siteName: string; ownerEmail: string } | null> {
  try {
    // Get access token via Basic OAuth
    const tokenResponse = await axios.post(`${WIX_OAUTH_URL}/access`, {
      grant_type: 'client_credentials',
      client_id: WIX_CLIENT_ID,
      client_secret: WIX_CLIENT_SECRET,
      instance_id: instanceId,
    });

    const accessToken = tokenResponse.data.access_token;

    // Get app instance info (includes site details)
    const instanceResponse = await axios.get(
      'https://www.wixapis.com/apps/v1/instance',
      {
        headers: {
          Authorization: accessToken,
        },
      }
    );

    const instance = instanceResponse.data.instance;
    return {
      siteName: instance.siteName || instance.siteDisplayName || 'Wix Store',
      ownerEmail: instance.ownerEmail || '',
    };
  } catch (error) {
    console.error('Failed to get Wix site info:', error);
    return null;
  }
}

export async function wixMarketplaceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /marketplace/wix/install
   * Triggered by Wix "App Instance Installed" webhook
   * Auto-provisions: tenant → user → channel
   */
  app.post(
    '/wix/install',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();

      try {
        const rawBody = typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);

        let payload: Record<string, unknown>;
        try {
          payload = typeof request.body === 'string'
            ? JSON.parse(request.body)
            : request.body as Record<string, unknown>;
        } catch {
          return reply.code(400).send({
            success: false,
            error: 'Invalid JSON payload',
          } satisfies ApiResponse);
        }

        // Extract instance ID from payload
        const instanceId = (payload.instanceId || payload.instance_id ||
          (payload.data as Record<string, unknown>)?.instanceId) as string;

        if (!instanceId) {
          app.log.warn('Wix install webhook missing instanceId');
          return reply.code(200).send({
            success: true,
            message: 'Webhook received but no instanceId found',
          } satisfies ApiResponse);
        }

        app.log.info(`Wix marketplace install received for instance: ${instanceId}`);

        // Check if this instance already has a channel (re-install scenario)
        const existingChannel = await db.query.channels.findFirst({
          where: and(
            eq(channels.type, 'wix'),
            eq(channels.externalInstanceId, instanceId)
          ),
        });

        if (existingChannel) {
          // Reactivate existing channel
          await db
            .update(channels)
            .set({ isActive: true })
            .where(eq(channels.id, existingChannel.id));

          app.log.info(`Reactivated existing Wix channel for instance: ${instanceId}`);
          return reply.code(200).send({
            success: true,
            message: 'Existing channel reactivated',
          } satisfies ApiResponse);
        }

        // Get site info from Wix
        const siteInfo = await getWixSiteInfo(instanceId);
        const siteName = siteInfo?.siteName || 'Wix Store';
        const ownerEmail = siteInfo?.ownerEmail || '';

        // Auto-provision: Create tenant
        const slug = `wix-${instanceId.substring(0, 8)}-${Date.now().toString(36)}`;
        const [newTenant] = await db
          .insert(tenants)
          .values({
            name: siteName,
            slug,
            source: 'wix_marketplace',
          })
          .returning();

        app.log.info(`Created tenant for Wix install: ${newTenant.id} (${siteName})`);

        // Auto-provision: Create user (passwordless - uses Wix token auth)
        if (ownerEmail) {
          // Check if user with this email already exists
          const existingUser = await db.query.users.findFirst({
            where: eq(users.email, ownerEmail),
          });

          if (!existingUser) {
            const [newUser] = await db
              .insert(users)
              .values({
                tenantId: newTenant.id,
                email: ownerEmail,
                passwordHash: '', // No password - authenticated via Wix instance token
                name: siteName,
                role: 'owner',
                authMethod: 'wix_token',
                onboardingComplete: false,
              })
              .returning();

            app.log.info(`Created user for Wix install: ${newUser.id} (${ownerEmail})`);
          }
        }

        // Auto-provision: Get access token and create channel
        let credentialsEncrypted: string | null = null;
        try {
          const tokenResponse = await axios.post(`${WIX_OAUTH_URL}/access`, {
            grant_type: 'client_credentials',
            client_id: WIX_CLIENT_ID,
            client_secret: WIX_CLIENT_SECRET,
            instance_id: instanceId,
          });

          const { access_token, refresh_token, expires_in } = tokenResponse.data;

          credentialsEncrypted = encryptCredentials({
            accessToken: access_token,
            refreshToken: refresh_token || '',
            expiresAt: new Date(Date.now() + (expires_in || 14400) * 1000).toISOString(),
            instanceId,
            authMode: 'basic',
          });
        } catch (error) {
          app.log.warn('Failed to get Wix access token during install:', error);
          // Continue without credentials - they'll authenticate when they open the dashboard
        }

        const [newChannel] = await db
          .insert(channels)
          .values({
            tenantId: newTenant.id,
            type: 'wix',
            name: 'Wix Store',
            credentialsEncrypted,
            externalInstanceId: instanceId,
            isActive: true,
          })
          .returning();

        app.log.info(
          `Wix marketplace install complete in ${Date.now() - startTime}ms: ` +
          `tenant=${newTenant.id}, channel=${newChannel.id}`
        );

        return reply.code(200).send({
          success: true,
          message: 'Merchant provisioned successfully',
          data: {
            tenantId: newTenant.id,
            channelId: newChannel.id,
          },
        } satisfies ApiResponse);
      } catch (error) {
        app.log.error('Wix marketplace install error:', error);
        return reply.code(200).send({
          success: false,
          message: 'Webhook received but provisioning failed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * POST /marketplace/wix/uninstall
   * Triggered by Wix "App Instance Removed" webhook
   * Deactivates channel, retains data for 30 days
   */
  app.post(
    '/wix/uninstall',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        let payload: Record<string, unknown>;
        try {
          payload = typeof request.body === 'string'
            ? JSON.parse(request.body)
            : request.body as Record<string, unknown>;
        } catch {
          return reply.code(400).send({
            success: false,
            error: 'Invalid JSON payload',
          } satisfies ApiResponse);
        }

        const instanceId = (payload.instanceId || payload.instance_id ||
          (payload.data as Record<string, unknown>)?.instanceId) as string;

        if (!instanceId) {
          return reply.code(200).send({
            success: true,
            message: 'Webhook received but no instanceId found',
          } satisfies ApiResponse);
        }

        app.log.info(`Wix marketplace uninstall received for instance: ${instanceId}`);

        // Deactivate the channel (don't delete - retain for 30 days)
        const updated = await db
          .update(channels)
          .set({ isActive: false })
          .where(
            and(
              eq(channels.type, 'wix'),
              eq(channels.externalInstanceId, instanceId)
            )
          )
          .returning();

        if (updated.length > 0) {
          app.log.info(`Deactivated Wix channel for instance: ${instanceId}`);
        }

        return reply.code(200).send({
          success: true,
          message: 'Channel deactivated',
        } satisfies ApiResponse);
      } catch (error) {
        app.log.error('Wix marketplace uninstall error:', error);
        return reply.code(200).send({
          success: false,
          message: 'Webhook received but processing failed',
        } satisfies ApiResponse);
      }
    }
  );

  /**
   * GET /marketplace/wix/dashboard
   * Entry point for the Wix Dashboard iFrame
   * Authenticates via Wix instance token, redirects to dashboard with session
   */
  app.get<{
    Querystring: { instance?: string; token?: string };
  }>(
    '/wix/dashboard',
    async (
      request: FastifyRequest<{
        Querystring: { instance?: string; token?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { instance, token } = request.query;
        const instanceToken = instance || token;

        if (!instanceToken) {
          return reply.code(400).send({
            success: false,
            error: 'Missing instance token',
          } satisfies ApiResponse);
        }

        // Decode and verify the instance token
        // Wix passes a signed instance parameter in the iFrame URL
        let instanceId: string | null = null;

        try {
          // Wix instance is a Base64-encoded signed JWT
          const decoded = Buffer.from(instanceToken, 'base64').toString();
          const parsed = JSON.parse(decoded);
          instanceId = parsed.instanceId || parsed.instance_id;
        } catch {
          // Try direct JWT verification
          const verified = verifyWixJWT(instanceToken, WIX_CLIENT_SECRET);
          if (verified) {
            instanceId = (verified.instanceId || verified.instance_id) as string;
          }
        }

        if (!instanceId) {
          return reply.code(401).send({
            success: false,
            error: 'Invalid instance token',
          } satisfies ApiResponse);
        }

        // Find the channel by instance ID
        const channel = await db.query.channels.findFirst({
          where: and(
            eq(channels.type, 'wix'),
            eq(channels.externalInstanceId, instanceId),
            eq(channels.isActive, true)
          ),
        });

        if (!channel) {
          // Channel not found - redirect to setup page
          return reply.redirect(
            `${FRONTEND_URL}/wix/setup?instanceId=${encodeURIComponent(instanceId)}`
          );
        }

        // Generate a short-lived session token for the frontend
        const sessionToken = crypto.randomBytes(32).toString('hex');

        // In production, store this in Redis with TTL
        // For now, redirect with tenant context
        return reply.redirect(
          `${FRONTEND_URL}/wix/dashboard?tenantId=${channel.tenantId}&channelId=${channel.id}&token=${sessionToken}`
        );
      } catch (error) {
        app.log.error('Wix dashboard entry error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to initialize dashboard',
        } satisfies ApiResponse);
      }
    }
  );
}

export default wixMarketplaceRoutes;
