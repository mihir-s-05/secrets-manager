import React from 'react';
import {Box, Text} from 'ink';
import {theme} from '../app/Theme.js';

export interface KeyLegendItem {
  key: string;
  description: string;
}

export interface KeyLegendProps {
  items: KeyLegendItem[];
  title?: string;
}

export const KeyLegend: React.FC<KeyLegendProps> = ({items, title}) => (
  <Box flexDirection="column">
    {title ? (
      <Text color={theme.colors.accent}>
        {title}
      </Text>
    ) : null}
    <Box flexDirection="column" marginTop={title ? 1 : 0}>
      {items.map(({key, description}) => (
        <Box key={`${key}-${description}`} flexDirection="row">
          <Text color={theme.colors.muted}>
            {key.padEnd(8, ' ')}
          </Text>
          <Text>{description}</Text>
        </Box>
      ))}
    </Box>
  </Box>
);

export default KeyLegend;
