import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { enquiries } from '../db/schema.js';
import { authenticateRequest } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/admin.js';

// Zod schemas for enquiry validation
const createEnquirySchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(255),
  contactName: z.string().min(1, 'Contact name is required').max(255),
  email: z.string().email('Invalid email address'),
  phone: z.string().max(50).optional(),
  shopCount: z.string().min(1, 'Shop count is required'),
  message: z.string().max(2000).optional(),
});

const updateEnquiryStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed'], {
    errorMap: () => ({ message: 'Status must be one of: new, contacted, qualified, closed' }),
  }),
});

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
  }>(
    '/enterprise',
    {
      schema: {
        body: {
          type: 'object',
          required: ['businessName', 'contactName', 'email', 'shopCount'],
          properties: {
            businessName: { type: 'string', minLength: 1, maxLength: 255 },
            contactName: { type: 'string', minLength: 1, maxLength: 255 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', maxLength: 50 },
            shopCount: { type: 'string', minLength: 1 },
            message: { type: 'string', maxLength: 2000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
    try {
      // Validate with Zod for detailed error messages
      const validation = createEnquirySchema.safeParse(request.body);
      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          message: validation.error.issues.map((i) => i.message).join(', '),
        });
      }

      const { businessName, contactName, email, phone, shopCount, message } = validation.data;

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

        // Validate with Zod
        const validation = updateEnquiryStatusSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          });
        }

        const { status } = validation.data;

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
