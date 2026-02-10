import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { tenants, users, channels } from '../db/schema.js';
import { getTenantId } from '../middleware/auth.js';

// Initialize Stripe
const stripe = new Stripe(config.STRIPE_SECRET_KEY);

// Plan configuration mapping
const PLAN_CONFIG = {
  starter: {
    priceId: config.STRIPE_PRICE_STARTER,
    shopLimit: 3,
    name: 'starter',
  },
  growth: {
    priceId: config.STRIPE_PRICE_GROWTH,
    shopLimit: 10,
    name: 'growth',
  },
};

// Map price IDs to plan configurations
function getPlanFromPriceId(priceId: string): { name: string; shopLimit: number } | null {
  for (const [, config] of Object.entries(PLAN_CONFIG)) {
    if (config.priceId === priceId) {
      return { name: config.name, shopLimit: config.shopLimit };
    }
  }
  return null;
}

// Protected billing routes
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      reply.code(401).send({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }
  });

  // GET /api/billing/status - Get current subscription status
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      // Get tenant with subscription info
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      });

      if (!tenant) {
        return reply.code(404).send({
          success: false,
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      // Count active channels for this tenant
      const activeChannels = await db.query.channels.findMany({
        where: eq(channels.tenantId, tenantId),
      });

      const currentShopCount = activeChannels.filter((ch) => ch.isActive).length;

      // Check if can add another shop
      const canAddShop = currentShopCount < tenant.planShopLimit;

      return reply.code(200).send({
        success: true,
        data: {
          plan: tenant.plan,
          planStatus: tenant.planStatus,
          shopLimit: tenant.planShopLimit,
          currentShopCount,
          trialEndsAt: tenant.trialEndsAt,
          canAddShop,
        },
      });
    } catch (error) {
      console.error('Get billing status error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to fetch billing status',
      });
    }
  });

  // POST /api/billing/create-checkout - Create Stripe Checkout session
  app.post<{ Body: { plan: 'starter' | 'growth' } }>(
    '/create-checkout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { plan } = request.body as { plan: 'starter' | 'growth' };
        const tenantId = getTenantId(request);

        // Validate plan
        if (!['starter', 'growth'].includes(plan)) {
          return reply.code(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Invalid plan. Must be "starter" or "growth"',
          });
        }

        // Get tenant and primary user email
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, tenantId),
        });

        if (!tenant) {
          return reply.code(404).send({
            success: false,
            error: 'Not Found',
            message: 'Tenant not found',
          });
        }

        // Get primary user email (owner)
        const owner = await db.query.users.findFirst({
          where: eq(users.tenantId, tenantId),
        });

        if (!owner) {
          return reply.code(404).send({
            success: false,
            error: 'Not Found',
            message: 'No owner found for tenant',
          });
        }

        // Create or retrieve Stripe customer
        let stripeCustomerId = tenant.stripeCustomerId;

        if (!stripeCustomerId) {
          const customer = await stripe.customers.create({
            email: owner.email,
            metadata: {
              tenantId,
              tenantName: tenant.name,
            },
          });
          stripeCustomerId = customer.id;

          // Store customer ID in database
          await db
            .update(tenants)
            .set({ stripeCustomerId } as Partial<typeof tenants.$inferSelect>)
            .where(eq(tenants.id, tenantId));
        }

        // Get plan configuration
        const planConfig = PLAN_CONFIG[plan];

        // Create Checkout session
        const session = await stripe.checkout.sessions.create({
          customer: stripeCustomerId,
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [
            {
              price: planConfig.priceId,
              quantity: 1,
            },
          ],
          success_url: `${config.FRONTEND_URL}/settings?billing=success`,
          cancel_url: `${config.FRONTEND_URL}/settings?billing=canceled`,
          currency: 'gbp',
          metadata: {
            tenantId,
            plan,
          },
        });

        if (!session.url) {
          return reply.code(500).send({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to create checkout session',
          });
        }

        return reply.code(200).send({
          success: true,
          data: {
            url: session.url,
          },
        });
      } catch (error) {
        console.error('Create checkout error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to create checkout session',
        });
      }
    }
  );

  // POST /api/billing/portal - Create Stripe Customer Portal session
  app.post('/portal', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);

      // Get tenant
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      });

      if (!tenant) {
        return reply.code(404).send({
          success: false,
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      if (!tenant.stripeCustomerId) {
        return reply.code(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Customer has not subscribed yet',
        });
      }

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeCustomerId,
        return_url: `${config.FRONTEND_URL}/settings`,
      });

      return reply.code(200).send({
        success: true,
        data: {
          url: session.url,
        },
      });
    } catch (error) {
      console.error('Create portal session error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to create portal session',
      });
    }
  });
}

// Unprotected webhook routes with raw body parsing
export async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Add raw body content type parser for webhook signature verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (req, body) => {
      return body;
    }
  );

  // POST /webhooks/stripe - Handle Stripe webhook events
  app.post<{ Body: Buffer }>('/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sig = request.headers['stripe-signature'] as string;

      if (!sig) {
        return reply.code(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Missing stripe-signature header',
        });
      }

      // Verify webhook signature
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          sig,
          config.STRIPE_WEBHOOK_SECRET
        );
      } catch (err: unknown) {
        console.error('Webhook signature verification failed:', err);
        return reply.code(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Invalid webhook signature',
        });
      }

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;

          const tenantId = session.metadata?.tenantId;
          const plan = session.metadata?.plan;

          if (!tenantId || !plan) {
            console.warn('Missing metadata in checkout session:', { tenantId, plan });
            break;
          }

          // Validate plan
          if (!['starter', 'growth'].includes(plan)) {
            console.warn('Invalid plan in metadata:', plan);
            break;
          }

          // Get subscription details
          if (!session.subscription) {
            console.warn('No subscription ID in checkout session');
            break;
          }

          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );

          // Get plan configuration
          const planConfig = subscription.items.data[0];
          if (!planConfig?.price?.id) {
            console.warn('Missing price ID in subscription');
            break;
          }

          const planInfo = getPlanFromPriceId(planConfig.price.id);
          if (!planInfo) {
            console.warn('Unknown price ID:', planConfig.price.id);
            break;
          }

          // Update tenant subscription
          await db
            .update(tenants)
            .set({
              plan: planInfo.name,
              planStatus: 'active',
              planShopLimit: planInfo.shopLimit,
              stripeSubscriptionId: session.subscription as string,
            } as Partial<typeof tenants.$inferSelect>)
            .where(eq(tenants.id, tenantId));

          console.info(`Subscription activated for tenant ${tenantId}: ${planInfo.name}`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          const tenantId = subscription.metadata?.tenantId;

          if (!tenantId) {
            console.warn('Missing tenantId in subscription metadata');
            break;
          }

          const planConfig = subscription.items.data[0];
          if (!planConfig?.price?.id) {
            console.warn('Missing price ID in subscription');
            break;
          }

          const planInfo = getPlanFromPriceId(planConfig.price.id);
          if (!planInfo) {
            console.warn('Unknown price ID:', planConfig.price.id);
            break;
          }

          // Map Stripe status to our status
          let planStatus: string;
          switch (subscription.status) {
            case 'active':
              planStatus = 'active';
              break;
            case 'past_due':
              planStatus = 'past_due';
              break;
            case 'canceled':
              planStatus = 'canceled';
              break;
            case 'trialing':
              planStatus = 'trialing';
              break;
            default:
              planStatus = subscription.status;
          }

          // Update tenant subscription
          await db
            .update(tenants)
            .set({
              plan: planInfo.name,
              planStatus,
              planShopLimit: planInfo.shopLimit,
            } as Partial<typeof tenants.$inferSelect>)
            .where(eq(tenants.id, tenantId));

          console.info(
            `Subscription updated for tenant ${tenantId}: ${planInfo.name} - ${planStatus}`
          );
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const tenantId = subscription.metadata?.tenantId;

          if (!tenantId) {
            console.warn('Missing tenantId in subscription metadata');
            break;
          }

          // Revert to trial plan
          await db
            .update(tenants)
            .set({
              plan: 'trial',
              planStatus: 'canceled',
              planShopLimit: 3,
            } as Partial<typeof tenants.$inferSelect>)
            .where(eq(tenants.id, tenantId));

          console.info(`Subscription canceled for tenant ${tenantId}. Reverted to trial plan.`);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const tenantId = invoice.metadata?.tenantId;

          if (!tenantId) {
            console.warn('Missing tenantId in invoice metadata');
            break;
          }

          // Update plan status to past due
          await db
            .update(tenants)
            .set({ planStatus: 'past_due' } as Partial<typeof tenants.$inferSelect>)
            .where(eq(tenants.id, tenantId));

          console.warn(`Payment failed for tenant ${tenantId}. Status set to past_due.`);
          break;
        }

        default:
          console.debug(`Unhandled event type: ${event.type}`);
      }

      // Always return 200 to acknowledge receipt
      return reply.code(200).send({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Still return 200 to prevent Stripe from retrying
      return reply.code(200).send({ received: true });
    }
  });
}
