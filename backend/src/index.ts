import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import pkg from '../package.json';
import { env } from './env';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import directoryRoutes from './routes/directory';
import adminRoutes from './routes/admin';
import { registerPrisma } from './plugins/prisma';
import { registerAuthDecorators } from './plugins/auth';

function allowLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export function createServer(): FastifyInstance {
  const app = fastify({ logger: true });

  app.register(cors, {
    origin: (origin, cb) => {
      if (allowLocalhostOrigin(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Origin not allowed'), false);
      }
    }
  });

  app.register(sensible);
  registerPrisma(app);
  registerAuthDecorators(app);

  app.register(authRoutes);
  app.register(meRoutes);
  app.register(directoryRoutes);
  app.register(adminRoutes);

  app.get('/health', async () => {
    return { ok: true, version: pkg.version };
  });

  return app;
}

async function start() {
  const app = createServer();

  let shuttingDown = false;
  const handleSignal = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'Received shutdown signal');
    try {
      await app.close();
      app.log.info('Server shut down gracefully');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    const address = await app.listen({ host: '0.0.0.0', port: env.PORT });
    app.log.info(`Server listening on ${address}`);
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
