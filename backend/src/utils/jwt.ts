import { createHmac, timingSafeEqual } from 'node:crypto';

function base64urlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64url');
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export type JwtSignOptions = {
  expiresInSeconds?: number;
  subject?: string;
};

export type VerifiedJwtPayload = Record<string, unknown> & {
  exp?: number;
  iat?: number;
  sub?: string;
};

export function signJwtHS256(
  payload: Record<string, unknown>,
  secret: string,
  options: JwtSignOptions = {}
): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);

  const fullPayload: Record<string, unknown> = {
    ...payload,
    iat: now
  };

  if (options.expiresInSeconds) {
    fullPayload.exp = now + options.expiresInSeconds;
  }

  if (options.subject) {
    fullPayload.sub = options.subject;
  }

  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(fullPayload));
  const data = `${headerEncoded}.${payloadEncoded}`;

  const signature = createHmac('sha256', secret).update(data).digest('base64url');

  return `${data}.${signature}`;
}

export function verifyJwtHS256(token: string, secret: string): VerifiedJwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const data = `${headerPart}.${payloadPart}`;

  let expectedSignature: Buffer;
  let providedSignature: Buffer;
  try {
    expectedSignature = createHmac('sha256', secret).update(data).digest();
    providedSignature = base64urlDecode(signaturePart);
  } catch {
    throw new Error('Invalid token signature');
  }

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error('Invalid token signature');
  }

  let header: { alg?: string };
  let payload: VerifiedJwtPayload;
  try {
    header = JSON.parse(base64urlDecode(headerPart).toString('utf8'));
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new Error('Invalid token payload');
  }

  if (header.alg !== 'HS256') {
    throw new Error('Unexpected token algorithm');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

