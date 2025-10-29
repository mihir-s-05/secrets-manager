import type { Command } from 'commander';

import { clearSession, logout } from '../services/auth.js';
import { initApiClient } from '../services/api.js';
import { renderScreen, handleCommandError, getApiOption } from './utils.js';
import { AdminPanel } from '../ui/screens/AdminPanel.js';

export const registerLogoutCommand = (program: Command) => {
  program
    .command('logout')
    .description('Clear the local session and revoke refresh tokens')
    .action(async (_options, command) => {
      try {
        const apiBaseUrl = getApiOption(command);
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        await logout(client);
        await clearSession();
        await renderScreen(
          AdminPanel,
          {
            title: 'Logout',
            actionDescription: 'You have been signed out of the secrets manager.',
            result: { status: 'ok', message: 'Session cleared' },
          },
          { command, apiBaseUrl },
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
};
