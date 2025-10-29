import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { fetchSecrets } from '../../services/resources.js';
import { SecretSummary } from '../../services/schemas.js';
import { useAppStore } from '../../services/store.js';
import { BoxedPanel, ErrorNotice, KeyHelp, Spinner, Table } from '../components/index.js';
import type { TableColumn } from '../components/Table.js';
import { useCompactLayout } from '../hooks/index.js';

const FILTERS = ['all', 'read', 'write'] as const;
type FilterMode = (typeof FILTERS)[number];

const formatTimestamp = (input?: string) => {
  if (!input) {
    return '—';
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleString();
};

const formatPermissions = (secret: SecretSummary) => {
  const perms = secret.permissions ?? {};
  if (perms.admin) {
    return 'ADMIN';
  }
  if (perms.write) {
    return perms.read ? 'RW' : 'W';
  }
  if (perms.read) {
    return 'R';
  }
  return '—';
};

const matchesFilter = (secret: SecretSummary, filter: FilterMode) => {
  const perms = secret.permissions ?? {};
  if (filter === 'read') {
    return Boolean(perms.read || perms.write || perms.admin);
  }
  if (filter === 'write') {
    return Boolean(perms.write || perms.admin);
  }
  return true;
};

export interface SecretsListScreenProps {
  apiClient: AxiosInstance;
  heading?: string;
  onSelectSecret?: (secret: SecretSummary) => void;
  onCreateSecret?: (prefillKey?: string) => void;
  onQuit?: () => void;
}

interface TableRow {
  key: string;
  version: string;
  updated: string;
  perm: string;
}

export const SecretsListScreen: React.FC<SecretsListScreenProps> = ({
  apiClient,
  heading = 'Secrets',
  onSelectSecret,
  onCreateSecret,
  onQuit,
}) => {
  const app = useApp();
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);

  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const loadSecrets = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const list = await fetchSecrets(apiClient);
      setSecrets(list);
      setStatus('ready');
      setSelectedIndex(0);
    } catch (error) {
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return secrets
      .filter((secret) => matchesFilter(secret, filter))
      .filter((secret) => {
        if (!query) {
          return true;
        }
        return secret.key.toLowerCase().includes(query);
      });
  }, [filter, searchQuery, secrets]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length - 1);
    }
  }, [filtered, selectedIndex]);

  const selectedSecret = filtered[selectedIndex] ?? null;

  const columns = useMemo<TableColumn<TableRow>[]>(
    () => [
      { id: 'key', header: 'Key', minWidth: 24 },
      { id: 'version', header: 'Ver', width: 5, align: 'right' },
      { id: 'updated', header: 'Updated', minWidth: 20 },
      { id: 'perm', header: 'Perm', width: 8 },
    ],
    [],
  );

  const rows = useMemo<TableRow[]>(
    () =>
      filtered.map((secret) => ({
        key: secret.key,
        version: String(secret.version ?? ''),
        updated: formatTimestamp(secret.updatedAt),
        perm: formatPermissions(secret),
      })),
    [filtered],
  );

  const toolbar = useMemo(
    () => (
      <Text>
        <Text color="cyan">[/]</Text> Search{'   '}
        <Text color="cyan">[f]</Text> Filter{'   '}
        <Text color="cyan">[enter]</Text> View{'   '}
        <Text color="cyan">[a]</Text> Add{'   '}
        <Text color="cyan">[?]</Text> Help
      </Text>
    ),
    [],
  );

  const helpItems = useMemo(
    () => [
      { key: '↑ / ↓', description: 'Move selection' },
      { key: 'enter', description: 'View secret details' },
      { key: '/', description: 'Search by key' },
      { key: 'f', description: 'Toggle permission filter' },
      { key: 'a', description: 'Create a new secret' },
      { key: '?', description: 'Toggle help overlay' },
      { key: 'q / esc', description: 'Close list' },
    ],
    [],
  );

  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
      }
      if (key.return) {
        setSearchMode(false);
      }
      return;
    }

    if (key.escape || input.toLowerCase() === 'q') {
      onQuit?.();
      app.exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => Math.min(filtered.length - 1, current + 1));
      return;
    }

    if (key.return) {
      if (selectedSecret && onSelectSecret) {
        onSelectSecret(selectedSecret);
      }
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      return;
    }

    if (input.toLowerCase() === 'f') {
      const nextIndex = (FILTERS.indexOf(filter) + 1) % FILTERS.length;
      setFilter(FILTERS[nextIndex]);
      pushToast({
        kind: 'info',
        message: `Filter: ${FILTERS[nextIndex]}`,
        durationMs: 1500,
      });
      return;
    }

    if (input.toLowerCase() === 'a') {
      if (onCreateSecret) {
        const prefill = searchQuery.trim();
        onCreateSecret(prefill.length > 0 ? prefill : undefined);
      }
      return;
    }

    if (input === '?') {
      setShowHelp((value) => !value);
    }
  }, [app, filter, filtered.length, onCreateSecret, onQuit, onSelectSecret, pushToast, searchMode, selectedSecret]);

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <Box alignItems="center" justifyContent="space-between">
        <Text bold>{heading}</Text>
        <Text dimColor>
          Showing {filtered.length} of {secrets.length}
        </Text>
      </Box>

      <Box marginTop={1}>{toolbar}</Box>

      {status === 'loading' ? (
        <Box marginTop={1}>
          <Spinner label="Loading secrets…" tone="info" persistLabel />
        </Box>
      ) : null}

      {status === 'error' ? (
        <Box marginTop={1}>
          <ErrorNotice message={errorMessage ?? 'Failed to load secrets'} onRetry={() => loadSecrets()} />
        </Box>
      ) : null}

      {status === 'ready' ? (
        <Box marginTop={1}>
          <Table
            columns={columns}
            data={rows}
            selectedIndex={selectedIndex}
            highlightColor="cyan"
            getRowId={(row) => row.key}
            emptyState={<Text color="gray">No secrets found.</Text>}
          />
        </Box>
      ) : null}

      {searchMode ? (
        <Box marginTop={1} flexDirection="row">
          <Text color="gray">Search:</Text>
          <Box marginLeft={1}>
            <TextInput value={searchQuery} onChange={setSearchQuery} onSubmit={() => setSearchMode(false)} />
          </Box>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <KeyHelp items={helpItems} visible={showHelp} />
      </Box>
    </Box>
  );
};
