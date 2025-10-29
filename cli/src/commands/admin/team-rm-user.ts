import type { Command } from 'commander';

import { initApiClient, normalizeApiError } from '../../services/api.js';
import { adminTeamRemoveUser } from '../../services/resources.js';
import type { AdminActionResult } from '../../services/schemas.js';
import { AdminPanel } from '../../ui/screens/AdminPanel.js';
import { getApiOption, handleCommandError, renderScreen } from '../utils.js';

export const registerAdminTeamRemoveUser = (teamCommand: Command) => {
  teamCommand
    .command('rm-user <teamId> <userId>')
    .description('Remove a user from a team')
    .action(async (teamId: string, userId: string, command: Command) => {
      const apiBaseUrl = getApiOption(command);
      let result: AdminActionResult | null = null;
      let error: Error | null = null;

      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        result = await adminTeamRemoveUser(client, teamId, userId);
      } catch (err) {
        const apiError = normalizeApiError(err);
        error = new Error(apiError.message ?? 'Failed to remove user from team');
      }

      try {
        await renderScreen(
          AdminPanel,
          {
            title: 'Remove Team Member',
            actionDescription: `Removing user ${userId} from team ${teamId}`,
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
