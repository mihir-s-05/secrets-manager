import React, {useCallback, useMemo} from 'react';
import {Box, Text, useFocus, useInput} from 'ink';
import {theme} from '../app/Theme.js';

export interface MultiLineInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  focusId?: string;
  label?: string;
  isActive?: boolean;
  maxRows?: number;
}

export const MultiLineInput: React.FC<MultiLineInputProps> = ({
  value,
  onChange,
  placeholder,
  focusId,
  label,
  isActive = true,
  maxRows = 8
}) => {
  const focus = focusId ? useFocus({id: focusId, isActive}) : null;
  const isFocused = focusId ? focus?.isFocused ?? false : false;

  const append = useCallback(
    (text: string) => {
      onChange(`${value}${text}`);
    },
    [onChange, value]
  );

  useInput((input, key) => {
    if (!isFocused) {
      return;
    }

    if (key.tab) {
      return;
    }

    if (key.ctrl && input === 'u') {
      onChange('');
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    if (key.return) {
      append('\n');
      return;
    }

    if (!key.ctrl && !key.meta) {
      append(input);
    }
  });

  const lines = useMemo(() => {
    const allLines = value ? value.split('\n') : [placeholder ?? ''];
    if (allLines.length <= maxRows) {
      return allLines;
    }
    const overflow = allLines.length - maxRows;
    return [`… ${overflow} more line${overflow === 1 ? '' : 's'}`, ...allLines.slice(-maxRows)];
  }, [placeholder, value, maxRows]);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? theme.colors.primary : theme.colors.muted} paddingX={1} paddingY={0}>
      {label ? (
        <Text color={theme.colors.muted}>
          {label}
        </Text>
      ) : null}
      {lines.map((line, index) => (
        <Text key={index} color={!value ? theme.colors.muted : undefined}>
          {line || ' '}
        </Text>
      ))}
      {isFocused ? (
        <Text color={theme.colors.muted}>⎯ Editing (Enter = newline, Ctrl+U = clear)</Text>
      ) : null}
    </Box>
  );
};

export default MultiLineInput;
