import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

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

if (require.main === module) {
  seed().catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}
