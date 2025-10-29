import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import pkg from '../package.json';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerListCommand } from './commands/ls.js';
import { registerGetCommand } from './commands/get.js';
import { registerSetCommand } from './commands/set.js';
import { registerUsersCommand } from './commands/users.js';
import { registerTeamsCommand } from './commands/teams.js';
import { registerAdminCommands } from './commands/admin/index.js';
import { handleCommandError } from './commands/utils.js';

const program = new Command();

program
  .name('secrets')
  .description('Ink-based CLI for the secrets manager backend')
  .version(pkg.version ?? '0.0.0')
  .option('--api <url>', 'Override the backend API base URL (default http://localhost:4000)')
  .showHelpAfterError();

registerLoginCommand(program);
registerLogoutCommand(program);
registerListCommand(program);
registerGetCommand(program);
registerSetCommand(program);
registerUsersCommand(program);
registerTeamsCommand(program);
registerAdminCommands(program);

const main = async () => {
  try {
    if (process.argv.length <= 2) {
      program.help();
    }
    await program.parseAsync(process.argv);
  } catch (error) {
    handleCommandError(error);
  }
};

const isCliExecution = (() => {
  if (!process.argv[1]) {
    return false;
  }

  try {
    const executed = realpathSync(process.argv[1]);
    const current = realpathSync(fileURLToPath(import.meta.url));
    return executed === current;
  } catch {
    return false;
  }
})();

if (isCliExecution) {
  void main();
}

export { main };
