import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '../prisma';
import { sendError } from '../utils/errors';
import { verifyAccessJwt } from '../auth/tokens';

async function loadUser(prisma: Prisma, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      orgId: true,
      isAdmin: true,
      memberships: {
        select: { teamId: true }
      }
    }
  });
}

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  prisma: Prisma
) {
  const header = request.headers.authorization;

  if (!header) {
    return sendError(reply, 401, 'unauthorized', 'Missing Authorization header');
  }

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return sendError(reply, 401, 'unauthorized', 'Authorization header must be Bearer token');
  }

  try {
    const payload = verifyAccessJwt(token);

    const user = await loadUser(prisma, payload.sub);

    if (!user) {
      return sendError(reply, 401, 'unauthorized', 'User no longer exists');
    }

    request.user = {
      id: user.id,
      orgId: user.orgId,
      isAdmin: user.isAdmin,
      teamIds: new Set(user.memberships.map((membership) => membership.teamId))
    };

    return undefined;
  } catch (error) {
    request.log.warn({ err: error }, 'Failed to verify JWT');
    return sendError(reply, 401, 'unauthorized', 'Invalid or expired token');
  }
}

export function registerAuthDecorators(fastify: FastifyInstance) {
  if (fastify.hasDecorator('requireAuth')) {
    return;
  }

  fastify.decorate('requireAuth', function requireAuth() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await authenticateRequest(request, reply, fastify.prisma);
      if (result) {
        return result;
      }
    };
  });

  fastify.decorate('requireAdmin', function requireAdmin() {
    const ensureAuth = fastify.requireAuth();
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await ensureAuth(request, reply);
      if (reply.sent) {
        return;
      }

      if (!request.user?.isAdmin) {
        return sendError(reply, 403, 'forbidden', 'Admin privileges required');
      }
    };
  });
}
