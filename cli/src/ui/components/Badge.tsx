import React from 'react';
import { Text } from 'ink';

export type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  padding?: number;
  role?: string;
  ariaLabel?: string;
}

const variantStyles: Record<BadgeVariant, { color: string; backgroundColor?: string }> = {
  default: { color: 'white', backgroundColor: undefined },
  info: { color: 'cyan', backgroundColor: undefined },
  success: { color: 'green', backgroundColor: undefined },
  warning: { color: 'yellow', backgroundColor: undefined },
  danger: { color: 'red', backgroundColor: undefined },
};

const clampPadding = (padding?: number) => {
  if (typeof padding !== 'number' || Number.isNaN(padding)) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.floor(padding)));
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'default',
  color,
  backgroundColor,
  bold = true,
  padding = 1,
  role = 'status',
  ariaLabel,
}) => {
  const style = variantStyles[variant] ?? variantStyles.default;
  const pad = clampPadding(padding);
  const spacedLabel = `${' '.repeat(pad)}${label}${' '.repeat(pad)}`;

  return (
    <Text
      color={color ?? style.color}
      backgroundColor={backgroundColor ?? style.backgroundColor}
      bold={bold}
      role={role}
      aria-label={ariaLabel ?? label}
    >
      {spacedLabel}
    </Text>
  );
};
