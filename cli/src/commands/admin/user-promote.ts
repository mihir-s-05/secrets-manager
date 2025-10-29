import type { Command } from 'commander';

import { initApiClient, normalizeApiError } from '../../services/api.js';
import { adminPromoteUser } from '../../services/resources.js';
import type { AdminActionResult } from '../../services/schemas.js';
import { AdminPanel } from '../../ui/screens/AdminPanel.js';
import { getApiOption, handleCommandError, renderScreen } from '../utils.js';

export const registerAdminUserPromote = (userCommand: Command) => {
  userCommand
    .command('promote <userId>')
    .description('Promote a user to administrator')
    .action(async (userId: string, command: Command) => {
      const apiBaseUrl = getApiOption(command);
      let result: AdminActionResult | null = null;
      let error: Error | null = null;

      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        result = await adminPromoteUser(client, userId);
      } catch (err) {
        const apiError = normalizeApiError(err);
        error = new Error(apiError.message ?? 'Failed to promote user');
      }

      try {
        await renderScreen(
          AdminPanel,
          {
            title: 'Promote User',
            actionDescription: `Promoting user ${userId} to admin`,
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
