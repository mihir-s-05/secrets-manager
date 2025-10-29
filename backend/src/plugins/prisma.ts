import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma';

export function registerPrisma(app: FastifyInstance) {
  if (app.hasDecorator('prisma')) {
    return;
  }

  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}
