import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { render } from 'ink-testing-library';
import type { AxiosInstance } from 'axios';

import { SecretsListScreen } from '../SecretsList.js';
import { fetchSecrets } from '../../../services/resources.js';

vi.mock('../../../services/resources.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/resources.js')>();
  return {
    ...actual,
    fetchSecrets: vi.fn(),
  };
});

const createClient = () => ({}) as AxiosInstance;

describe('SecretsListScreen', () => {
  it('renders fetched secrets in a table', async () => {
    vi.mocked(fetchSecrets).mockResolvedValue([
      {
        id: '1',
        key: 'api-key',
        version: 3,
        updatedAt: '2025-10-28T12:00:00Z',
        permissions: { read: true, write: true },
      },
      {
        id: '2',
        key: 'service-token',
        version: 1,
        updatedAt: '2025-10-25T09:30:00Z',
        permissions: { read: true },
      },
    ]);

    const { lastFrame } = render(<SecretsListScreen apiClient={createClient()} />);

    await waitFor(() => {
      expect(vi.mocked(fetchSecrets)).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('api-key');
    });

    expect(lastFrame()).toMatchInlineSnapshot(`
"Secrets                                                  \nShowing 2 of 2                                            \nKey bindings                                             \n↑ / ↓ · Move selection                                   \nenter · View secret details                              \n/ · Search by key                                        \nf · Toggle permission filter                             \na · Create a new secret                                  \n? · Toggle help overlay                                  \nq / esc · Close list                                     \napi-key         3   10/28/2025, 12:00:00 PM   RW         \nservice-token    1   10/25/2025, 9:30:00 AM    R          "
`);
  });
});
