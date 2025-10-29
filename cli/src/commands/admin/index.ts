import type { Command } from 'commander';

import { registerAdminTeamAdd } from './team-add.js';
import { registerAdminTeamAddUser } from './team-add-user.js';
import { registerAdminTeamRemoveUser } from './team-rm-user.js';
import { registerAdminUserAdd } from './user-add.js';
import { registerAdminUserPromote } from './user-promote.js';

export const registerAdminCommands = (program: Command) => {
  const admin = program.command('admin').description('Administrative commands');

  const team = admin.command('team').description('Team administration commands');
  registerAdminTeamAdd(team);
  registerAdminTeamAddUser(team);
  registerAdminTeamRemoveUser(team);

  const user = admin.command('user').description('User administration commands');
  registerAdminUserAdd(user);
  registerAdminUserPromote(user);
};
