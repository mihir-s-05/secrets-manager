import React from 'react';
import type { Command } from 'commander';
import type { AxiosInstance } from 'axios';

import { SecretSummary } from '../services/schemas.js';
import { renderScreen, handleCommandError } from './utils.js';
import { SecretsListScreen } from '../ui/screens/SecretsList.js';
import { SecretEditor } from '../ui/screens/SecretEditor.js';

interface SecretsRouterProps {
  apiClient: AxiosInstance;
}

type ViewState =
  | { mode: 'list' }
  | { mode: 'editor'; secret: SecretSummary | null; isNew: boolean; defaultKey?: string };

const SecretsRouter: React.FC<SecretsRouterProps> = ({ apiClient }) => {
  const [state, setState] = React.useState<ViewState>({ mode: 'list' });

  if (state.mode === 'list') {
    return (
      <SecretsListScreen
        apiClient={apiClient}
        onSelectSecret={(secret) => setState({ mode: 'editor', secret, isNew: false })}
        onCreateSecret={(prefill) => setState({ mode: 'editor', secret: null, isNew: true, defaultKey: prefill })}
        onQuit={() => setState({ mode: 'list' })}
      />
    );
  }

  return (
    <SecretEditor
      apiClient={apiClient}
      secretKey={state.secret?.id ?? state.secret?.key}
      defaultKey={state.isNew ? state.defaultKey : state.secret?.key}
      isNew={state.isNew}
      fallbackToCreate={!state.isNew}
      onClose={() => setState({ mode: 'list' })}
      onSaved={() => setState({ mode: 'list' })}
    />
  );
};

export const registerListCommand = (program: Command) => {
  program
    .command('ls')
    .description('List secrets visible to the current user')
    .action(async (_options, command) => {
      try {
        await renderScreen(SecretsRouter, {}, { command });
      } catch (error) {
        handleCommandError(error);
      }
    });
};
