import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import * as authModule from '../auth.js';
import { refreshAccessToken } from '../auth.js';
import { useAppStore, resetAppStore } from '../store.js';

const createClient = (postImpl: ReturnType<typeof vi.fn>) => {
  return {
    post: postImpl,
  } as unknown as AxiosInstance;
};

describe('refreshAccessToken', () => {
  it('returns null when no refresh context is available', async () => {
    resetAppStore();
    const client = createClient(vi.fn());

    vi.spyOn(authModule, 'getStoredSession').mockResolvedValue(null);

    const result = await refreshAccessToken(client);
    expect(result).toBeNull();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('updates the store when a new token is issued', async () => {
    resetAppStore();
    const store = useAppStore.getState();
    store.setSession({ refreshToken: 'refresh', deviceId: 'device-123' });

    const post = vi.fn().mockResolvedValue({
      data: {
        accessToken: 'new-token',
        refreshToken: 'updated-refresh',
        deviceId: 'new-device',
        accessTokenExpiresIn: 60,
        user: { id: 'user-123', email: 'user@example.com' },
      },
    });
    const client = createClient(post);

    const persistSpy = vi
      .spyOn(authModule, 'persistSession')
      .mockResolvedValue();
    const storedSpy = vi.spyOn(authModule, 'getStoredSession').mockResolvedValue(null);

    const session = await refreshAccessToken(client);

    expect(post).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'refresh',
      deviceId: 'device-123',
    });
    expect(session).toEqual(
      expect.objectContaining({ accessToken: 'new-token', refreshToken: 'updated-refresh' }),
    );

    const state = useAppStore.getState();
    expect(state.accessToken).toBe('new-token');
    expect(state.refreshToken).toBe('updated-refresh');
    expect(state.deviceId).toBe('new-device');
    expect(state.user?.email).toBe('user@example.com');

    expect(persistSpy).toHaveBeenCalled();
    expect(storedSpy).toHaveBeenCalled();
  });
});
