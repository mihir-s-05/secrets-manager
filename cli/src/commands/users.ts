import type { Command } from 'commander';

import { UsersScreen } from '../ui/screens/Users.js';
import { handleCommandError, renderScreen } from './utils.js';

export const registerUsersCommand = (program: Command) => {
  program
    .command('users')
    .description('List organization users for sharing')
    .action(async (_options, command) => {
      try {
        await renderScreen(UsersScreen, {}, { command });
      } catch (error) {
        handleCommandError(error);
      }
    });
};
