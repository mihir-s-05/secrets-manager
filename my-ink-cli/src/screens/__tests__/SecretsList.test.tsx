import React from 'react';
import {describe, expect, it, vi, beforeEach} from 'vitest';
import SecretsList from '../SecretsList.js';
import {renderWithProviders} from '../../test-utils/render.js';
import {type SessionSnapshot} from '../../state/session.js';

vi.mock('../../api/secrets.js', () => ({
  fetchSecrets: vi.fn()
}));

const secretsModule = await import('../../api/secrets.js');
const fetchSecrets = vi.mocked(secretsModule.fetchSecrets);

const authSession: SessionSnapshot = {
  serverUrl: 'http://localhost:4000',
  deviceId: 'device-1',
  accessToken: 'token',
  accessTokenExpiresAt: Date.now() + 60_000,
  refreshToken: 'refresh',
  user: {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    isAdmin: false,
    org: {id: 'org-1', name: 'Org'},
    teams: []
  }
};

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SecretsList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders fetched secrets with permissions', async () => {
    fetchSecrets.mockResolvedValue([
      {
        id: '1',
        key: 'db/password',
        version: 2,
        updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        myPermissions: {read: true, write: false}
      }
    ]);

    const {lastFrame} = renderWithProviders(<SecretsList />, {session: authSession, route: {name: 'SECRETS'}});
    await wait();
    await wait();
    const frame = lastFrame();
    expect(frame).toContain('db/password');
    expect(frame).toContain('RW: R-');
  });
});
