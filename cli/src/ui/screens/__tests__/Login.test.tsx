import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { render } from 'ink-testing-library';
import type { AxiosInstance } from 'axios';

import { LoginScreen } from '../Login.js';
import { pollDeviceFlow, startDeviceFlow } from '../../../services/auth.js';

vi.mock('../../../services/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/auth.js')>();
  return {
    ...actual,
    startDeviceFlow: vi.fn(),
    pollDeviceFlow: vi.fn(),
  };
});

const createClient = () => ({}) as AxiosInstance;

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(startDeviceFlow).mockReset();
    vi.mocked(pollDeviceFlow).mockReset();
  });

  it('renders pending state while waiting for login', async () => {
    vi.mocked(startDeviceFlow).mockResolvedValue({
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/device',
      pollIntervalSec: 1,
    });
    vi.mocked(pollDeviceFlow).mockResolvedValue(null);

    const { lastFrame } = render(
      <LoginScreen apiClient={createClient()} autoOpenBrowser={false} />,
    );

    await waitFor(() => {
      expect(vi.mocked(startDeviceFlow)).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('Waiting for you to confirm login');
    });

    expect(lastFrame()).toMatchInlineSnapshot(`
"┌──────────────────────────────────────────────────────────────┐\n│ Sign in to Secrets Manager                                   │\n│ Complete login in your browser                               │\n└──────────────────────────────────────────────────────────────┘\nVisit the verification URL and enter this device code to       \ncontinue.                                                       \nhttps://example.com/device                                      \nDevice code: ABCD-1234                                          \nPress [o] to open the URL again.                                \nWaiting for you to confirm login in the browser…"
`);
  });

  it('renders success message once login completes', async () => {
    vi.useFakeTimers();

    vi.mocked(startDeviceFlow).mockResolvedValue({
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/device',
      pollIntervalSec: 1,
    });

    vi.mocked(pollDeviceFlow)
      .mockResolvedValueOnce({
        accessToken: 'new-access',
        refreshToken: 'refresh-token',
        deviceId: 'device-id',
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      })
      .mockResolvedValue(null);

    const { lastFrame } = render(
      <LoginScreen apiClient={createClient()} autoOpenBrowser={false} />,
    );

    await waitFor(() => {
      expect(vi.mocked(pollDeviceFlow)).toHaveBeenCalled();
    });

    await vi.runAllTimersAsync();

    expect(lastFrame()).toContain('Logged in as user@example.com');
    expect(lastFrame()).toMatchInlineSnapshot(`
"┌──────────────────────────────────────────────────────────────┐\n│ Sign in to Secrets Manager                                   │\n│ Complete login in your browser                               │\n└──────────────────────────────────────────────────────────────┘\nVisit the verification URL and enter this device code to       \ncontinue.                                                       \nhttps://example.com/device                                      \nDevice code: ABCD-1234                                          \nPress [o] to open the URL again.                                \nLogged in as user@example.com. Closing…"
`);
  });
});
