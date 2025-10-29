import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../env.js';
import { prisma as defaultPrisma } from '../prisma.js';
import { signJwtHS256, verifyJwtHS256 } from '../utils/jwt.js';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_MIN * 60;
const refreshTokenTtlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const secret = env.JWT_SECRET;

export type AccessTokenClaims = {
  userId: string;
  orgId: string;
  isAdmin: boolean;
  teamIds: string[];
};

function generateToken(): string {
  return randomBytes(48).toString('base64url');
}

export type VerifiedAccessToken = {
  sub: string;
  orgId: string;
  isAdmin: boolean;
  teamIds: string[];
  iat?: number;
  exp?: number;
};

export function signAccessJwt(claims: AccessTokenClaims): string {
  return signJwtHS256(
    {
      orgId: claims.orgId,
      isAdmin: claims.isAdmin,
      teamIds: claims.teamIds
    },
    secret,
    {
      expiresInSeconds: accessTokenTtlSeconds,
      subject: claims.userId
    }
  );
}

export function verifyAccessJwt(token: string): VerifiedAccessToken {
  const payload = verifyJwtHS256(token, secret);
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token subject missing');
  }

  if (typeof payload.orgId !== 'string') {
    throw new Error('Token missing orgId');
  }

  if (typeof payload.isAdmin !== 'boolean') {
    throw new Error('Token missing admin flag');
  }

  const teamIds = Array.isArray(payload.teamIds) ? payload.teamIds.map(String) : [];

  return {
    sub: payload.sub,
    orgId: payload.orgId,
    isAdmin: payload.isAdmin,
    teamIds,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    exp: typeof payload.exp === 'number' ? payload.exp : undefined
  };
}

export async function issueRefreshToken(
  userId: string,
  deviceId: string,
  prisma: PrismaClient | TransactionClient = defaultPrisma
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs);

  await prisma.refreshToken.create({
    data: {
      userId,
      deviceId,
      token,
      expiresAt
    }
  });

  return token;
}

export async function verifyRefreshToken(
  token: string,
  deviceId: string,
  prisma: PrismaClient = defaultPrisma
) {
  const record = await prisma.refreshToken.findUnique({
    where: { token }
  });

  if (!record) {
    return null;
  }

  if (record.deviceId !== deviceId) {
    return null;
  }

  if (record.revokedAt) {
    return null;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return record;
}

export async function revokeRefreshToken(
  token: string,
  prisma: PrismaClient = defaultPrisma
) {
  await prisma.refreshToken.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
