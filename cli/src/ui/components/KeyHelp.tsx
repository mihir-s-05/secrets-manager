import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

export interface KeyHelpItem {
  key: string;
  description: string;
}

export interface KeyHelpProps {
  items: KeyHelpItem[];
  visible?: boolean;
  title?: string;
  role?: string;
  ariaLabel?: string;
}

const padKey = (value: string, width: number) => {
  const current = stringWidth(value);
  if (current >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - current)}`;
};

export const KeyHelp: React.FC<KeyHelpProps> = ({
  items,
  visible = true,
  title = 'Key bindings',
  role = 'note',
  ariaLabel,
}) => {
  const maxKeyWidth = useMemo(
    () => items.reduce((width, item) => Math.max(width, stringWidth(item.key)), 0),
    [items],
  );

  if (!visible || items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" role={role} aria-label={ariaLabel ?? title}>
      {title ? (
        <Text color="gray" bold>
          {title}
        </Text>
      ) : null}
      {items.map((item) => (
        <Box key={item.key} flexDirection="row">
          <Text color="cyan" inverse>
            {padKey(item.key, maxKeyWidth)}
          </Text>
          <Text color="gray"> · </Text>
          <Text>{item.description}</Text>
        </Box>
      ))}
    </Box>
  );
};
