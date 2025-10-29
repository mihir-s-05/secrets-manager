import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export type RequestUser = {
  id: string;
  orgId: string;
  isAdmin: boolean;
  teamIds: Set<string>;
};

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    requireAuth: () => (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
    requireAdmin: () => (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
  }

  interface FastifyRequest {
    user?: RequestUser;
  }
}
