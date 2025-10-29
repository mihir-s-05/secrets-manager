import React from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import SecretEdit from '../SecretEdit.js';
import {renderWithProviders} from '../../test-utils/render.js';
import type {SessionSnapshot} from '../../state/session.js';

vi.mock('../../api/secrets.js', () => ({
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  fetchSecretDetail: vi.fn()
}));

vi.mock('../../api/directory.js', () => ({
  fetchTeams: vi.fn().mockResolvedValue([]),
  fetchUsers: vi.fn().mockResolvedValue([])
}));

const secretsModule = await import('../../api/secrets.js');
const directoryModule = await import('../../api/directory.js');

const createSecret = vi.mocked(secretsModule.createSecret);
const updateSecret = vi.mocked(secretsModule.updateSecret);
const fetchSecretDetail = vi.mocked(secretsModule.fetchSecretDetail);
const fetchTeams = vi.mocked(directoryModule.fetchTeams);
const fetchUsers = vi.mocked(directoryModule.fetchUsers);

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
    isAdmin: true,
    org: {id: 'org-1', name: 'Org'},
    teams: []
  }
};

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SecretEdit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchTeams.mockResolvedValue([]);
    fetchUsers.mockResolvedValue([]);
  });

  it('shows validation errors when required fields missing', async () => {
    const notify = vi.fn();
    const {lastFrame, stdin, services} = renderWithProviders(
      <SecretEdit mode="create" />, 
      {
        session: authSession,
        route: {name: 'SECRET_EDIT', params: {mode: 'create'}},
        services: {notify}
      }
    );

    await wait();
    stdin.write('s');
    await wait();
    await wait();
    const frame = lastFrame();
    expect(frame).toContain('Key is required');
    expect(frame).toContain('Value is required');
    expect(notify).toHaveBeenCalledWith('Key is required', 'error');
    expect(createSecret).not.toHaveBeenCalled();
    services.setEditing(false);
  });

  it('saves secret when editing existing entry', async () => {
    fetchSecretDetail.mockResolvedValue({
      id: 'secret-1',
      key: 'api-key',
      value: 'top-secret',
      version: 3,
      updatedAt: new Date().toISOString(),
      myPermissions: {read: true, write: true},
      acls: [
        {
          principalType: 'org',
          principalId: 'org-1',
          principalName: 'Org',
          permissions: {read: true, write: true}
        }
      ]
    });
    updateSecret.mockResolvedValue({
      id: 'secret-1',
      key: 'api-key',
      value: 'top-secret',
      version: 4,
      updatedAt: new Date().toISOString(),
      myPermissions: {read: true, write: true},
      acls: []
    });

    const notify = vi.fn();
    const {stdin, router, services} = renderWithProviders(
      <SecretEdit secretId="secret-1" mode="edit" />, 
      {
        session: authSession,
        route: {name: 'SECRET_EDIT', params: {mode: 'edit', secretId: 'secret-1'}},
        services: {notify}
      }
    );

    await wait();
    await wait();
    stdin.write('s');
    await wait();
    await wait();

    expect(updateSecret).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Secret 'api-key' saved"), 'success');
    expect(router.replace).toHaveBeenCalledWith('SECRET_VIEW', {secretId: 'secret-1'});
    services.setEditing(false);
  });
});
