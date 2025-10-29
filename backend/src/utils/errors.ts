import type { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'conflict'
  | 'server_error';

export class HttpError extends Error {
  statusCode: number;
  code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'HttpError';
  }
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode | string,
  message: string
) {
  return reply.status(statusCode).send({ error: { code, message } });
}

export function formatZodError(error: ZodError): string {
  return error.errors
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function sendZodError(reply: FastifyReply, error: ZodError) {
  return sendError(reply, 400, 'bad_request', formatZodError(error));
}

export function mapPrismaError(
  error: unknown,
  options?: { conflictMessage?: string; notFoundMessage?: string }
): HttpError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new HttpError(
        409,
        'conflict',
        options?.conflictMessage ?? 'Resource already exists'
      );
    }
    if (error.code === 'P2025') {
      return new HttpError(404, 'not_found', options?.notFoundMessage ?? 'Resource not found');
    }
  }
  return null;
}

export function sendMappedError(
  reply: FastifyReply,
  error: unknown,
  options?: {
    conflictMessage?: string;
    notFoundMessage?: string;
    defaultMessage?: string;
  }
) {
  if (error instanceof HttpError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  if (error instanceof ZodError) {
    return sendZodError(reply, error);
  }

  const prismaError = mapPrismaError(error, {
    conflictMessage: options?.conflictMessage,
    notFoundMessage: options?.notFoundMessage
  });
  if (prismaError) {
    return sendError(reply, prismaError.statusCode, prismaError.code, prismaError.message);
  }

  const message = options?.defaultMessage ?? 'Internal server error';
  return sendError(reply, 500, 'server_error', message);
}
