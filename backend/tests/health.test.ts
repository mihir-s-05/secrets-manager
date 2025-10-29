import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { afterAll, beforeAll, expect, test } from 'vitest';

let server: FastifyInstance;
let address: string;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const { createServer } = await import('../src/index');
  server = createServer();
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  if (server) {
    await server.close();
  }
});

test('GET /health responds with ok true', async () => {
  const response = await request(address).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ ok: true });
});
