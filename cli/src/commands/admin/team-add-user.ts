import type { Command } from 'commander';

import { initApiClient, normalizeApiError } from '../../services/api.js';
import { adminTeamAddUser } from '../../services/resources.js';
import type { AdminActionResult } from '../../services/schemas.js';
import { AdminPanel } from '../../ui/screens/AdminPanel.js';
import { getApiOption, handleCommandError, renderScreen } from '../utils.js';

const ROLE_VALUES = ['read', 'write', 'rw'] as const;

export const registerAdminTeamAddUser = (teamCommand: Command) => {
  teamCommand
    .command('add-user <teamId> <userId>')
    .description('Add a user to a team and configure permissions')
    .option('--role <role>', 'Access level: read, write, or rw', (value) => value.toLowerCase(), 'rw')
    .action(async (teamId: string, userId: string, options: { role: string }, command: Command) => {
      const apiBaseUrl = getApiOption(command);
      let result: AdminActionResult | null = null;
      let error: Error | null = null;
      let role = options.role as (typeof ROLE_VALUES)[number];
      if (!ROLE_VALUES.includes(role)) {
        role = 'rw';
      }

      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl, persist: Boolean(apiBaseUrl) });
        result = await adminTeamAddUser(client, teamId, userId, role);
      } catch (err) {
        const apiError = normalizeApiError(err);
        error = new Error(apiError.message ?? 'Failed to add user to team');
      }

      try {
        await renderScreen(
          AdminPanel,
          {
            title: 'Add Team Member',
            actionDescription: `Adding user ${userId} to team ${teamId} (${role})`,
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
