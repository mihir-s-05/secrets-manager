import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

loadEnv();

export async function seed(prisma?: PrismaClient): Promise<void> {
  const client = prisma ?? new PrismaClient();

  try {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim() || 'admin@example.com';

    const organization = await client.organization.upsert({
      where: { name: 'Acme' },
      update: {},
      create: { name: 'Acme' }
    });

    await client.user.upsert({
      where: { email: adminEmail },
      update: {
        orgId: organization.id,
        displayName: 'Admin',
        isAdmin: true,
        oauthProvider: 'github',
        oauthSub: 'seed-admin'
      },
      create: {
        orgId: organization.id,
        email: adminEmail,
        displayName: 'Admin',
        isAdmin: true,
        oauthProvider: 'github',
        oauthSub: 'seed-admin'
      }
    });
  } finally {
    if (!prisma) {
      await client.$disconnect();
    }
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  seed().catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}
