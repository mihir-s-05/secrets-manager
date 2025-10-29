import type { FastifyPluginAsync } from 'fastify';
import { sendError } from '../utils/errors';
import { loadUserWithOrgAndTeams } from './user-utils';

const meRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/me',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const loaded = await loadUserWithOrgAndTeams(fastify.prisma, request.user.id);
      if (!loaded) {
        return sendError(reply, 404, 'not_found', 'User not found');
      }

      return reply.status(200).send(loaded.response);
    }
  );
};

export default meRoutes;

