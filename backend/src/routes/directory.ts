import type { FastifyPluginAsync } from 'fastify';
import { sendError } from '../utils/errors.js';

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
          email: true,
          isAdmin: true
        },
        orderBy: { displayName: 'asc' }
      });

      return reply.status(200).send(
        users.map((user) => ({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          isAdmin: user.isAdmin
        }))
      );
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
          name: true,
          _count: {
            select: {
              members: true
            }
          }
        },
        orderBy: { name: 'asc' }
      });

      return reply.status(200).send(
        teams.map((team) => ({
          id: team.id,
          name: team.name,
          memberCount: team._count.members
        }))
      );
    }
  );
};

export default directoryRoutes;
