import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ success: false, error: 'Unauthorized' });
  }

  // Check database for super admin status
  const user = await db.query.users.findFirst({
    where: eq(users.id, request.user.userId),
  });

  if (!user || !user.isSuperAdmin) {
    return reply.code(403).send({ success: false, error: 'Forbidden', message: 'Super admin access required' });
  }
}
