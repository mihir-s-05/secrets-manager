import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

const projectRoot = path.join(__dirname, '..');
const prismaDir = path.join(projectRoot, 'prisma');
const testDbPath = path.join(prismaDir, 'database.test.db');
const testDbJournalPath = `${testDbPath}-journal`;
const databaseUrl = `file:${testDbPath}`;

let prisma: PrismaClient | undefined;

function getPrismaCliExecutable(): string {
  const binary = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return path.join(projectRoot, 'node_modules', '.bin', binary);
}

beforeAll(() => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.ADMIN_EMAIL = 'admin@example.com';
});

beforeEach(async () => {
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
});

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }

  try {
    rmSync(testDbPath);
  } catch {
    // ignore missing file
  }

  try {
    rmSync(testDbJournalPath);
  } catch {
    // ignore missing file
  }
});

describe('database seed', () => {
  test('seed produces exactly one Acme organization and an admin user', async () => {
    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    await seed(prisma);
    await seed(prisma); // idempotent

    const organizations = await prisma.organization.findMany({
      include: { users: true }
    });

    expect(organizations).toHaveLength(1);
    const [acme] = organizations;
    expect(acme.name).toBe('Acme');
    expect(acme.users).toHaveLength(1);

    const [admin] = acme.users;
    expect(admin.email).toBe('admin@example.com');
    expect(admin.isAdmin).toBe(true);
    expect(admin.orgId).toBe(acme.id);
  });
});

describe('prisma client', () => {
  test('supports basic create and read operations', async () => {
    if (!prisma) {
      throw new Error('Prisma client not initialized');
    }

    const orgName = `TestOrg-${Date.now()}`;
    const organization = await prisma.organization.create({
      data: { name: orgName }
    });

    const userEmail = `user-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        orgId: organization.id,
        email: userEmail,
        displayName: 'Test User',
        oauthProvider: 'github',
        oauthSub: `test-${Date.now()}`
      }
    });

    const fetched = await prisma.user.findUnique({
      where: { id: user.id },
      include: { org: true }
    });

    expect(fetched?.email).toBe(userEmail);
    expect(fetched?.org.name).toBe(orgName);
  });
});
