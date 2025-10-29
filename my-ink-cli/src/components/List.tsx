import React, {useEffect, useState} from 'react';
import {Box, Text, useFocus, useInput} from 'ink';
import type {Key} from 'ink';
import {theme} from '../app/Theme.js';

export interface ListItemRendererProps<T> {
  item: T;
  index: number;
  isHighlighted: boolean;
  isFocused: boolean;
}

export type ListItemRenderer<T> = (props: ListItemRendererProps<T>) => React.ReactNode;

export interface ListProps<T> {
  items: readonly T[];
  renderItem?: ListItemRenderer<T>;
  itemKey?: (item: T, index: number) => string;
  onSubmit?: (item: T, index: number) => void;
  onHighlight?: (item: T, index: number) => void;
  onFocusChange?: (focused: boolean) => void;
  emptyMessage?: string;
  initialIndex?: number;
  loop?: boolean;
  focusId?: string;
  isActive?: boolean;
  maxVisible?: number;
}

const DEFAULT_EMPTY = 'Nothing to show';

export function List<T>({
  items,
  renderItem,
  itemKey,
  onSubmit,
  onHighlight,
  onFocusChange,
  emptyMessage = DEFAULT_EMPTY,
  initialIndex = 0,
  loop = true,
  focusId,
  isActive = true,
  maxVisible
}: ListProps<T>) {
  const [activeIndex, setActiveIndex] = useState(Math.min(initialIndex, Math.max(items.length - 1, 0)));
  const focus = focusId ? useFocus({id: focusId, isActive}) : null;
  const isFocused = focusId ? (focus?.isFocused ?? isActive) : isActive;
  const visibleCount = Math.max(1, Math.min(maxVisible ?? items.length, items.length));
  const maxStart = Math.max(0, items.length - visibleCount);
  const start = Math.min(Math.max(activeIndex - Math.floor(visibleCount / 2), 0), maxStart);
  const end = Math.min(start + visibleCount, items.length);

  useEffect(() => {
    if (onFocusChange) {
      onFocusChange(isFocused);
    }
  }, [isFocused, onFocusChange]);

  useEffect(() => {
    const capped = Math.min(activeIndex, Math.max(items.length - 1, 0));
    if (capped !== activeIndex) {
      setActiveIndex(capped);
      return;
    }
    if (items.length > 0 && onHighlight) {
      onHighlight(items[capped], capped);
    }
  }, [items, activeIndex, onHighlight]);

  useInput((input: string, key: Key) => {
    if (!isFocused || items.length === 0) {
      return;
    }

    if (key.upArrow || input === 'k') {
      setActiveIndex((current) => {
        const next = current <= 0 ? (loop ? items.length - 1 : 0) : current - 1;
        if (onHighlight && items.length > 0) {
          const item = items[next];
          if (item) onHighlight(item, next);
        }
        return next;
      });
      return;
    }

    if (key.downArrow || input === 'j') {
      setActiveIndex((current) => {
        const next = current >= items.length - 1 ? (loop ? 0 : items.length - 1) : current + 1;
        if (onHighlight && items.length > 0) {
          const item = items[next];
          if (item) onHighlight(item, next);
        }
        return next;
      });
      return;
    }

    if (key.pageUp) {
      setActiveIndex((current) => {
        const next = Math.max(current - visibleCount, 0);
        if (onHighlight && items.length > 0) {
          const item = items[next];
          if (item) onHighlight(item, next);
        }
        return next;
      });
      return;
    }

    if (key.pageDown) {
      setActiveIndex((current) => {
        const next = Math.min(current + visibleCount, items.length - 1);
        if (onHighlight && items.length > 0) {
          const item = items[next];
          if (item) onHighlight(item, next);
        }
        return next;
      });
      return;
    }

    if (key.return && onSubmit) {
      const item = items[activeIndex];
      if (item) {
        onSubmit(item, activeIndex);
      }
    }
  });

  useEffect(() => {
    if (onHighlight && items.length > 0) {
      onHighlight(items[activeIndex], activeIndex);
    }
  }, [activeIndex, items, onHighlight]);

  if (items.length === 0) {
    return (
      <Text color={theme.colors.muted}>
        {emptyMessage}
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      {items.slice(start, end).map((item, indexInWindow) => {
        const index = start + indexInWindow;
        const key = itemKey ? itemKey(item, index) : index.toString();
        const isHighlighted = (start + indexInWindow) === activeIndex;
        const prefix = isHighlighted ? theme.focusPrefix : theme.unfocusedPrefix;
        const content = renderItem ? (
          renderItem({item, index, isHighlighted, isFocused})
        ) : (
          <Text color={isHighlighted ? theme.colors.primary : undefined}>{String(item)}</Text>
        );
        return (
          <Box key={key} flexDirection="row">
            <Text color={isHighlighted ? theme.colors.primary : theme.colors.muted}>
              {prefix}{' '}
            </Text>
            {content}
          </Box>
        );
      })}
    </Box>
  );
}

export default List;
