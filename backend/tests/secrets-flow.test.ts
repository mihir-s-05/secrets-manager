import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi
} from 'vitest';

import { seed } from '../prisma/seed';

const projectRoot = path.join(__dirname, '..');
const prismaDir = path.join(projectRoot, 'prisma');
const testDbPath = path.join(prismaDir, 'secrets-flow.test.db');
const testDbJournalPath = `${testDbPath}-journal`;
const databaseUrl = `file:${testDbPath}`;

let prisma: PrismaClient | undefined;
let server: FastifyInstance | undefined;
let address: string;
let signAccessJwt: typeof import('../src/auth/tokens').signAccessJwt;

function getPrismaCliExecutable(): string {
  const binary = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return path.join(projectRoot, 'node_modules', '.bin', binary);
}

function uniqueString(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function issueAccessToken(userId: string) {
  if (!prisma) {
    throw new Error('Prisma client not initialized');
  }
  if (!signAccessJwt) {
    throw new Error('signAccessJwt not loaded');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: true
    }
  });

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  return signAccessJwt({
    userId: user.id,
    orgId: user.orgId,
    isAdmin: user.isAdmin,
    teamIds: user.memberships.map((membership) => membership.teamId)
  });
}

async function createOrgFixture() {
  if (!prisma) {
    throw new Error('Prisma client not initialized');
  }

  const org = await prisma.organization.findFirst({ where: { name: 'Acme' } });
  if (!org) {
    throw new Error('Seed organization missing');
  }

  const admin = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });
  if (!admin) {
    throw new Error('Seed admin missing');
  }

  const team = await prisma.team.create({
    data: {
      orgId: org.id,
      name: 'core'
    }
  });

  const alice = await prisma.user.create({
    data: {
      orgId: org.id,
      email: `${uniqueString('alice')}@example.com`,
      displayName: 'Alice',
      oauthProvider: 'github',
      oauthSub: uniqueString('alice'),
      isAdmin: false
    }
  });

  const bob = await prisma.user.create({
    data: {
      orgId: org.id,
      email: `${uniqueString('bob')}@example.com`,
      displayName: 'Bob',
      oauthProvider: 'github',
      oauthSub: uniqueString('bob'),
      isAdmin: false
    }
  });

  await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: alice.id
    }
  });

  const otherOrg = await prisma.organization.create({
    data: {
      name: uniqueString('OtherCo')
    }
  });

  const outsider = await prisma.user.create({
    data: {
      orgId: otherOrg.id,
      email: `${uniqueString('outsider')}@example.com`,
      displayName: 'Outsider',
      oauthProvider: 'github',
      oauthSub: uniqueString('outsider'),
      isAdmin: false
    }
  });

  return { org, admin, team, alice, bob, outsider };
}

beforeAll(() => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'test-secret';
  process.env.ACCESS_TOKEN_TTL_MIN = '30';
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';
  process.env.ADMIN_IMPLICIT_ACCESS = 'false';
});

beforeEach(async () => {
  vi.resetModules();

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

  const tokensModule = await import('../src/auth/tokens');
  signAccessJwt = tokensModule.signAccessJwt;

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
});

afterAll(() => {
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

describe('Secrets ACL enforcement', () => {
  test('org-wide ACL grants read access to all org members', async () => {
    const { admin, alice, bob, outsider } = await createOrgFixture();

    const adminToken = await issueAccessToken(admin.id);

    const createResponse = await request(address)
      .post('/secrets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'org-secret',
        value: 'value-1',
        acls: [
          {
            principal: 'org',
            canRead: true,
            canWrite: false
          }
        ]
      });

    expect(createResponse.status).toBe(201);
    const secretId = createResponse.body.id;

    const aliceToken = await issueAccessToken(alice.id);
    const aliceList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(aliceList.status).toBe(200);
    expect(aliceList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secretId,
          myPermissions: { read: true, write: false }
        })
      ])
    );

    const bobToken = await issueAccessToken(bob.id);
    const bobList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${bobToken}`);

    expect(
      bobList.body.find(
        (secret: { id: string; myPermissions: { read: boolean } }) =>
          secret.id === secretId && secret.myPermissions.read === true
      )
    ).toBeTruthy();

    const outsiderToken = await issueAccessToken(outsider.id);
    const outsiderList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body).toEqual([]);

    const detailResponse = await request(address)
      .get(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toMatchObject({
      id: secretId,
      key: 'org-secret',
      value: 'value-1'
    });
  });

  test('team ACL restricts visibility to team members', async () => {
    const { admin, team, alice, bob } = await createOrgFixture();

    const adminToken = await issueAccessToken(admin.id);

    const createResponse = await request(address)
      .post('/secrets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'team-secret',
        value: 'team-value',
        acls: [
          {
            principal: 'team',
            principalId: team.id,
            canRead: true,
            canWrite: false
          }
        ]
      });

    expect(createResponse.status).toBe(201);
    const secretId = createResponse.body.id;

    const aliceToken = await issueAccessToken(alice.id);
    const aliceList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(aliceList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secretId,
          myPermissions: { read: true, write: false }
        })
      ])
    );

    const bobToken = await issueAccessToken(bob.id);
    const bobList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(bobList.body.find((secret: { id: string }) => secret.id === secretId)).toBeUndefined();

    const bobDetail = await request(address)
      .get(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(bobDetail.status).toBe(403);
    expect(bobDetail.body).toMatchObject({ error: { code: 'forbidden' } });
  });

  test('user ACL grants write regardless of team membership', async () => {
    const { admin, bob, alice } = await createOrgFixture();

    const adminToken = await issueAccessToken(admin.id);

    const createResponse = await request(address)
      .post('/secrets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'user-secret',
        value: 'initial',
        acls: [
          {
            principal: 'user',
            principalId: bob.id,
            canRead: true,
            canWrite: true
          }
        ]
      });

    expect(createResponse.status).toBe(201);
    const secretId = createResponse.body.id;

    const bobToken = await issueAccessToken(bob.id);
    const bobList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(bobList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secretId,
          myPermissions: { read: true, write: true }
        })
      ])
    );

    const aliceToken = await issueAccessToken(alice.id);
    const aliceList = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(aliceList.body.find((secret: { id: string }) => secret.id === secretId)).toBeUndefined();
  });

  test('write permission enforcement and history creation', async () => {
    const { admin, team, alice, bob } = await createOrgFixture();

    const adminToken = await issueAccessToken(admin.id);

    const createResponse = await request(address)
      .post('/secrets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'history-secret',
        value: 'v1',
        acls: [
          {
            principal: 'team',
            principalId: team.id,
            canRead: true,
            canWrite: false
          },
          {
            principal: 'user',
            principalId: bob.id,
            canRead: true,
            canWrite: true
          }
        ]
      });

    expect(createResponse.status).toBe(201);
    const secretId = createResponse.body.id;

    const aliceToken = await issueAccessToken(alice.id);
    const deniedPatch = await request(address)
      .patch(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        value: 'v2'
      });

    expect(deniedPatch.status).toBe(403);
    expect(deniedPatch.body).toMatchObject({ error: { code: 'forbidden' } });

    const bobToken = await issueAccessToken(bob.id);
    const updateResponse = await request(address)
      .patch(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({
        value: 'v2'
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({ id: secretId, version: 2 });

    const detailResponse = await request(address)
      .get(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(detailResponse.body).toMatchObject({ value: 'v2', version: 2 });

    const historyResponse = await request(address)
      .get(`/secrets/${secretId}/history`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body).toEqual([
      expect.objectContaining({
        version: 1,
        value: 'v1',
        updatedBy: bob.id
      })
    ]);
  });
});

describe('Secrets end-to-end scenario', () => {
  test('admin shares secret with team then upgrades user to writer', async () => {
    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    const org = await prisma.organization.findFirst({ where: { name: 'Acme' } });
    const admin = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });

    if (!org || !admin) {
      throw new Error('Seed data missing');
    }

    const adminToken = await issueAccessToken(admin.id);

    const teamResponse = await request(address)
      .post('/admin/teams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'infra' });
    expect(teamResponse.status).toBe(201);
    const teamId = teamResponse.body.id;

    const userEmail = `${uniqueString('member')}@example.com`;
    const userResponse = await request(address)
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: userEmail,
        displayName: 'Team Member',
        isAdmin: false
      });
    expect(userResponse.status).toBe(201);
    const memberId = userResponse.body.id;

    const membershipResponse = await request(address)
      .post(`/admin/teams/${teamId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: memberId });
    expect(membershipResponse.status).toBe(201);
    expect(membershipResponse.body).toMatchObject({ teamId, userId: memberId });

    const memberToken = await issueAccessToken(memberId);

    const createSecretResponse = await request(address)
      .post('/secrets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'team-shared',
        value: 'initial-secret',
        acls: [
          {
            principal: 'team',
            principalId: teamId,
            canRead: true,
            canWrite: false
          }
        ]
      });
    expect(createSecretResponse.status).toBe(201);
    const secretId = createSecretResponse.body.id;

    const memberListInitial = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberListInitial.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secretId,
          myPermissions: { read: true, write: false }
        })
      ])
    );

    const deniedPatch = await request(address)
      .patch(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        value: 'should-fail'
      });
    expect(deniedPatch.status).toBe(403);

    const grantWriteResponse = await request(address)
      .patch(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        acls: [
          {
            principal: 'user',
            principalId: memberId,
            canRead: true,
            canWrite: true
          }
        ]
      });
    expect(grantWriteResponse.status).toBe(200);

    const memberListAfterGrant = await request(address)
      .get('/secrets')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberListAfterGrant.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secretId,
          myPermissions: { read: true, write: true }
        })
      ])
    );

    const memberUpdate = await request(address)
      .patch(`/secrets/${secretId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        value: 'updated-secret'
      });
    expect(memberUpdate.status).toBe(200);
    expect(memberUpdate.body).toMatchObject({ id: secretId, version: 2 });

    const historyResponse = await request(address)
      .get(`/secrets/${secretId}/history`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(historyResponse.body).toEqual([
      expect.objectContaining({
        version: 1,
        value: 'initial-secret',
        updatedBy: memberId
      })
    ]);
  });
});
