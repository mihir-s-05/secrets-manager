import { z } from 'zod';

export const permissionSchema = z.object({
  read: z.boolean().optional().default(false),
  write: z.boolean().optional().default(false),
  admin: z.boolean().optional().default(false),
});

export const secretSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  updatedAt: z.string().optional(),
  permissions: permissionSchema.default({}),
});

export const secretVersionSchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  value: z.string().optional(),
  updatedAt: z.string().optional(),
  permissions: permissionSchema.default({}),
  acl: z.object({
    org: z.object({
      read: z.boolean().optional().default(false),
      write: z.boolean().optional().default(false),
    }),
    teams: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        read: z.boolean().optional().default(false),
        write: z.boolean().optional().default(false),
      }),
    ).default([]),
    users: z.array(
      z.object({
        id: z.string(),
        email: z.string().optional(),
        name: z.string().optional().nullable(),
        read: z.boolean().optional().default(false),
        write: z.boolean().optional().default(false),
      }),
    ).default([]),
  }).optional(),
});

export const orgUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  isAdmin: z.boolean().optional(),
});

export const orgTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().optional().default(0),
  description: z.string().optional().nullable(),
});

export const adminActionSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
});

export type Permission = z.infer<typeof permissionSchema>;
export type SecretSummary = z.infer<typeof secretSummarySchema>;
export type SecretVersion = z.infer<typeof secretVersionSchema>;
export type OrgUser = z.infer<typeof orgUserSchema>;
export type OrgTeam = z.infer<typeof orgTeamSchema>;
export type AdminActionResult = z.infer<typeof adminActionSchema>;

export const secretsListResponseSchema = z.union([
  z.array(secretSummarySchema),
  z.object({ secrets: z.array(secretSummarySchema) }),
]);

export const usersListResponseSchema = z.union([
  z.array(orgUserSchema),
  z.object({ users: z.array(orgUserSchema) }),
]);

export const teamsListResponseSchema = z.union([
  z.array(orgTeamSchema),
  z.object({ teams: z.array(orgTeamSchema) }),
]);
