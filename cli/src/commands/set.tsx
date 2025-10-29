import React from 'react';
import type { Command } from 'commander';
import type { AxiosInstance } from 'axios';
import { useApp } from 'ink';

import { SecretEditor } from '../ui/screens/SecretEditor.js';
import { handleCommandError, renderScreen } from './utils.js';

interface SecretSetScreenProps {
  apiClient: AxiosInstance;
  keyId: string;
}

const SecretSetScreen: React.FC<SecretSetScreenProps> = ({ apiClient, keyId }) => {
  const app = useApp();
  return (
    <SecretEditor
      apiClient={apiClient}
      secretKey={keyId}
      defaultKey={keyId}
      fallbackToCreate
      onClose={() => app.exit()}
      onSaved={() => app.exit()}
    />
  );
};

export const registerSetCommand = (program: Command) => {
  program
    .command('set <key>')
    .description('Open editor UI to create or update a secret value and ACLs')
    .action(async (key, command) => {
      try {
        await renderScreen(SecretSetScreen, { keyId: key }, { command });
      } catch (error) {
        handleCommandError(error);
      }
    });
};
