import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';

import { ToastKind, useAppStore } from '../../services/store.js';
import { Badge } from './Badge.js';

export interface ToastsProps {
  maxVisible?: number;
  role?: string;
  ariaLabel?: string;
}

const toneToColor: Record<ToastKind, string> = {
  info: 'cyan',
  success: 'green',
  error: 'red',
};

export const Toasts: React.FC<ToastsProps> = ({ maxVisible = 3, role = 'status', ariaLabel = 'Notifications' }) => {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  const activeToasts = useMemo(() => toasts.slice(-maxVisible), [toasts, maxVisible]);

  useEffect(() => {
    const timers = activeToasts
      .filter((toast) => typeof toast.durationMs === 'number')
      .map((toast) => {
        const elapsed = Date.now() - toast.createdAt;
        const remaining = (toast.durationMs ?? 0) - elapsed;
        if (remaining <= 0) {
          dismissToast(toast.id);
          return null;
        }
        const timer = setTimeout(() => dismissToast(toast.id), remaining);
        return { id: toast.id, timer };
      })
      .filter((entry): entry is { id: string; timer: NodeJS.Timeout } => Boolean(entry));

    return () => {
      timers.forEach(({ timer }) => clearTimeout(timer));
    };
  }, [activeToasts, dismissToast]);

  return (
    <Box flexDirection="column" role={role} aria-label={ariaLabel}>
      <Box flexDirection="column" alignItems="flex-end">
        {activeToasts.map((toast) => (
          <Box
            key={toast.id}
            borderStyle="round"
            borderColor={toneToColor[toast.kind]}
            paddingX={1}
            paddingY={0}
            marginTop={1}
            maxWidth={80}
          >
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Badge label={toast.kind.toUpperCase()} variant={toast.kind === 'error' ? 'danger' : toast.kind} padding={0} />
                <Text marginLeft={1}>{toast.message}</Text>
              </Box>
              {toast.detail ? <Text dimColor>{toast.detail}</Text> : null}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
