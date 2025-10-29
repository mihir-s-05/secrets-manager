import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import { Badge } from './Badge.js';

export interface ErrorNoticeProps {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryKey?: string;
  compact?: boolean;
  role?: string;
  ariaLabel?: string;
}

export const ErrorNotice: React.FC<ErrorNoticeProps> = ({
  title = 'Something went wrong',
  message,
  detail,
  onRetry,
  retryKey = 'r',
  compact = false,
  role = 'alert',
  ariaLabel,
}) => {
  const normalizedKey = useMemo(() => retryKey.toLowerCase(), [retryKey]);

  useInput((input, key) => {
    if (!onRetry) {
      return;
    }
    if (key.return || key.enter || input.toLowerCase() === normalizedKey) {
      onRetry();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={1}
      paddingY={compact ? 0 : 1}
      role={role}
      aria-label={ariaLabel ?? title}
    >
      <Box flexDirection="row">
        <Badge label="ERROR" variant="danger" padding={0} />
        <Text bold marginLeft={1}>
          {title}
        </Text>
      </Box>
      <Box marginTop={compact ? 0 : 1} flexDirection="column">
        <Text color="red">{message}</Text>
        {detail ? <Text dimColor>{detail}</Text> : null}
        {onRetry ? (
          <Text color="cyan">Press [{normalizedKey.toUpperCase()}] to retry</Text>
        ) : null}
      </Box>
    </Box>
  );
};
