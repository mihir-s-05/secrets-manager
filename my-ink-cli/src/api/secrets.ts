import {z} from 'zod';
import {ApiClient} from './client.js';
import {
  permissionSchema,
  secretDetailSchema,
  secretHistoryItemSchema,
  secretSummarySchema,
  type SecretDetail,
  type SecretHistoryItem,
  type SecretSummary,
  type SecretWritePayload
} from '../types/dto.js';
import {sessionStore} from '../state/session.js';
import {fetchTeams, fetchUsers} from './directory.js';

const secretListSchema = z.array(secretSummarySchema);
const secretHistorySchema = z.array(secretHistoryItemSchema);

const secretCreateResponseSchema = z.union([
  secretDetailSchema,
  z.object({id: z.string()})
]);

const secretUpdateResponseSchema = z.union([
  secretDetailSchema,
  z.object({
    id: z.string(),
    version: z.number().int()
  })
]);

export const fetchSecrets = async (client: ApiClient): Promise<SecretSummary[]> => {
  const response = await client.request('/secrets', {
    method: 'GET',
    schema: secretListSchema
  });
  return response.data;
};

export const fetchSecretDetail = async (client: ApiClient, id: string): Promise<SecretDetail> => {
  // Backend returns ACLs as { principal, principalId, canRead, canWrite }
  // Map to CLI shape { principalType, principalId, principalName, permissions }
  const backendAclSchema = z.object({
    principal: z.enum(['org', 'team', 'user']),
    principalId: z.string().nullable().optional(),
    canRead: z.boolean(),
    canWrite: z.boolean()
  });

  const backendSecretDetailSchema = z.object({
    id: z.string(),
    key: z.string(),
    value: z.string(),
    version: z.number().int(),
    updatedAt: z.string(),
    myPermissions: permissionSchema,
    acls: z.array(backendAclSchema)
  });

  const response = await client.request(`/secrets/${id}`, {
    method: 'GET'
  });

  const backend = backendSecretDetailSchema.parse(response.data);

  const snapshot = sessionStore.getSnapshot();
  const orgId = snapshot.user?.org.id;
  const orgName = snapshot.user?.org.name;

  // Fetch directory to resolve principal names
  let usersById = new Map<string, {displayName?: string; email?: string}>();
  let teamsById = new Map<string, {name: string}>();
  try {
    const [users, teams] = await Promise.all([fetchUsers(client), fetchTeams(client)]);
    usersById = new Map(users.map((u) => [u.id, {displayName: u.displayName, email: u.email}]));
    teamsById = new Map(teams.map((t) => [t.id, {name: t.name}]));
  } catch {
    // If directory fetch fails, fall back gracefully; names will be IDs
  }

  const mapped: SecretDetail = {
    id: backend.id,
    key: backend.key,
    value: backend.value,
    version: backend.version,
    updatedAt: backend.updatedAt,
    myPermissions: backend.myPermissions,
    acls: backend.acls.map((acl) => {
      if (acl.principal === 'org') {
        return {
          principalType: 'org' as const,
          principalId: orgId ?? 'org',
          principalName: orgName ?? 'Organization',
          permissions: {read: acl.canRead, write: acl.canWrite}
        };
      }
      if (acl.principal === 'user') {
        const info = acl.principalId ? usersById.get(acl.principalId) : undefined;
        const name = info?.displayName ?? info?.email ?? acl.principalId ?? '';
        return {
          principalType: 'user' as const,
          principalId: acl.principalId ?? '',
          principalName: name,
          permissions: {read: acl.canRead, write: acl.canWrite}
        };
      }
      // team
      const info = acl.principalId ? teamsById.get(acl.principalId) : undefined;
      const name = info?.name ?? acl.principalId ?? '';
      return {
        principalType: 'team' as const,
        principalId: acl.principalId ?? '',
        principalName: name,
        permissions: {read: acl.canRead, write: acl.canWrite}
      };
    })
  };

  // Validate the mapped object conforms to CLI expectations
  return secretDetailSchema.parse(mapped);
};

export const fetchSecretHistory = async (client: ApiClient, id: string): Promise<SecretHistoryItem[]> => {
  const response = await client.request(`/secrets/${id}/history`, {
    method: 'GET',
    schema: secretHistorySchema,
    allowedStatuses: [404]
  });
  if (response.status === 404) {
    return [];
  }
  return response.data;
};

export const createSecret = async (
  client: ApiClient,
  payload: SecretWritePayload
): Promise<SecretDetail> => {
  const mapAclsToBackend = (
    acls: SecretWritePayload['acls'] | undefined
  ): Array<{
    principal: 'org' | 'team' | 'user';
    principalId?: string;
    canRead: boolean;
    canWrite: boolean;
  }> | undefined =>
    acls?.map((entry) =>
      entry.principalType === 'org'
        ? {
            principal: 'org',
            canRead: entry.permissions.read,
            canWrite: entry.permissions.write
          }
        : {
            principal: entry.principalType,
            principalId: entry.principalId,
            canRead: entry.permissions.read,
            canWrite: entry.permissions.write
          }
    );

  const response = await client.request('/secrets', {
    method: 'POST',
    body: {
      key: payload.key,
      value: payload.value,
      acls: mapAclsToBackend(payload.acls) ?? []
    }
  });

  const parsed = secretCreateResponseSchema.parse(response.data);

  if ('key' in parsed) {
    return parsed;
  }

  return fetchSecretDetail(client, parsed.id);
};

export const updateSecret = async (
  client: ApiClient,
  id: string,
  payload: Partial<SecretWritePayload> & {replaceAcls?: boolean}
): Promise<SecretDetail> => {
  const mapAclsToBackend = (
    acls: SecretWritePayload['acls'] | undefined
  ): Array<{
    principal: 'org' | 'team' | 'user';
    principalId?: string;
    canRead: boolean;
    canWrite: boolean;
  }> | undefined =>
    acls?.map((entry) =>
      entry.principalType === 'org'
        ? {
            principal: 'org',
            canRead: entry.permissions.read,
            canWrite: entry.permissions.write
          }
        : {
            principal: entry.principalType,
            principalId: entry.principalId,
            canRead: entry.permissions.read,
            canWrite: entry.permissions.write
          }
    );

  const body: Record<string, unknown> = {};
  if (payload.value !== undefined) {
    body.value = payload.value;
  }
  if (payload.acls !== undefined) {
    body.acls = mapAclsToBackend(payload.acls);
  }
  if (payload.replaceAcls !== undefined) {
    body.replaceAcls = payload.replaceAcls;
  }

  const response = await client.request(`/secrets/${id}`, {
    method: 'PATCH',
    body
  });

  const parsed = secretUpdateResponseSchema.parse(response.data);

  if ('key' in parsed) {
    return parsed;
  }

  return fetchSecretDetail(client, parsed.id);
};
