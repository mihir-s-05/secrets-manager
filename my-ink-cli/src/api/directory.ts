import {z} from 'zod';
import {ApiClient} from './client.js';
import {
  directoryTeamsResponseSchema,
  directoryUsersResponseSchema,
  teamSchema,
  userSchema,
  type Org,
  type Team,
  type User
} from '../types/dto.js';
import {sessionStore} from '../state/session.js';

const minimalUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().optional(),
  isAdmin: z.boolean().optional()
});

const minimalTeamMemberSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  email: z.string().optional()
});

const minimalTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(minimalTeamMemberSchema).optional(),
  memberCount: z.number().int().optional()
});

const usersResponseSchema = z.union([directoryUsersResponseSchema, z.array(minimalUserSchema)]);
const teamsResponseSchema = z.union([directoryTeamsResponseSchema, z.array(minimalTeamSchema)]);
const createTeamResponseSchema = z.union([
  teamSchema,
  z.object({
    id: z.string(),
    name: z.string().optional(),
    members: z.array(minimalTeamMemberSchema).optional(),
    memberCount: z.number().int().optional()
  })
]);
const createUserResponseSchema = z.union([userSchema, minimalUserSchema.extend({
  org: z
    .object({
      id: z.string(),
      name: z.string().optional()
    })
    .optional(),
  teams: z.array(minimalTeamSchema.pick({id: true, name: true})).optional()
})]);

type MinimalUser = z.infer<typeof minimalUserSchema>;
type DirectoryUser = z.infer<typeof directoryUsersResponseSchema>['users'][number];
type NormalizableUser = MinimalUser | DirectoryUser;

type MinimalTeam = z.infer<typeof minimalTeamSchema>;
type DirectoryTeam = z.infer<typeof directoryTeamsResponseSchema>['teams'][number];
type NormalizableTeam = MinimalTeam | DirectoryTeam;
type NormalizableTeamMember = z.infer<typeof minimalTeamMemberSchema> | NonNullable<DirectoryTeam['members']>[number];

const getFallbackOrg = (): Org => {
  const snapshot = sessionStore.getSnapshot();
  return snapshot.user?.org ?? {
    id: snapshot.user?.org?.id ?? 'org-unknown',
    name: snapshot.user?.org?.name
  };
};

const normalizeTeamMembers = (members?: NormalizableTeamMember[]) =>
  (members ?? []).map((member) => ({
    id: member.id,
    displayName: member.displayName ?? member.email ?? member.id,
    email: member.email
  }));

const normalizeTeam = (team: NormalizableTeam): Team => ({
  ...(team as Team),
  members: normalizeTeamMembers((team as {members?: NormalizableTeamMember[]}).members)
});

const normalizeUser = (user: NormalizableUser, fallbackOrg: Org): User => {
  const org = (user as DirectoryUser).org ?? fallbackOrg;
  const rawTeams: NormalizableTeam[] =
    'teams' in user && Array.isArray((user as {teams?: unknown}).teams)
      ? ((user as {teams?: NormalizableTeam[]}).teams ?? [])
      : [];
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    isAdmin: user.isAdmin ?? false,
    org,
    teams: rawTeams.map((team) => normalizeTeam(team as NormalizableTeam))
  };
};

export const fetchUsers = async (client: ApiClient): Promise<User[]> => {
  const response = await client.request('/org/users', {
    method: 'GET'
  });

  const parsed = usersResponseSchema.parse(response.data);
  const records = Array.isArray(parsed) ? parsed : parsed.users;
  const fallbackOrg = getFallbackOrg();

  return records.map((user) => normalizeUser(user, fallbackOrg));
};

export const fetchTeams = async (client: ApiClient): Promise<Team[]> => {
  const response = await client.request('/org/teams', {
    method: 'GET'
  });

  const parsed = teamsResponseSchema.parse(response.data);
  const records = Array.isArray(parsed) ? parsed : parsed.teams;

  return records.map((team) => normalizeTeam(team));
};

export interface CreateTeamPayload {
  name: string;
}

export const createTeam = async (client: ApiClient, payload: CreateTeamPayload): Promise<Team> => {
  const response = await client.request('/admin/teams', {
    method: 'POST',
    body: payload
  });
  const parsed = createTeamResponseSchema.parse(response.data);
  return normalizeTeam({
    ...parsed,
    name: parsed.name ?? payload.name
  });
};

export interface CreateUserPayload {
  email: string;
  displayName: string;
}

export const createUser = async (client: ApiClient, payload: CreateUserPayload): Promise<User> => {
  const response = await client.request('/admin/users', {
    method: 'POST',
    body: payload
  });
  const parsed = createUserResponseSchema.parse(response.data);
  const fallbackOrg = getFallbackOrg();
  return normalizeUser(parsed, fallbackOrg);
};

export const addTeamMember = async (
  client: ApiClient,
  teamId: string,
  userId: string
): Promise<void> => {
  await client.request(`/admin/teams/${teamId}/members`, {
    method: 'POST',
    body: {userId},
    allowedStatuses: [204]
  });
};

export const removeTeamMember = async (
  client: ApiClient,
  teamId: string,
  userId: string
): Promise<void> => {
  await client.request(`/admin/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
    allowedStatuses: [204]
  });
};

export const setAdmin = async (
  client: ApiClient,
  userId: string,
  isAdmin: boolean
): Promise<User> => {
  const response = await client.request(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: {isAdmin}
  });
  const parsed = createUserResponseSchema.parse(response.data);
  const fallbackOrg = getFallbackOrg();
  return normalizeUser(parsed, fallbackOrg);
};

export const deleteTeam = async (client: ApiClient, teamId: string): Promise<void> => {
  await client.request(`/admin/teams/${teamId}`, {
    method: 'DELETE',
    allowedStatuses: [204]
  });
};

export const deleteUser = async (client: ApiClient, userId: string): Promise<void> => {
  await client.request(`/admin/users/${userId}`, {
    method: 'DELETE',
    allowedStatuses: [204]
  });
};
