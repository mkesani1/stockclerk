import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { enquiries } from '../db/schema.js';
import { authenticateRequest } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/admin.js';

// Public route - anyone can submit an enquiry
export async function enquiryPublicRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      businessName: string;
      contactName: string;
      email: string;
      phone?: string;
      shopCount: string;
      message?: string;
    };
  }>('/enterprise', async (request, reply) => {
    try {
      const { businessName, contactName, email, phone, shopCount, message } = request.body;

      // Basic validation
      if (!businessName || !contactName || !email || !shopCount) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          message: 'businessName, contactName, email, and shopCount are required',
        });
      }

      const [enquiry] = await db
        .insert(enquiries)
        .values({
          businessName,
          contactName,
          email,
          phone: phone || null,
          shopCount,
          message: message || null,
        } as typeof enquiries.$inferInsert)
        .returning();

      return reply.code(201).send({
        success: true,
        data: { id: enquiry.id },
        message: 'Enquiry submitted successfully. We will be in touch within 24 hours.',
      });
    } catch (error) {
      console.error('Enquiry submission error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'Failed to submit enquiry',
      });
    }
  });
}

// Admin route - view and manage enquiries
export async function enquiryAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateRequest);

  // GET /admin/enquiries - List all enquiries
  app.get(
    '/',
    { preHandler: [requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const allEnquiries = await db.query.enquiries.findMany({
          orderBy: [desc(enquiries.createdAt)],
        });

        return reply.code(200).send({
          success: true,
          data: allEnquiries,
        });
      } catch (error) {
        console.error('Admin enquiries error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch enquiries',
        });
      }
    }
  );

  // PATCH /admin/enquiries/:id - Update enquiry status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/:id',
    { preHandler: [requireSuperAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { status } = request.body;

        if (!['new', 'contacted', 'qualified', 'closed'].includes(status)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid status',
          });
        }

        const [updated] = await db
          .update(enquiries)
          .set({ status } as Partial<typeof enquiries.$inferSelect>)
          .where(eq(enquiries.id, id))
          .returning();

        if (!updated) {
          return reply.code(404).send({ success: false, error: 'Not found' });
        }

        return reply.code(200).send({ success: true, data: updated });
      } catch (error) {
        console.error('Update enquiry error:', error);
        return reply.code(500).send({ success: false, error: 'Internal server error' });
      }
    }
  );
}
