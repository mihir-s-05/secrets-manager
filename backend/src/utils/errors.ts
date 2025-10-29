import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'conflict'
  | 'server_error';

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

