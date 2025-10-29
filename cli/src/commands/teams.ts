import type { Command } from 'commander';

import { TeamsScreen } from '../ui/screens/Teams.js';
import { handleCommandError, renderScreen } from './utils.js';

export const registerTeamsCommand = (program: Command) => {
  program
    .command('teams')
    .description('List organization teams for sharing')
    .action(async (_options, command) => {
      try {
        await renderScreen(TeamsScreen, {}, { command });
      } catch (error) {
        handleCommandError(error);
      }
    });
};
