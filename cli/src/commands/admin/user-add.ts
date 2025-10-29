import type { Command } from 'commander';

import { initApiClient, normalizeApiError } from '../../services/api.js';
import { adminCreateUser } from '../../services/resources.js';
import type { AdminActionResult } from '../../services/schemas.js';
import { AdminPanel } from '../../ui/screens/AdminPanel.js';
import { getApiOption, handleCommandError, renderScreen } from '../utils.js';

export const registerAdminUserAdd = (userCommand: Command) => {
  userCommand
    .command('add <email>')
    .description('Invite a new user to the organization')
    .option('--name <displayName>', 'Display name for the user')
    .option('--admin', 'Grant admin access')
    .action(async (email: string, options: { name?: string; admin?: boolean }, command: Command) => {
      const apiBaseUrl = getApiOption(command);
      let result: AdminActionResult | null = null;
      let error: Error | null = null;

      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        result = await adminCreateUser(client, {
          email,
          name: options.name,
          admin: Boolean(options.admin),
        });
      } catch (err) {
        const apiError = normalizeApiError(err);
        error = new Error(apiError.message ?? 'Failed to create user');
      }

      try {
        await renderScreen(
          AdminPanel,
          {
            title: 'Create User',
            actionDescription: `Inviting ${email}`,
            result,
            error,
          },
          { command, apiBaseUrl },
        );
      } catch (screenError) {
        handleCommandError(screenError);
      }

      if (error) {
        process.exitCode = 1;
      }
    });
};
