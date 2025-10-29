import React from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import InkSpinner from 'ink-spinner';

export type SpinnerTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface SpinnerProps {
  label?: string;
  tone?: SpinnerTone;
  persistLabel?: boolean;
  role?: string;
  ariaLabel?: string;
}

const toneColor: Record<SpinnerTone, string | undefined> = {
  default: undefined,
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
};

export const Spinner: React.FC<SpinnerProps> = ({
  label,
  tone = 'default',
  persistLabel = false,
  role = 'status',
  ariaLabel,
}) => {
  const screenReader = useIsScreenReaderEnabled?.() ?? false;
  const color = toneColor[tone];

  return (
    <Box flexDirection="row" role={role} aria-label={ariaLabel ?? label}>
      {!screenReader && (
        <Text color={color} role="presentation">
          <InkSpinner type="dots" />
          {label ? ' ' : ''}
        </Text>
      )}
      {(label || persistLabel) && (
        <Text color={color}>{label ?? ''}</Text>
      )}
    </Box>
  );
};
