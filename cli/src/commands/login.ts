import type { Command } from 'commander';

import { hydrateSession } from '../services/auth.js';
import { initApiClient } from '../services/api.js';
import { LoginScreen } from '../ui/screens/Login.js';
import { renderScreen, handleCommandError, getApiOption } from './utils.js';

export const registerLoginCommand = (program: Command) => {
  program
    .command('login')
    .description('Authenticate with the secrets manager using the device flow')
    .option('--no-open', 'Do not automatically open the browser for verification')
    .action(async (options, command) => {
      try {
        const apiBaseUrl = getApiOption(command);
        await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        await hydrateSession();
        await renderScreen(
          LoginScreen,
          {
            autoOpenBrowser: options.open !== false,
            onSuccess: () => {
              // success toast handled within the screen
            },
          },
          { command, apiBaseUrl },
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
};
