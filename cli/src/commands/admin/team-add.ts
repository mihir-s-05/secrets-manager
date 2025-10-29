import type { Command } from 'commander';

import { initApiClient, normalizeApiError } from '../../services/api.js';
import { adminCreateTeam } from '../../services/resources.js';
import type { AdminActionResult } from '../../services/schemas.js';
import { AdminPanel } from '../../ui/screens/AdminPanel.js';
import { getApiOption, handleCommandError, renderScreen } from '../utils.js';

export const registerAdminTeamAdd = (teamCommand: Command) => {
  teamCommand
    .command('add <name>')
    .description('Create a new team')
    .action(async (name: string, command: Command) => {
      const apiBaseUrl = getApiOption(command);
      let result: AdminActionResult | null = null;
      let error: Error | null = null;
      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        result = await adminCreateTeam(client, name);
      } catch (err) {
        const apiError = normalizeApiError(err);
        error = new Error(apiError.message ?? 'Failed to create team');
      }

      try {
        await renderScreen(
          AdminPanel,
          {
            title: 'Create Team',
            actionDescription: `Creating team ${name}`,
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
