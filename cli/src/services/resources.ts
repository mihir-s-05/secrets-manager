import type { AxiosInstance } from 'axios';
import { z } from 'zod';

import { normalizeApiError } from './api.js';
import {
  AdminActionResult,
  SecretSummary,
  SecretVersion,
  orgTeamSchema,
  orgUserSchema,
  secretSummarySchema,
  secretVersionSchema,
} from './schemas.js';

export interface SecretAclPayload {
  org: {
    read: boolean;
    write: boolean;
  };
  teams: Array<{
    id: string;
    read: boolean;
    write: boolean;
  }>;
  users: Array<{
    id: string;
    read: boolean;
    write: boolean;
  }>;
}

export interface SecretInput {
  key: string;
  value: string;
  acl: SecretAclPayload;
}

export interface SecretUpdateInput {
  id: string;
  value?: string;
  acl?: SecretAclPayload;
}

const backendPermissionSchema = z
  .object({
    read: z.boolean().optional(),
    write: z.boolean().optional(),
    admin: z.boolean().optional(),
  })
  .partial();

const backendSecretSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  updatedAt: z.string().optional(),
  myPermissions: backendPermissionSchema.optional(),
});

const backendSecretSchema = backendSecretSummarySchema.extend({
  value: z.string().optional(),
  acls: z
    .array(
      z.object({
        principal: z.enum(['org', 'user', 'team']),
        principalId: z.string().nullable().optional(),
        canRead: z.boolean(),
        canWrite: z.boolean(),
      }),
    )
    .default([]),
});

const backendOrgUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  isAdmin: z.boolean().optional(),
});

const backendOrgTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const parseListResponse = <T>(
  data: unknown,
  itemSchema: z.ZodType<T>,
  key: string,
): T[] => {
  const listSchema = z.union([z.array(itemSchema), z.object({ [key]: z.array(itemSchema).default([]) })]);
  const parsed = listSchema.safeParse(data);
  if (!parsed.success) {
    throw normalizeApiError(parsed.error);
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return parsed.data[key] ?? [];
};

const normalizePermissions = (raw?: z.infer<typeof backendPermissionSchema>) => ({
  read: Boolean(raw?.read),
  write: Boolean(raw?.write),
  admin: Boolean(raw?.admin),
});

const buildBackendAcls = (acl?: SecretAclPayload) => {
  if (!acl) {
    return [];
  }
  const payload: Array<{ principal: 'org' | 'user' | 'team'; principalId?: string | null; canRead: boolean; canWrite: boolean }> = [];

  if (acl.org.read || acl.org.write) {
    payload.push({
      principal: 'org',
      principalId: null,
      canRead: acl.org.read,
      canWrite: acl.org.write,
    });
  }

  for (const team of acl.teams) {
    if (!team.id) {
      continue;
    }
    if (!team.read && !team.write) {
      continue;
    }
    payload.push({
      principal: 'team',
      principalId: team.id,
      canRead: team.read,
      canWrite: team.write,
    });
  }

  for (const user of acl.users) {
    if (!user.id) {
      continue;
    }
    if (!user.read && !user.write) {
      continue;
    }
    payload.push({
      principal: 'user',
      principalId: user.id,
      canRead: user.read,
      canWrite: user.write,
    });
  }

  return payload;
};

const transformSecret = (input: z.infer<typeof backendSecretSchema>): SecretVersion => {
  const orgAcl = input.acls.find((acl) => acl.principal === 'org');
  const teamAcls = input.acls
    .filter((acl) => acl.principal === 'team' && acl.principalId)
    .map((acl) => ({
      id: String(acl.principalId),
      read: acl.canRead,
      write: acl.canWrite,
    }));
  const userAcls = input.acls
    .filter((acl) => acl.principal === 'user' && acl.principalId)
    .map((acl) => ({
      id: String(acl.principalId),
      read: acl.canRead,
      write: acl.canWrite,
    }));

  return secretVersionSchema.parse({
    id: input.id,
    key: input.key,
    value: input.value,
    version: input.version,
    updatedAt: input.updatedAt,
    permissions: normalizePermissions(input.myPermissions),
    acl: {
      org: {
        read: orgAcl?.canRead ?? false,
        write: orgAcl?.canWrite ?? false,
      },
      teams: teamAcls,
      users: userAcls,
    },
  });
};

export const fetchSecrets = async (client: AxiosInstance): Promise<SecretSummary[]> => {
  try {
    const response = await client.get('/secrets');
    const rawList = parseListResponse(response.data, backendSecretSummarySchema, 'secrets');
    return rawList.map((item) =>
      secretSummarySchema.parse({
        id: item.id,
        key: item.key,
        version: item.version,
        updatedAt: item.updatedAt,
        permissions: normalizePermissions(item.myPermissions),
      }),
    );
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const fetchSecretVersion = async (client: AxiosInstance, keyOrId: string): Promise<SecretVersion> => {
  try {
    const response = await client.get(`/secrets/${encodeURIComponent(keyOrId)}`);
    const parsed = backendSecretSchema.safeParse(response.data?.secret ?? response.data);
    if (!parsed.success) {
      throw parsed.error;
    }
    return transformSecret(parsed.data);
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const createSecret = async (client: AxiosInstance, payload: SecretInput): Promise<SecretVersion> => {
  try {
    const response = await client.post('/secrets', {
      key: payload.key,
      value: payload.value,
      acls: buildBackendAcls(payload.acl),
    });
    const secretId = (response.data as { id?: string } | undefined)?.id ?? payload.key;
    return await fetchSecretVersion(client, secretId);
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const updateSecret = async (client: AxiosInstance, payload: SecretUpdateInput): Promise<SecretVersion> => {
  try {
    const body: Record<string, unknown> = {};
    if (payload.value !== undefined) {
      body.value = payload.value;
    }
    if (payload.acl) {
      body.acls = buildBackendAcls(payload.acl);
      body.replaceAcls = true;
    }

    const response = await client.patch(`/secrets/${encodeURIComponent(payload.id)}`, body);
    const secretId = (response.data as { id?: string } | undefined)?.id ?? payload.id;
    return await fetchSecretVersion(client, secretId);
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const fetchUsers = async (client: AxiosInstance) => {
  try {
    const response = await client.get('/org/users');
    const rawUsers = parseListResponse(response.data, backendOrgUserSchema, 'users');
    return rawUsers.map((user) =>
      orgUserSchema.parse({
        id: user.id,
        email: user.email,
        name: user.displayName,
        isAdmin: user.isAdmin ?? false,
      }),
    );
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const fetchTeams = async (client: AxiosInstance) => {
  try {
    const response = await client.get('/org/teams');
    const rawTeams = parseListResponse(response.data, backendOrgTeamSchema, 'teams');
    return rawTeams.map((team) =>
      orgTeamSchema.parse({
        id: team.id,
        name: team.name,
        memberCount: 0,
      }),
    );
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const adminCreateTeam = async (client: AxiosInstance, name: string): Promise<AdminActionResult> => {
  try {
    const response = await client.post('/admin/teams', { name });
    const teamId = (response.data as { id?: string } | undefined)?.id;
    return {
      status: 'created',
      message: teamId ? `Team ${name} created (id ${teamId})` : `Team ${name} created`,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const adminTeamAddUser = async (
  client: AxiosInstance,
  teamId: string,
  userId: string,
  role: 'read' | 'write' | 'rw' = 'rw',
): Promise<AdminActionResult> => {
  try {
    const response = await client.post(`/admin/teams/${encodeURIComponent(teamId)}/members`, {
      userId,
    });
    const payload = response.data as { teamId?: string; userId?: string } | undefined;
    return {
      status: 'ok',
      message: `Added user ${payload?.userId ?? userId} to team ${payload?.teamId ?? teamId} (${role})`,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const adminTeamRemoveUser = async (
  client: AxiosInstance,
  teamId: string,
  userId: string,
): Promise<AdminActionResult> => {
  try {
    await client.delete(`/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
    return {
      status: 'ok',
      message: `Removed user ${userId} from team ${teamId}`,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const adminCreateUser = async (
  client: AxiosInstance,
  payload: { email: string; name?: string; admin?: boolean },
): Promise<AdminActionResult> => {
  try {
    const providedName = payload.name?.trim() ?? '';
    const derivedName = payload.email.includes('@') ? payload.email.split('@')[0] ?? payload.email : payload.email;
    const displayName = (providedName.length > 0 ? providedName : derivedName).trim() || payload.email;
    const response = await client.post('/admin/users', {
      email: payload.email,
      displayName,
      isAdmin: Boolean(payload.admin),
    });
    const userId = (response.data as { id?: string } | undefined)?.id;
    return {
      status: 'created',
      message: userId
        ? `User ${payload.email} created (id ${userId})`
        : `User ${payload.email} created`,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const adminPromoteUser = async (client: AxiosInstance, userId: string): Promise<AdminActionResult> => {
  try {
    const response = await client.patch(`/admin/users/${encodeURIComponent(userId)}`, {
      isAdmin: true,
    });
    const result = response.data as { id?: string } | undefined;
    return {
      status: 'ok',
      message: `User ${result?.id ?? userId} promoted to admin`,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};
