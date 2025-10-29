import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

export type TableAlign = 'left' | 'center' | 'right';

export interface TableColumn<T> {
  id: string;
  header: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: TableAlign;
  placeholder?: string;
  getValue?: (row: T, index: number) => unknown;
  format?: (value: unknown, row: T, index: number) => string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  selectedIndex?: number;
  compact?: boolean;
  showHeader?: boolean;
  role?: string;
  ariaLabel?: string;
  highlightColor?: string;
  getRowId?: (row: T, index: number) => string;
  emptyState?: React.ReactNode;
}

const clampWidth = (value: number, min = 4, max = 60) => {
  return Math.max(min, Math.min(max, Math.floor(value)));
};

const resolveValue = <T,>(row: T, index: number, column: TableColumn<T>): string => {
  const raw = column.getValue ? column.getValue(row, index) : (row as Record<string, unknown>)[column.id];
  const formatted = column.format ? column.format(raw, row, index) : raw;
  if (formatted === undefined || formatted === null) {
    return column.placeholder ?? '';
  }
  if (typeof formatted === 'string') {
    return formatted;
  }
  return String(formatted);
};

const truncate = (value: string, width: number): string => {
  if (width <= 0) {
    return '';
  }

  if (stringWidth(value) <= width) {
    return value;
  }

  const ellipsis = '…';
  let output = '';
  for (const char of value) {
    if (stringWidth(output + char + ellipsis) > width) {
      break;
    }
    output += char;
  }
  return `${output}${ellipsis}`;
};

const pad = (value: string, width: number, align: TableAlign) => {
  const truncated = truncate(value, width);
  const gap = width - stringWidth(truncated);
  if (gap <= 0) {
    return truncated;
  }

  if (align === 'right') {
    return `${' '.repeat(gap)}${truncated}`;
  }

  if (align === 'center') {
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return `${' '.repeat(left)}${truncated}${' '.repeat(right)}`;
  }

  return `${truncated}${' '.repeat(gap)}`;
};

const computeColumnWidths = <T,>(columns: TableColumn<T>[], data: T[], sampleSize = 25) => {
  const sample = data.slice(0, sampleSize);
  return columns.map((column) => {
    if (column.width) {
      return clampWidth(column.width, column.minWidth ?? 4, column.maxWidth ?? 60);
    }
    const headerWidth = stringWidth(column.header);
    const measured = sample.reduce((acc, row, index) => {
      const value = resolveValue(row, index, column);
      return Math.max(acc, stringWidth(value));
    }, headerWidth);

    const min = column.minWidth ?? Math.min(16, measured);
    const max = column.maxWidth ?? 40;
    return clampWidth(Math.max(measured, min), min, max);
  });
};

export const Table = <T,>({
  columns,
  data,
  selectedIndex,
  compact = false,
  showHeader = true,
  role = 'table',
  ariaLabel,
  highlightColor,
  getRowId,
  emptyState,
}: TableProps<T>) => {
  const widths = useMemo(() => computeColumnWidths(columns, data), [columns, data]);
  const spacer = compact ? ' ' : '  ';

  const headerLine = useMemo(() => {
    if (!showHeader) {
      return null;
    }
    const content = columns
      .map((column, index) => pad(column.header, widths[index], column.align ?? 'left'))
      .join(spacer);
    return (
      <Text key="header" role="row" bold color="gray">
        {content}
      </Text>
    );
  }, [columns, showHeader, spacer, widths]);

  if (!data.length) {
    return (
      <Box flexDirection="column" role={role} aria-label={ariaLabel}>
        {headerLine}
        {emptyState ?? <Text color="gray">No records found.</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" role={role} aria-label={ariaLabel}>
      {headerLine}
      {data.map((row, index) => {
        const key = getRowId ? getRowId(row, index) : `${index}`;
        const isSelected = index === selectedIndex;
        const content = columns
          .map((column, columnIndex) => pad(resolveValue(row, index, column), widths[columnIndex], column.align ?? 'left'))
          .join(spacer);

        return (
          <Text
            key={key}
            role="row"
            aria-selected={isSelected ? true : undefined}
            inverse={isSelected && !highlightColor}
            backgroundColor={isSelected && highlightColor ? highlightColor : undefined}
            color={isSelected && highlightColor ? 'black' : undefined}
          >
            {content}
          </Text>
        );
      })}
    </Box>
  );
};
