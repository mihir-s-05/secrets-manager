import React, { PropsWithChildren, useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

export interface BoxedPanelProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  width?: number;
  borderColor?: string;
  titleColor?: string;
  ariaLabel?: string;
  role?: string;
}

const clampWidth = (width?: number) => {
  if (!width || Number.isNaN(width)) {
    return 72;
  }
  return Math.min(100, Math.max(20, Math.floor(width)));
};

const fitContentWidth = (width: number, ...lines: (string | undefined)[]) => {
  return lines.reduce((acc, line) => {
    if (!line) {
      return acc;
    }
    return Math.max(acc, stringWidth(line) + 4);
  }, width);
};

const padLine = (value: string, width: number, align: 'left' | 'center' | 'right' = 'left') => {
  const ellipsis = '…';
  let text = value;
  if (stringWidth(value) > width) {
    let sliced = '';
    for (const char of value) {
      if (stringWidth(sliced + char) >= width) {
        break;
      }
      sliced += char;
    }
    text = `${sliced.slice(0, Math.max(0, sliced.length - 1))}${ellipsis}`;
  }

  const gap = width - stringWidth(text);
  if (gap <= 0) {
    return text;
  }

  if (align === 'center') {
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
  }

  if (align === 'right') {
    return `${' '.repeat(gap)}${text}`;
  }

  return `${text}${' '.repeat(gap)}`;
};

export const BoxedPanel: React.FC<BoxedPanelProps> = ({
  title,
  subtitle,
  width,
  borderColor = 'cyan',
  titleColor = 'white',
  ariaLabel,
  role = 'region',
  children,
}) => {
  const frameWidth = useMemo(() => {
    const base = clampWidth(width);
    return fitContentWidth(base, title, subtitle);
  }, [width, title, subtitle]);

  const borderSegmentLength = Math.max(0, frameWidth - 2);
  const contentWidth = Math.max(0, frameWidth - 4);

  const headerLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    if (title) {
      lines.push(
        <Box key="title">
          <Text color={borderColor}>│ </Text>
          <Text color={titleColor} bold>
            {padLine(title, contentWidth, 'center')}
          </Text>
          <Text color={borderColor}> │</Text>
        </Box>,
      );
    }
    if (subtitle) {
      lines.push(
        <Box key="subtitle">
          <Text color={borderColor}>│ </Text>
          <Text color="gray">
            {padLine(subtitle, contentWidth, 'center')}
          </Text>
          <Text color={borderColor}> │</Text>
        </Box>,
      );
    }
    return lines;
  }, [title, subtitle, borderColor, titleColor, contentWidth]);

  return (
    <Box flexDirection="column" role={role} aria-label={ariaLabel}>
      <Text color={borderColor}>{`┌${'─'.repeat(borderSegmentLength)}┐`}</Text>
      {headerLines}
      <Box>
        <Text color={borderColor}>│ </Text>
        <Box width={contentWidth > 0 ? contentWidth : undefined} flexDirection="column">
          {children}
        </Box>
        <Text color={borderColor}> │</Text>
      </Box>
      <Text color={borderColor}>{`└${'─'.repeat(borderSegmentLength)}┘`}</Text>
    </Box>
  );
};
