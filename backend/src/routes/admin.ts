import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendError, sendZodError } from '../utils/errors.js';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/users',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const schema = z.object({
        email: z.string().email(),
        displayName: z.string().min(1),
        isAdmin: z.boolean().optional().default(false)
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return sendZodError(reply, parsed.error);
      }

      try {
        const created = await fastify.prisma.user.create({
          data: {
            orgId: request.user.orgId,
            email: parsed.data.email,
            displayName: parsed.data.displayName,
            isAdmin: parsed.data.isAdmin ?? false,
            oauthProvider: 'github',
            oauthSub: `admin-created-${Date.now()}`
          },
          select: { id: true }
        });

        return reply.status(201).send(created);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('unique') || message.includes('constraint')) {
          return sendError(reply, 409, 'conflict', 'User with this email already exists');
        }
        request.log.error({ err: error }, 'Failed to create user');
        return sendError(reply, 500, 'server_error', 'Failed to create user');
      }
    }
  );

  fastify.patch(
    '/admin/users/:id',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramSchema = z.object({
        id: z.string().min(1)
      });
      const bodySchema = z
        .object({
          isAdmin: z.boolean().optional(),
          reassignOrgId: z.string().min(1).optional()
        })
        .refine(
          (data) => data.isAdmin !== undefined || data.reassignOrgId !== undefined,
          { message: 'At least one value must be provided' }
        );

      const paramsResult = paramSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendZodError(reply, paramsResult.error);
      }

      const bodyResult = bodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return sendZodError(reply, bodyResult.error);
      }

      const { id } = paramsResult.data;
      const { isAdmin, reassignOrgId } = bodyResult.data;

      const userRecord = await fastify.prisma.user.findFirst({
        where: { id, orgId: request.user.orgId }
      });

      if (!userRecord) {
        return sendError(reply, 404, 'not_found', 'User not found in your organization');
      }

      if (reassignOrgId && reassignOrgId !== request.user.orgId) {
        return sendError(
          reply,
          403,
          'forbidden',
          'Cannot reassign users outside of your organization'
        );
      }

      if (reassignOrgId) {
        const orgExists = await fastify.prisma.organization.findUnique({
          where: { id: reassignOrgId }
        });
        if (!orgExists) {
          return sendError(reply, 400, 'bad_request', 'Organization does not exist');
        }
      }

      const updated = await fastify.prisma.user.update({
        where: { id },
        data: {
          ...(isAdmin !== undefined ? { isAdmin } : {}),
          ...(reassignOrgId ? { orgId: reassignOrgId } : {})
        },
        select: { id: true }
      });

      return reply.status(200).send(updated);
    }
  );

  fastify.delete(
    '/admin/users/:id',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramSchema = z.object({
        id: z.string().min(1)
      });
      const paramsResult = paramSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendZodError(reply, paramsResult.error);
      }

      const { id } = paramsResult.data;

      const userRecord = await fastify.prisma.user.findFirst({
        where: { id, orgId: request.user.orgId }
      });
      if (!userRecord) {
        return sendError(reply, 404, 'not_found', 'User not found in your organization');
      }

      // Remove related memberships before deleting user to satisfy FK constraints
      await fastify.prisma.teamMember.deleteMany({
        where: { userId: id }
      });
      await fastify.prisma.user.delete({ where: { id } });
      return reply.status(204).send();
    }
  );

  fastify.post(
    '/admin/teams',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const schema = z.object({
        name: z.string().min(1)
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return sendZodError(reply, parsed.error);
      }

      try {
        const created = await fastify.prisma.team.create({
          data: {
            orgId: request.user.orgId,
            name: parsed.data.name
          },
          select: { id: true }
        });
        return reply.status(201).send(created);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('unique') || message.includes('constraint')) {
          return sendError(reply, 409, 'conflict', 'Team with this name already exists');
        }
        request.log.error({ err: error }, 'Failed to create team');
        return sendError(reply, 500, 'server_error', 'Failed to create team');
      }
    }
  );

  fastify.post(
    '/admin/teams/:id/members',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramSchema = z.object({
        id: z.string().min(1)
      });
      const bodySchema = z.object({
        userId: z.string().min(1)
      });

      const paramsResult = paramSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendZodError(reply, paramsResult.error);
      }

      const bodyResult = bodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return sendZodError(reply, bodyResult.error);
      }

      const { id: teamId } = paramsResult.data;
      const { userId } = bodyResult.data;

      const team = await fastify.prisma.team.findFirst({
        where: { id: teamId, orgId: request.user.orgId }
      });
      if (!team) {
        return sendError(reply, 404, 'not_found', 'Team not found in your organization');
      }

      const user = await fastify.prisma.user.findFirst({
        where: { id: userId, orgId: request.user.orgId }
      });
      if (!user) {
        return sendError(reply, 404, 'not_found', 'User not found in your organization');
      }

      try {
        await fastify.prisma.teamMember.create({
          data: {
            teamId,
            userId
          }
        });

        return reply.status(204).send();
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('unique') || message.includes('constraint')) {
          return sendError(reply, 409, 'conflict', 'User already in team');
        }
        request.log.error({ err: error }, 'Failed to add team member');
        return sendError(reply, 500, 'server_error', 'Failed to add team member');
      }
    }
  );

  fastify.delete(
    '/admin/teams/:id/members/:userId',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramSchema = z.object({
        id: z.string().min(1),
        userId: z.string().min(1)
      });

      const paramsResult = paramSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendZodError(reply, paramsResult.error);
      }

      const { id: teamId, userId } = paramsResult.data;

      const team = await fastify.prisma.team.findFirst({
        where: { id: teamId, orgId: request.user.orgId }
      });
      if (!team) {
        return sendError(reply, 404, 'not_found', 'Team not found in your organization');
      }

      await fastify.prisma.teamMember.deleteMany({
        where: {
          teamId,
          userId
        }
      });

      return reply.status(204).send();
    }
  );

  fastify.delete(
    '/admin/teams/:id',
    { preHandler: fastify.requireAdmin() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramSchema = z.object({
        id: z.string().min(1)
      });

      const paramsResult = paramSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendZodError(reply, paramsResult.error);
      }

      const { id } = paramsResult.data;

      const team = await fastify.prisma.team.findFirst({
        where: { id, orgId: request.user.orgId }
      });
      if (!team) {
        return sendError(reply, 404, 'not_found', 'Team not found in your organization');
      }

      await fastify.prisma.teamMember.deleteMany({
        where: { teamId: id }
      });
      await fastify.prisma.team.delete({
        where: { id }
      });

      return reply.status(204).send();
    }
  );
};

export default adminRoutes;
