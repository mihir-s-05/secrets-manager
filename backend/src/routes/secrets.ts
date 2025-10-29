import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { resolvePermissions } from '../lib/perms.js';
import { sendError, sendMappedError, sendZodError } from '../utils/errors.js';

type NormalizedAcl = {
  principal: 'org' | 'user' | 'team';
  principalId: string | null;
  canRead: boolean;
  canWrite: boolean;
};

const aclSchema = z.discriminatedUnion('principal', [
  z.object({
    principal: z.literal('org'),
    principalId: z.string().trim().min(1).optional(),
    canRead: z.boolean(),
    canWrite: z.boolean()
  }),
  z.object({
    principal: z.literal('user'),
    principalId: z.string().trim().min(1),
    canRead: z.boolean(),
    canWrite: z.boolean()
  }),
  z.object({
    principal: z.literal('team'),
    principalId: z.string().trim().min(1),
    canRead: z.boolean(),
    canWrite: z.boolean()
  })
]);

type AclInput = z.infer<typeof aclSchema>;

function dedupeAcls(acls: NormalizedAcl[]): NormalizedAcl[] {
  const merged = new Map<string, NormalizedAcl>();

  for (const acl of acls) {
    const key = `${acl.principal}:${acl.principalId ?? 'org'}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        canRead: existing.canRead || acl.canRead,
        canWrite: existing.canWrite || acl.canWrite
      });
    } else {
      merged.set(key, { ...acl });
    }
  }

  return Array.from(merged.values());
}

async function loadSecretWithAcls(
  fastify: Parameters<FastifyPluginAsync>[0],
  identifier: string,
  orgId: string
) {
  const baseInclude = {
    acls: {
      select: {
        principal: true,
        principalId: true,
        canRead: true,
        canWrite: true
      }
    }
  } as const;

  const byId = await fastify.prisma.secret.findUnique({
    where: { id: identifier },
    include: baseInclude
  });
  if (byId && byId.orgId === orgId) {
    return byId;
  }

  return fastify.prisma.secret.findFirst({
    where: {
      orgId,
      key: identifier
    },
    include: baseInclude
  });
}

function mapAclRecords(
  records: Array<{
    principal: string;
    principalId: string | null;
    canRead: boolean;
    canWrite: boolean;
  }>
): NormalizedAcl[] {
  return records.map((acl) => ({
    principal: acl.principal as NormalizedAcl['principal'],
    principalId: acl.principalId ?? null,
    canRead: acl.canRead,
    canWrite: acl.canWrite
  }));
}

async function normalizeAndValidateAcls(
  fastify: Parameters<FastifyPluginAsync>[0],
  orgId: string,
  acls: AclInput[] | undefined
): Promise<
  | { ok: true; value: NormalizedAcl[] }
  | { ok: false; message: string }
> {
  if (!acls || acls.length === 0) {
    return { ok: true, value: [] };
  }

  const normalized: NormalizedAcl[] = [];
  const userIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const acl of acls) {
    if (acl.principal === 'org') {
      if (acl.principalId && acl.principalId !== orgId) {
        return { ok: false, message: 'Org ACL principalId must match the organization id' };
      }
      normalized.push({
        principal: 'org',
        principalId: null,
        canRead: acl.canRead,
        canWrite: acl.canWrite
      });
      continue;
    }

    const principalId = acl.principalId?.trim();
    if (!principalId) {
      return {
        ok: false,
        message: `${acl.principal} ACL entries require principalId`
      };
    }

    normalized.push({
      principal: acl.principal,
      principalId,
      canRead: acl.canRead,
      canWrite: acl.canWrite
    });

    if (acl.principal === 'user') {
      userIds.add(principalId);
    } else if (acl.principal === 'team') {
      teamIds.add(principalId);
    }
  }

  if (userIds.size > 0) {
    const users = await fastify.prisma.user.findMany({
      where: {
        id: { in: Array.from(userIds) },
        orgId
      },
      select: { id: true }
    });

    if (users.length !== userIds.size) {
      return { ok: false, message: 'All user ACL principals must belong to the organization' };
    }
  }

  if (teamIds.size > 0) {
    const teams = await fastify.prisma.team.findMany({
      where: {
        id: { in: Array.from(teamIds) },
        orgId
      },
      select: { id: true }
    });

    if (teams.length !== teamIds.size) {
      return { ok: false, message: 'All team ACL principals must belong to the organization' };
    }
  }

  return { ok: true, value: dedupeAcls(normalized) };
}

const secretsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/secrets',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const querySchema = z.object({
        asUserId: z.string().min(1).optional()
      });

      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return sendZodError(reply, parsedQuery.error);
      }

      // Determine effective user context for permission evaluation (admin view-as)
      let effectiveUser = request.user;
      if (parsedQuery.data.asUserId) {
        if (!request.user.isAdmin) {
          return sendError(reply, 403, 'forbidden', 'Admin privileges required for view-as');
        }

        const target = await fastify.prisma.user.findUnique({
          where: { id: parsedQuery.data.asUserId },
          select: {
            id: true,
            orgId: true,
            isAdmin: true,
            memberships: { select: { teamId: true } }
          }
        });

        if (!target || target.orgId !== request.user.orgId) {
          return sendError(reply, 404, 'not_found', 'User not found');
        }

        effectiveUser = {
          id: target.id,
          orgId: target.orgId,
          isAdmin: target.isAdmin,
          teamIds: new Set(target.memberships.map((m: { teamId: string }) => m.teamId))
        };
      }

      const secrets = await fastify.prisma.secret.findMany({
        where: { orgId: effectiveUser.orgId },
        select: {
          id: true,
          key: true,
          version: true,
          updatedAt: true
        },
        orderBy: {
          key: 'asc'
        }
      });

      if (secrets.length === 0) {
        return reply.send([]);
      }

      const secretIds = secrets.map((secret) => secret.id);

      const acls = await fastify.prisma.secretAcl.findMany({
        where: { secretId: { in: secretIds } },
        select: {
          secretId: true,
          principal: true,
          principalId: true,
          canRead: true,
          canWrite: true
        }
      });

      const aclMap = new Map<string, NormalizedAcl[]>();
      for (const acl of acls) {
        const list = aclMap.get(acl.secretId);
        const normalized: NormalizedAcl = {
          principal: acl.principal as NormalizedAcl['principal'],
          principalId: acl.principalId ?? null,
          canRead: acl.canRead,
          canWrite: acl.canWrite
        };
        if (list) {
          list.push(normalized);
        } else {
          aclMap.set(acl.secretId, [normalized]);
        }
      }

      const results = [];
      // Admins always retain implicit access regardless of view-as
      const adminImplicit = env.ADMIN_IMPLICIT_ACCESS;

      for (const secret of secrets) {
        const secretAcls = aclMap.get(secret.id) ?? [];
        const permissions = resolvePermissions(
          effectiveUser,
          { orgId: effectiveUser.orgId },
          secretAcls,
          adminImplicit
        );

        if (!permissions.read) {
          continue;
        }

        results.push({
          id: secret.id,
          key: secret.key,
          version: secret.version,
          updatedAt: secret.updatedAt,
          myPermissions: permissions
        });
      }

      return reply.send(results);
    }
  );

  fastify.get(
    '/secrets/:id',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramsSchema = z.object({
        id: z.string().min(1)
      });

      const querySchema = z.object({
        asUserId: z.string().min(1).optional()
      });

      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return sendZodError(reply, parsedParams.error);
      }

      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return sendZodError(reply, parsedQuery.error);
      }

      // Determine effective user context for permission evaluation (admin view-as)
      let effectiveUser = request.user;
      if (parsedQuery.data.asUserId) {
        if (!request.user.isAdmin) {
          return sendError(reply, 403, 'forbidden', 'Admin privileges required for view-as');
        }

        const target = await fastify.prisma.user.findUnique({
          where: { id: parsedQuery.data.asUserId },
          select: {
            id: true,
            orgId: true,
            isAdmin: true,
            memberships: { select: { teamId: true } }
          }
        });

        if (!target || target.orgId !== request.user.orgId) {
          return sendError(reply, 404, 'not_found', 'User not found');
        }

        effectiveUser = {
          id: target.id,
          orgId: target.orgId,
          isAdmin: target.isAdmin,
          teamIds: new Set(target.memberships.map((m: { teamId: string }) => m.teamId))
        };
      }

      const secret = await loadSecretWithAcls(fastify, parsedParams.data.id, effectiveUser.orgId);

      if (!secret) {
        return sendError(reply, 404, 'not_found', 'Secret not found');
      }

      const currentAcls = mapAclRecords(secret.acls);
      // Admins always retain implicit access regardless of view-as
      const adminImplicit = env.ADMIN_IMPLICIT_ACCESS;
      const permissions = resolvePermissions(
        effectiveUser,
        { orgId: secret.orgId },
        currentAcls,
        adminImplicit
      );

      if (!permissions.read) {
        return sendError(reply, 403, 'forbidden', 'Read access denied');
      }

      return reply.send({
        id: secret.id,
        key: secret.key,
        value: secret.value,
        version: secret.version,
        updatedAt: secret.updatedAt,
        myPermissions: permissions,
        acls: secret.acls.map((acl) => ({
          principal: acl.principal,
          principalId: acl.principalId ?? null,
          canRead: acl.canRead,
          canWrite: acl.canWrite
        }))
      });
    }
  );

  fastify.post(
    '/secrets',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const schema = z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        acls: z.array(aclSchema).default([])
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return sendZodError(reply, parsed.error);
      }

      const normalizedResult = await normalizeAndValidateAcls(
        fastify,
        request.user.orgId,
        parsed.data.acls
      );
      if (!normalizedResult.ok) {
        return sendError(reply, 400, 'bad_request', normalizedResult.message);
      }

      // Ensure the creator can always see and manage the secret they just created.
      // If the provided ACLs do not grant the creator read+write, add an implicit user ACL.
      let finalAcls = normalizedResult.value;
      const creatorPerms = resolvePermissions(
        request.user,
        { orgId: request.user.orgId },
        finalAcls,
        env.ADMIN_IMPLICIT_ACCESS
      );
      if (!(creatorPerms.read && creatorPerms.write)) {
        finalAcls = dedupeAcls([
          ...finalAcls,
          {
            principal: 'user',
            principalId: request.user.id,
            canRead: true,
            canWrite: true
          }
        ]);
      }

      try {
        const secretId = await fastify.prisma.$transaction(async (tx) => {
          const created = await tx.secret.create({
            data: {
              orgId: request.user!.orgId,
              key: parsed.data.key,
              value: parsed.data.value,
              createdBy: request.user!.id,
              updatedBy: request.user!.id
            },
            select: { id: true }
          });

          if (finalAcls.length > 0) {
            await tx.secretAcl.createMany({
              data: finalAcls.map((acl) => ({
                secretId: created.id,
                principal: acl.principal,
                principalId: acl.principalId,
                canRead: acl.canRead,
                canWrite: acl.canWrite
              }))
            });
          }

          return created.id;
        });

        return reply.status(201).send({ id: secretId });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create secret');
        return sendMappedError(reply, error, {
          conflictMessage: 'Secret key already exists',
          defaultMessage: 'Failed to create secret'
        });
      }
    }
  );

  fastify.patch(
    '/secrets/:id',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramsSchema = z.object({
        id: z.string().min(1)
      });

      const querySchema = z.object({
        asUserId: z.string().min(1).optional()
      });

      const bodySchema = z
        .object({
          value: z.string().min(1).optional(),
          acls: z.array(aclSchema).optional(),
          replaceAcls: z.boolean().optional()
        })
        .refine((data) => data.value !== undefined || data.acls !== undefined, {
          message: 'Provide a new value or ACL changes'
        })
        .refine(
          (data) => {
            if (data.replaceAcls && data.acls === undefined) {
              return false;
            }
            return true;
          },
          {
            message: 'replaceAcls requires specifying acls'
          }
        );

      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return sendZodError(reply, parsedParams.error);
      }

      const parsedBody = bodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return sendZodError(reply, parsedBody.error);
      }

      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return sendZodError(reply, parsedQuery.error);
      }

      // Determine effective user context for permission evaluation (admin view-as)
      let effectiveUser = request.user;
      if (parsedQuery.data.asUserId) {
        if (!request.user.isAdmin) {
          return sendError(reply, 403, 'forbidden', 'Admin privileges required for view-as');
        }

        const target = await fastify.prisma.user.findUnique({
          where: { id: parsedQuery.data.asUserId },
          select: {
            id: true,
            orgId: true,
            isAdmin: true,
            memberships: { select: { teamId: true } }
          }
        });

        if (!target || target.orgId !== request.user.orgId) {
          return sendError(reply, 404, 'not_found', 'User not found');
        }

        effectiveUser = {
          id: target.id,
          orgId: target.orgId,
          isAdmin: target.isAdmin,
          teamIds: new Set(target.memberships.map((m: { teamId: string }) => m.teamId))
        };
      }

      const secret = await loadSecretWithAcls(fastify, parsedParams.data.id, effectiveUser.orgId);

      if (!secret) {
        return sendError(reply, 404, 'not_found', 'Secret not found');
      }

      const currentAcls = mapAclRecords(secret.acls);
      // Admins always retain implicit access regardless of view-as
      const adminImplicit = env.ADMIN_IMPLICIT_ACCESS;
      const permissions = resolvePermissions(
        effectiveUser,
        { orgId: secret.orgId },
        currentAcls,
        adminImplicit
      );

      const hasWriteAccess =
        permissions.write || (secret.createdBy === effectiveUser.id && effectiveUser.orgId === secret.orgId);

      if (!hasWriteAccess) {
        return sendError(reply, 403, 'forbidden', 'Write access denied');
      }

      let normalizedAcls: NormalizedAcl[] = [];
      if (parsedBody.data.acls) {
        const normalizedResult = await normalizeAndValidateAcls(
          fastify,
          request.user.orgId,
          parsedBody.data.acls
        );
        if (!normalizedResult.ok) {
          return sendError(reply, 400, 'bad_request', normalizedResult.message);
        }
        normalizedAcls = normalizedResult.value;
      }

      try {
        const updatedVersion = await fastify.prisma.$transaction(async (tx) => {
          let nextVersion = secret.version;

          if (parsedBody.data.value !== undefined) {
            await tx.secretHistory.create({
              data: {
                secretId: secret.id,
                version: secret.version,
                value: secret.value,
                updatedBy: request.user!.id
              }
            });
            nextVersion = secret.version + 1;
          }

          if (parsedBody.data.acls) {
            if (parsedBody.data.replaceAcls) {
              await tx.secretAcl.deleteMany({
                where: { secretId: secret.id }
              });
            }

            for (const acl of normalizedAcls) {
              await tx.secretAcl.upsert({
                  where: {
                    secretId_principal_principalId: {
                      secretId: secret.id,
                      principal: acl.principal,
                      principalId: acl.principalId as string
                    }
                  },
                update: {
                  canRead: acl.canRead,
                  canWrite: acl.canWrite
                },
                create: {
                  secretId: secret.id,
                  principal: acl.principal,
                  principalId: acl.principalId,
                  canRead: acl.canRead,
                  canWrite: acl.canWrite
                }
              });
            }
          }

          if (parsedBody.data.value !== undefined || parsedBody.data.acls) {
            const updateData: {
              value?: string;
              version?: number;
              updatedBy: string;
            } = {
              updatedBy: request.user!.id
            };

            if (parsedBody.data.value !== undefined) {
              updateData.value = parsedBody.data.value;
              updateData.version = nextVersion;
            }

            await tx.secret.update({
              where: { id: secret.id },
              data: updateData
            });
          }

          return parsedBody.data.value !== undefined ? nextVersion : secret.version;
        });

        return reply.status(200).send({ id: secret.id, version: updatedVersion });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to update secret');
        return sendMappedError(reply, error, {
          defaultMessage: 'Failed to update secret'
        });
      }
    }
  );

  fastify.get(
    '/secrets/:id/history',
    { preHandler: fastify.requireAuth() },
    async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, 'unauthorized', 'Authorization required');
      }

      const paramsSchema = z.object({
        id: z.string().min(1)
      });

      const querySchema = z.object({
        asUserId: z.string().min(1).optional()
      });

      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return sendZodError(reply, parsedParams.error);
      }

      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return sendZodError(reply, parsedQuery.error);
      }

      // Determine effective user context for permission evaluation (admin view-as)
      let effectiveUser = request.user;
      if (parsedQuery.data.asUserId) {
        if (!request.user.isAdmin) {
          return sendError(reply, 403, 'forbidden', 'Admin privileges required for view-as');
        }

        const target = await fastify.prisma.user.findUnique({
          where: { id: parsedQuery.data.asUserId },
          select: {
            id: true,
            orgId: true,
            isAdmin: true,
            memberships: { select: { teamId: true } }
          }
        });

        if (!target || target.orgId !== request.user.orgId) {
          return sendError(reply, 404, 'not_found', 'User not found');
        }

        effectiveUser = {
          id: target.id,
          orgId: target.orgId,
          isAdmin: target.isAdmin,
          teamIds: new Set(target.memberships.map((m: { teamId: string }) => m.teamId))
        };
      }

      const secret = await loadSecretWithAcls(fastify, parsedParams.data.id, effectiveUser.orgId);

      if (!secret) {
        return sendError(reply, 404, 'not_found', 'Secret not found');
      }

      const normalizedAcls = mapAclRecords(secret.acls);
      const adminImplicit = parsedQuery.data.asUserId ? false : env.ADMIN_IMPLICIT_ACCESS;
      const permissions = resolvePermissions(
        effectiveUser,
        { orgId: secret.orgId },
        normalizedAcls,
        adminImplicit
      );

      if (!permissions.read) {
        return sendError(reply, 403, 'forbidden', 'Read access denied');
      }

      const history = await fastify.prisma.secretHistory.findMany({
        where: { secretId: secret.id },
        orderBy: { version: 'asc' },
        select: {
          version: true,
          value: true,
          updatedBy: true,
          updatedAt: true
        }
      });
      return reply.send(history);
    }
  );
};

export default secretsRoutes;
