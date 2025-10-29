import React from 'react';
import {Box, Text} from 'ink';
import {theme} from '../app/Theme.js';

export interface ModalProps {
  title?: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({title, width = 60, children, footer}) => (
  <Box flexDirection="column" width="100%" height="100%" alignItems="center" justifyContent="center">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.accent}
      paddingX={2}
      paddingY={1}
      width={width}
    >
      {title ? (
        <Box marginBottom={1}>
          <Text color={theme.colors.accent}>
            {title}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column">{children}</Box>
      {footer ? (
        <Box marginTop={1} borderStyle="single" borderColor={theme.colors.muted} paddingX={1} paddingY={0}>
          {footer}
        </Box>
      ) : null}
    </Box>
  </Box>
);

export default Modal;
