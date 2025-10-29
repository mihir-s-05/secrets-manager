import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import {
  exchangeDeviceCodeForToken,
  fetchGithubUser,
  requestDeviceCode
} from '../auth/deviceflow';
import {
  issueRefreshToken,
  revokeRefreshToken,
  signAccessJwt,
  verifyRefreshToken
} from '../auth/tokens';
import { sendError, sendZodError } from '../utils/errors';
import { loadUserWithOrgAndTeams } from './user-utils';

type DeviceSession = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  issuedAt: number;
  expiresAt: number;
  pollInterval: number;
};

type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const deviceSessions = new Map<string, DeviceSession>();
const pollLimiter = new Map<string, RateLimitBucket>();

const POLL_LIMIT = 5;
const POLL_WINDOW_MS = 10_000;

function computeRetryAfterSeconds(session: DeviceSession) {
  return Math.max(1, Math.ceil(session.pollInterval));
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of deviceSessions) {
    if (session.expiresAt <= now) {
      deviceSessions.delete(key);
    }
  }
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const bucket = pollLimiter.get(key);
  if (!bucket || now - bucket.windowStart > POLL_WINDOW_MS) {
    pollLimiter.set(key, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  if (bucket.count >= POLL_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((POLL_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { allowed: false, retryAfter };
  }

  bucket.count += 1;
  return { allowed: true };
}

const authStartResponseSchema = z.object({
  deviceCode: z.string(),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url().optional(),
  userCode: z.string(),
  pollIntervalSec: z.number().int().positive(),
  expiresIn: z.number().int().positive()
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/start', async (request, reply) => {
    pruneExpiredSessions();

    if (!env.GITHUB_CLIENT_ID) {
      request.log.error('GITHUB_CLIENT_ID is not configured');
      return sendError(
        reply,
        500,
        'server_error',
        'GitHub OAuth client ID is not configured on the server'
      );
    }

    try {
      const device = await requestDeviceCode(env.GITHUB_CLIENT_ID);
      const session: DeviceSession = {
        deviceCode: device.deviceCode,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        issuedAt: Date.now(),
        expiresAt: Date.now() + device.expiresIn * 1000,
        pollInterval: device.interval
      };

      deviceSessions.set(device.deviceCode, session);

      const response = authStartResponseSchema.parse({
        deviceCode: device.deviceCode,
        verificationUri: device.verificationUri,
        verificationUriComplete: device.verificationUriComplete,
        userCode: device.userCode,
        pollIntervalSec: device.interval,
        expiresIn: device.expiresIn
      });

      return reply.status(200).send(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

      // Surface a helpful error when GitHub Device Flow is not enabled for the OAuth App
      if (message.includes('device_flow_disabled')) {
        request.log.warn(
          { err: error },
          'GitHub Device Flow is disabled for the configured OAuth App. Enable it in GitHub → Settings → Developer settings → OAuth Apps → your app → Enable Device Flow.'
        );
        return sendError(
          reply,
          400,
          'device_flow_disabled',
          'GitHub Device Flow is disabled for your OAuth App. Enable it in GitHub settings and try again.'
        );
      }

      request.log.error({ err: error }, 'Failed to request GitHub device code');
      return sendError(reply, 500, 'server_error', 'Failed to start device authorization');
    }
  });

  fastify.post('/auth/poll', async (request, reply) => {
    pruneExpiredSessions();

    const schema = z.object({
      deviceCode: z.string().min(1),
      deviceId: z.string().min(1)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const { deviceCode, deviceId } = parsed.data;
    const session = deviceSessions.get(deviceCode);

    if (!session) {
      return sendError(reply, 401, 'unauthorized', 'Unknown or expired device code');
    }

    if (Date.now() >= session.expiresAt) {
      deviceSessions.delete(deviceCode);
      return sendError(reply, 401, 'unauthorized', 'Device code has expired');
    }

    const limiterKey = `${deviceId}:${request.ip}`;
    const rateCheck = checkRateLimit(limiterKey);
    if (!rateCheck.allowed) {
      reply.header('Retry-After', rateCheck.retryAfter);
      return sendError(reply, 429, 'rate_limited', 'Too many polling requests');
    }

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      request.log.error('GitHub OAuth credentials not configured');
      return sendError(
        reply,
        500,
        'server_error',
        'GitHub OAuth credentials are not configured on the server'
      );
    }

    try {
      const result = await exchangeDeviceCodeForToken({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        deviceCode
      });

      if (result.status === 'pending') {
        if (result.interval) {
          session.pollInterval = Math.max(session.pollInterval, result.interval);
        }
        const retryAfter = computeRetryAfterSeconds(session);
        reply.header('Retry-After', retryAfter);
        return sendError(reply, 428, 'authorization_pending', 'Authorization is pending');
      }

      const githubProfile = await fetchGithubUser(result.accessToken);

      const transactionResult = await fastify.prisma.$transaction(async (tx) => {
        let user = await tx.user.findFirst({
          where: {
            oauthProvider: 'github',
            oauthSub: githubProfile.id
          }
        });

        if (!user) {
          user = await tx.user.findFirst({
            where: { email: githubProfile.email }
          });
        }

        const displayName =
          githubProfile.name?.trim() ||
          githubProfile.login?.trim() ||
          githubProfile.email.split('@')[0];

        if (user) {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              email: githubProfile.email,
              displayName,
              oauthProvider: 'github',
              oauthSub: githubProfile.id
            }
          });
        } else {
          const org =
            (await tx.organization.findFirst({ where: { name: 'Acme' } })) ??
            (await tx.organization.create({ data: { name: 'Acme' } }));

          user = await tx.user.create({
            data: {
              orgId: org.id,
              email: githubProfile.email,
              displayName,
              oauthProvider: 'github',
              oauthSub: githubProfile.id
            }
          });
        }

        const loaded = await loadUserWithOrgAndTeams(tx, user.id);
        if (!loaded) {
          throw new Error('User context missing after upsert');
        }

        const accessToken = signAccessJwt({
          userId: loaded.user.id,
          orgId: loaded.user.orgId,
          isAdmin: loaded.user.isAdmin,
          teamIds: loaded.teamIds
        });

        const refreshToken = await issueRefreshToken(user.id, deviceId, tx);

        return {
          accessToken,
          refreshToken,
          user: loaded.response
        };
      });

      deviceSessions.delete(deviceCode);

      return reply.status(200).send(transactionResult);
    } catch (error) {
      request.log.warn({ err: error }, 'Polling failed');

      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

      if (message.includes('expired')) {
        deviceSessions.delete(deviceCode);
        return sendError(reply, 401, 'unauthorized', 'Device code has expired');
      }

      return sendError(reply, 500, 'server_error', 'Device authorization failed');
    }
  });

  fastify.post('/auth/refresh', async (request, reply) => {
    const schema = z.object({
      refreshToken: z.string().min(1),
      deviceId: z.string().min(1)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const { refreshToken, deviceId } = parsed.data;
    const record = await verifyRefreshToken(refreshToken, deviceId, fastify.prisma);

    if (!record) {
      return sendError(reply, 401, 'unauthorized', 'Invalid refresh token');
    }

    const loaded = await loadUserWithOrgAndTeams(fastify.prisma, record.userId);
    if (!loaded) {
      return sendError(reply, 401, 'unauthorized', 'User no longer exists');
    }

    const accessToken = signAccessJwt({
      userId: loaded.user.id,
      orgId: loaded.user.orgId,
      isAdmin: loaded.user.isAdmin,
      teamIds: loaded.teamIds
    });

    return reply.status(200).send({ accessToken });
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const schema = z.object({
      refreshToken: z.string().min(1)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    await revokeRefreshToken(parsed.data.refreshToken, fastify.prisma);
    return reply.status(204).send();
  });
};

export default authRoutes;

export const __testing = {
  resetAuthState() {
    deviceSessions.clear();
    pollLimiter.clear();
  }
};
