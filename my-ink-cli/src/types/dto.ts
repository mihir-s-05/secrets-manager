import {z} from 'zod';

export const permissionSchema = z.object({
  read: z.boolean(),
  write: z.boolean()
});

export const orgSchema = z
  .object({
    id: z.string(),
    name: z.string().optional()
  })
  .passthrough();

export const teamSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    members: z
      .array(
        z.object({
          id: z.string(),
          displayName: z.string().optional(),
          email: z.string().optional()
        })
      )
      .optional()
  })
  .passthrough();

export const userSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    isAdmin: z.boolean(),
    org: orgSchema,
    teams: z.array(teamSchema).default([])
  })
  .passthrough();

export const secretSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
  myPermissions: permissionSchema
});

export const aclEntrySchema = z.object({
  principalType: z.enum(['org', 'team', 'user']),
  principalId: z.string(),
  principalName: z.string(),
  permissions: permissionSchema
});

export const secretDetailSchema = secretSummarySchema.extend({
  value: z.string(),
  description: z.string().optional(),
  acls: z.array(aclEntrySchema)
});

export const secretHistoryItemSchema = z.object({
  version: z.number().int(),
  updatedAt: z.string(),
  updatedBy: z.string()
});

export const deviceStartResponseSchema = z.object({
  deviceCode: z.string(),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url().optional(),
  userCode: z.string(),
  pollIntervalSec: z.number().int().positive(),
  expiresIn: z.number().int().positive()
});

export const pollResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userSchema
});

export const refreshResponseSchema = z.object({
  accessToken: z.string()
});

export const directoryUsersResponseSchema = z.object({
  users: z.array(userSchema)
});

export const directoryTeamsResponseSchema = z.object({
  teams: z.array(teamSchema)
});

export type Permissions = z.infer<typeof permissionSchema>;
export type Org = z.infer<typeof orgSchema>;
export type Team = z.infer<typeof teamSchema>;
export type User = z.infer<typeof userSchema>;
export type SecretSummary = z.infer<typeof secretSummarySchema>;
export type AclEntry = z.infer<typeof aclEntrySchema>;
export type SecretDetail = z.infer<typeof secretDetailSchema>;
export type SecretHistoryItem = z.infer<typeof secretHistoryItemSchema>;
export type DeviceStartResponse = z.infer<typeof deviceStartResponseSchema>;
export type PollResponse = z.infer<typeof pollResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type DirectoryUsersResponse = z.infer<typeof directoryUsersResponseSchema>;
export type DirectoryTeamsResponse = z.infer<typeof directoryTeamsResponseSchema>;

export const secretWritePayloadSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string().min(1, 'Value is required'),
  acls: z.array(
    z.object({
      principalType: z.enum(['org', 'team', 'user']),
      principalId: z.string(),
      permissions: permissionSchema
    })
  )
});

export type SecretWritePayload = z.infer<typeof secretWritePayloadSchema>;
