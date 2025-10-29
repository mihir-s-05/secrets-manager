import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { seed } from '../prisma/seed';

const projectRoot = path.join(__dirname, '..');
const prismaDir = path.join(projectRoot, 'prisma');
const testDbPath = path.join(prismaDir, 'auth-flow.test.db');
const testDbJournalPath = `${testDbPath}-journal`;
const databaseUrl = `file:${testDbPath}`;

let server: FastifyInstance | undefined;
let address: string;
let prisma: PrismaClient | undefined;
let originalFetch: typeof fetch;

type QueuedFetch = {
  url: string | RegExp;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

let fetchQueue: QueuedFetch[] = [];

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  const maybeRequest = input as { url?: unknown };
  if (maybeRequest && typeof maybeRequest.url === 'string') {
    return maybeRequest.url;
  }
  return String(input);
}

function normalizeMethod(request: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  const maybeRequest = request as { method?: unknown };
  if (maybeRequest && typeof maybeRequest.method === 'string') {
    return maybeRequest.method.toUpperCase();
  }
  return 'GET';
}

function enqueueFetch(reply: QueuedFetch) {
  fetchQueue.push(reply);
}

function setupFetchMock() {
  fetchQueue = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = fetchQueue.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call to ${normalizeUrl(input)}`);
    }

    const actualUrl = normalizeUrl(input);
    const actualMethod = normalizeMethod(input, init);
    const expectedMethod = (next.method ?? 'GET').toUpperCase();

    const urlMatches =
      typeof next.url === 'string' ? actualUrl === next.url : next.url.test(actualUrl);

    if (!urlMatches || actualMethod !== expectedMethod) {
      throw new Error(
        `Unexpected fetch request. Expected ${expectedMethod} ${next.url.toString()}, received ${actualMethod} ${actualUrl}`
      );
    }

    const body =
      next.body === undefined
        ? ''
        : typeof next.body === 'string'
        ? next.body
        : JSON.stringify(next.body);

    const ResponseCtor = globalThis.Response;
    if (typeof ResponseCtor !== 'function') {
      throw new Error('Global Response constructor is not available');
    }

    return new ResponseCtor(body, {
      status: next.status ?? 200,
      headers: next.headers
    });
  }) as unknown as typeof fetch;
}

function getPrismaCliExecutable(): string {
  const binary = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return path.join(projectRoot, 'node_modules', '.bin', binary);
}

function setupDeviceAuthorizationMocks(options?: {
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  accessToken?: string;
  githubId?: string;
  login?: string;
  name?: string;
  email?: string;
  includeFullFlow?: boolean;
}) {
  const deviceCode = options?.deviceCode ?? 'device-code';
  const userCode = options?.userCode ?? 'ABCD-EFGH';
  const verificationUri = options?.verificationUri ?? 'https://github.com/login/device';
  const accessToken = options?.accessToken ?? 'github-access-token';
  const githubId = options?.githubId ?? '12345';
  const login = options?.login ?? 'octocat';
  const name = options?.name ?? 'Octo Cat';
  const email = options?.email ?? `${login}@example.com`;

  enqueueFetch({
    url: 'https://github.com/login/device/code',
    method: 'POST',
    body: {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      expires_in: 900,
      interval: 5
    }
  });

  if (options?.includeFullFlow === false) {
    return {
      deviceCode,
      userCode,
      verificationUri,
      accessToken,
      githubId,
      login,
      name,
      email
    };
  }

  enqueueFetch({
    url: 'https://github.com/login/oauth/access_token',
    method: 'POST',
    body: {
      error: 'authorization_pending'
    }
  });

  enqueueFetch({
    url: 'https://github.com/login/oauth/access_token',
    method: 'POST',
    body: {
      access_token: accessToken,
      token_type: 'bearer',
      scope: 'read:user user:email'
    }
  });

  enqueueFetch({
    url: 'https://api.github.com/user',
    method: 'GET',
    body: {
      id: githubId,
      login,
      name
    }
  });

  enqueueFetch({
    url: 'https://api.github.com/user/emails',
    method: 'GET',
    body: [
      {
        email,
        primary: true,
        verified: true
      }
    ]
  });

  return {
    deviceCode,
    userCode,
    verificationUri,
    accessToken,
    githubId,
    login,
    name,
    email
  };
}

async function completeDeviceFlow(deviceId = 'device-1', options?: { email?: string; login?: string; name?: string; githubId?: string }) {
  const mock = setupDeviceAuthorizationMocks(options);

  const startResponse = await request(address).post('/auth/start');
  expect(startResponse.status).toBe(200);
  expect(startResponse.body).toMatchObject({
    deviceCode: mock.deviceCode,
    verificationUri: mock.verificationUri,
    userCode: mock.userCode
  });

  const pending = await request(address)
    .post('/auth/poll')
    .send({ deviceCode: mock.deviceCode, deviceId });
  expect(pending.status).toBe(428);
  expect(pending.body).toMatchObject({ error: { code: 'authorization_pending' } });

  const success = await request(address)
    .post('/auth/poll')
    .send({ deviceCode: mock.deviceCode, deviceId });
  expect(success.status).toBe(200);
  expect(success.body).toMatchObject({
    accessToken: expect.any(String),
    refreshToken: expect.any(String),
    user: expect.objectContaining({
      email: options?.email ?? mock.email,
      displayName: expect.any(String),
      org: expect.objectContaining({ name: 'Acme' })
    })
  });
  expect(typeof success.body.refreshToken).toBe('string');
  expect(success.body.refreshToken.length).toBeGreaterThan(30);

  return success.body as {
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      email: string;
      displayName: string;
      isAdmin: boolean;
      org: { id: string; name: string };
      teams: Array<{ id: string; name: string }>;
    };
  };
}

beforeAll(() => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'test-secret';
  process.env.ACCESS_TOKEN_TTL_MIN = '15';
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';
  process.env.GITHUB_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
  originalFetch = globalThis.fetch;
});

beforeEach(async () => {
  vi.resetModules();
  setupFetchMock();

  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }

  execFileSync(getPrismaCliExecutable(), ['db', 'push', '--force-reset', '--skip-generate'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit'
  });

  prisma = new PrismaClient();
  await seed(prisma);

  const { __testing } = await import('../src/routes/auth');
  __testing.resetAuthState();

  const { createServer } = await import('../src/index');
  server = createServer();
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }

  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }

  expect(fetchQueue.length, 'All fetch mocks should be consumed').toBe(0);
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;

  try {
    rmSync(testDbPath);
  } catch {
    // ignore
  }

  try {
    rmSync(testDbJournalPath);
  } catch {
    // ignore
  }
});

describe('auth endpoints', () => {
  test('POST /auth/start returns device payload', async () => {
    const mock = setupDeviceAuthorizationMocks({ includeFullFlow: false });

    const response = await request(address).post('/auth/start');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      deviceCode: mock.deviceCode,
      verificationUri: mock.verificationUri,
      userCode: mock.userCode,
      pollIntervalSec: 5,
      expiresIn: 900
    });
  });

  test('POST /auth/poll pending then success returning tokens and user', async () => {
    const result = await completeDeviceFlow('device-xyz');

    expect(result.user.email).toBe('octocat@example.com');
    expect(result.accessToken).toMatch(/^ey/);
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBeGreaterThan(30);
  });

  test('POST /auth/poll enforces rate limiting', async () => {
    const mock = setupDeviceAuthorizationMocks({ includeFullFlow: false });

    const startResponse = await request(address).post('/auth/start');
    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toMatchObject({
      deviceCode: mock.deviceCode,
      verificationUri: mock.verificationUri,
      userCode: mock.userCode
    });

    for (let i = 0; i < 5; i += 1) {
      enqueueFetch({
        url: 'https://github.com/login/oauth/access_token',
        method: 'POST',
        body: { error: 'authorization_pending' }
      });
    }

    const deviceId = 'device-rate-limit';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pending = await request(address)
        .post('/auth/poll')
        .send({ deviceCode: mock.deviceCode, deviceId });

      expect(pending.status).toBe(428);
      expect(Number(pending.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(pending.body).toMatchObject({ error: { code: 'authorization_pending' } });
    }

    const limited = await request(address)
      .post('/auth/poll')
      .send({ deviceCode: mock.deviceCode, deviceId });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.body).toMatchObject({
      error: {
        code: 'rate_limited',
        message: 'Too many polling requests'
      }
    });
  });

  test('POST /auth/refresh rejects invalid tokens and issues new access token', async () => {
    const mock = await completeDeviceFlow('device-refresh');

    const missingResponse = await request(address)
      .post('/auth/refresh')
      .send({ refreshToken: 'does-not-exist', deviceId: 'device-refresh' });
    expect(missingResponse.status).toBe(401);
    expect(missingResponse.body).toMatchObject({ error: { code: 'unauthorized' } });

    const refreshResponse = await request(address)
      .post('/auth/refresh')
      .send({ refreshToken: mock.refreshToken, deviceId: 'device-refresh' });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body).toMatchObject({ accessToken: expect.any(String) });
  });

  test('POST /auth/logout revokes refresh token', async () => {
    const flow = await completeDeviceFlow('device-logout');

    const logoutResponse = await request(address)
      .post('/auth/logout')
      .send({ refreshToken: flow.refreshToken });
    expect(logoutResponse.status).toBe(204);

    const refreshResponse = await request(address)
      .post('/auth/refresh')
      .send({ refreshToken: flow.refreshToken, deviceId: 'device-logout' });
    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body).toMatchObject({ error: { code: 'unauthorized' } });
  });
});

describe('authenticated routes', () => {
  test('GET /me returns user profile with org and teams', async () => {
    const flow = await completeDeviceFlow('device-me', {
      githubId: '555',
      login: 'me-user',
      email: 'me-user@example.com',
      name: 'Me User'
    });

    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    const team = await prisma.team.create({
      data: {
        orgId: flow.user.org.id,
        name: 'Platform'
      }
    });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: flow.user.id
      }
    });

    const response = await request(address)
      .get('/me')
      .set('Authorization', `Bearer ${flow.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: flow.user.id,
      email: 'me-user@example.com',
      displayName: 'Me User',
      org: {
        id: flow.user.org.id,
        name: 'Acme'
      },
      teams: [{ id: team.id, name: 'Platform' }]
    });
  });

  test('directory endpoints scope data to the requester org', async () => {
    const flow = await completeDeviceFlow('device-directory');

    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org' }
    });

    await prisma.team.create({
      data: {
        orgId: otherOrg.id,
        name: 'Other Team'
      }
    });

    await prisma.user.create({
      data: {
        orgId: otherOrg.id,
        email: 'outsider@example.com',
        displayName: 'Outsider',
        oauthProvider: 'github',
        oauthSub: 'outsider'
      }
    });

    const usersResponse = await request(address)
      .get('/org/users')
      .set('Authorization', `Bearer ${flow.accessToken}`);
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: flow.user.id,
          email: flow.user.email
        }),
        expect.objectContaining({
          email: 'admin@example.com'
        })
      ])
    );
    expect(usersResponse.body).toHaveLength(2);
    expect(usersResponse.body).not.toContainEqual(
      expect.objectContaining({ email: 'outsider@example.com' })
    );

    const teamsResponse = await request(address)
      .get('/org/teams')
      .set('Authorization', `Bearer ${flow.accessToken}`);
    expect(teamsResponse.status).toBe(200);
    expect(Array.isArray(teamsResponse.body)).toBe(true);
    expect(teamsResponse.body).toEqual([]);
    expect(teamsResponse.body).not.toContainEqual(expect.objectContaining({ name: 'Other Team' }));
  });
});

describe('admin routes', () => {
  test('non-admin receives 403 on admin endpoints', async () => {
    const flow = await completeDeviceFlow('device-non-admin');

    const response = await request(address)
      .post('/admin/teams')
      .set('Authorization', `Bearer ${flow.accessToken}`)
      .send({ name: 'Ops' });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Admin privileges required'
      }
    });
  });

  test('admin can manage users and teams within org', async () => {
    const flow = await completeDeviceFlow('device-admin', {
      githubId: 'admin-1',
      email: 'admin@example.com',
      login: 'admin-user',
      name: 'Admin User'
    });

    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    await prisma.user.update({
      where: { id: flow.user.id },
      data: { isAdmin: true }
    });

    const teamResponse = await request(address)
      .post('/admin/teams')
      .set('Authorization', `Bearer ${flow.accessToken}`)
      .send({ name: 'Infrastructure' });
    expect(teamResponse.status).toBe(201);
    const teamId = teamResponse.body.id as string;
    expect(typeof teamId).toBe('string');

    const newUserResponse = await request(address)
      .post('/admin/users')
      .set('Authorization', `Bearer ${flow.accessToken}`)
      .send({ email: 'new.member@example.com', displayName: 'New Member' });
    expect(newUserResponse.status).toBe(201);
    const newUserId = newUserResponse.body.id as string;

    const addMember = await request(address)
      .post(`/admin/teams/${teamId}/members`)
      .set('Authorization', `Bearer ${flow.accessToken}`)
      .send({ userId: newUserId });
    expect(addMember.status).toBe(204);

    const removeMember = await request(address)
      .delete(`/admin/teams/${teamId}/members/${newUserId}`)
      .set('Authorization', `Bearer ${flow.accessToken}`);
    expect(removeMember.status).toBe(204);

    const deleteTeam = await request(address)
      .delete(`/admin/teams/${teamId}`)
      .set('Authorization', `Bearer ${flow.accessToken}`);
    expect(deleteTeam.status).toBe(204);
  });
});
