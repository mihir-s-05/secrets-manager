import {describe, expect, it} from 'vitest';
import React from 'react';
import Home from '../Home.js';
import {renderWithProviders} from '../../test-utils/render.js';
import {type SessionSnapshot} from '../../state/session.js';

const authSession = (): SessionSnapshot => ({
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
});

describe('Home screen', () => {
  it('shows login option when unauthenticated', () => {
    const {lastFrame} = renderWithProviders(<Home />);
    expect(lastFrame()).toContain('Login');
  });

  it('shows logout option when authenticated', () => {
    const {lastFrame} = renderWithProviders(<Home />, {session: authSession()});
    expect(lastFrame()).toContain('Logout');
  });
});
