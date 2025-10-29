import React, { useEffect, useState } from 'react';
import type { Command } from 'commander';
import type { AxiosInstance } from 'axios';
import { Box, Text, useApp, useInput } from 'ink';
import clipboardy from 'clipboardy';

import { fetchSecretVersion } from '../services/resources.js';
import { SecretVersion } from '../services/schemas.js';
import { normalizeApiError } from '../services/api.js';
import { useAppStore } from '../services/store.js';
import { BoxedPanel, ErrorNotice, KeyHelp, Spinner } from '../ui/components/index.js';
import { useCompactLayout } from '../ui/hooks/index.js';
import { handleCommandError, renderScreen } from './utils.js';

interface SecretViewerProps {
  apiClient: AxiosInstance;
  keyId: string;
}

type ViewState =
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

const SecretViewer: React.FC<SecretViewerProps> = ({ apiClient, keyId }) => {
  const app = useApp();
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [secret, setSecret] = useState<SecretVersion | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState({ status: 'loading' });
      try {
        const version = await fetchSecretVersion(apiClient, keyId);
        if (cancelled) {
          return;
        }
        setSecret(version);
        setState({ status: 'loaded' });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const apiError = normalizeApiError(error);
        if (apiError.status === 403) {
          setState({ status: 'error', message: "You don't have read access to this secret." });
          process.exitCode = 1;
        } else {
          setState({ status: 'error', message: apiError.message ?? 'Failed to load secret' });
          process.exitCode = 1;
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiClient, keyId, reloadToken]);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') {
      app.exit();
      return;
    }
    if (input.toLowerCase() === 'c' && secret) {
      try {
        clipboardy.writeSync(secret.value ?? '');
        pushToast({ kind: 'success', message: `Copied ${secret.key}`, durationMs: 2000 });
      } catch (error) {
        pushToast({ kind: 'error', message: (error as Error).message ?? 'Failed to copy', durationMs: 2000 });
      }
    }
  });

  if (state.status === 'loading') {
    return (
      <Box padding={1}>
        <Spinner tone="info" label={`Fetching ${keyId}…`} persistLabel />
      </Box>
    );
  }

  if (state.status === 'error') {
    return (
      <Box padding={1}>
        <ErrorNotice message={state.message} onRetry={() => setReloadToken((token) => token + 1)} />
      </Box>
    );
  }

  if (!secret) {
    return (
      <Box padding={1}>
        <Text color="red">Secret not found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <BoxedPanel title={`Secret: ${secret.key}`} width={compact ? 60 : 72}>
        <Box flexDirection="column">
          <Text>{secret.value ?? '[empty]'}</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Version {secret.version ?? '?'} · Updated {secret.updatedAt ?? 'unknown'}
            </Text>
          </Box>
        </Box>
      </BoxedPanel>
      <Box marginTop={1}>
        <KeyHelp
          items={[
            { key: 'c', description: 'Copy value to clipboard' },
            { key: 'q / esc', description: 'Close' },
          ]}
          visible
        />
      </Box>
    </Box>
  );
};

export const registerGetCommand = (program: Command) => {
  program
    .command('get <key>')
    .description('Print a secret value if readable')
    .action(async (key, command) => {
      try {
        await renderScreen(SecretViewer, { keyId: key }, { command });
      } catch (error) {
        handleCommandError(error);
      }
    });
};
