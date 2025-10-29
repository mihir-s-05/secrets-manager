import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { AdminActionResult } from '../../services/schemas.js';
import { useAppStore } from '../../services/store.js';
import { BoxedPanel, ErrorNotice, KeyHelp } from '../components/index.js';
import { useCompactLayout } from '../hooks/index.js';

export interface AdminPanelProps {
  title: string;
  actionDescription: string;
  result?: AdminActionResult | null;
  error?: Error | null;
  onRetry?: () => void;
  onClose?: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  title,
  actionDescription,
  result,
  error,
  onRetry,
  onClose,
}) => {
  const app = useApp();
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendStaticLog);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') {
      onClose?.();
      app.exit();
      return;
    }
    if (input === 'r' && onRetry) {
      onRetry();
    }
  });

  React.useEffect(() => {
    if (result) {
      const message = result.message ?? 'Action completed';
      pushToast({ kind: 'success', message, durationMs: 2500, persistent: true });
      appendLog({ message, kind: 'success' });
    }
    if (error) {
      pushToast({ kind: 'error', message: error.message ?? 'Action failed', durationMs: 3500, persistent: true });
      appendLog({ message: error.message ?? 'Action failed', kind: 'error' });
    }
  }, [appendLog, error, pushToast, result]);

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <BoxedPanel title={title} width={compact ? 60 : 72}>
        <Text>{actionDescription}</Text>
        {result?.status ? (
          <Box marginTop={1}>
            <Text color="green">Status: {result.status}</Text>
          </Box>
        ) : null}
        {result?.message ? (
          <Box>
            <Text dimColor>{result.message}</Text>
          </Box>
        ) : null}
      </BoxedPanel>

      {error ? (
        <Box marginTop={1}>
          <ErrorNotice message={error.message ?? 'Admin action failed'} onRetry={onRetry} />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <KeyHelp
          items={[
            { key: 'q / esc', description: 'Close' },
            ...(onRetry ? [{ key: 'r', description: 'Retry action' }] : []),
          ]}
          visible
        />
      </Box>
    </Box>
  );
};
