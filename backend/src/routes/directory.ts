import type { FastifyPluginAsync } from 'fastify';
import { sendError } from '../utils/errors';

const directoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/org/users',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const users = await fastify.prisma.user.findMany({
        where: { orgId: request.user.orgId },
        select: {
          id: true,
          displayName: true,
          email: true
        },
        orderBy: { displayName: 'asc' }
      });

      return reply.status(200).send(users);
    }
  );

  fastify.get(
    '/org/teams',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const teams = await fastify.prisma.team.findMany({
        where: { orgId: request.user.orgId },
        select: {
          id: true,
          name: true
        },
        orderBy: { name: 'asc' }
      });

      return reply.status(200).send(teams);
    }
  );
};

export default directoryRoutes;
