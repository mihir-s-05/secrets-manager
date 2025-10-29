import React from 'react';
import InkSpinner from 'ink-spinner';
import {Text} from 'ink';
import {theme} from '../app/Theme.js';

export interface SpinnerProps {
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({label}) => (
  <Text color={theme.colors.accent}>
    <InkSpinner type="dots" /> {label}
  </Text>
);

export default Spinner;
