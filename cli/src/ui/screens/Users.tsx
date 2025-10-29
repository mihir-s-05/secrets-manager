import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import clipboardy from 'clipboardy';

import { fetchUsers } from '../../services/resources.js';
import { OrgUser } from '../../services/schemas.js';
import { useAppStore } from '../../services/store.js';
import { ErrorNotice, KeyHelp, Spinner, Table } from '../components/index.js';
import type { TableColumn } from '../components/Table.js';
import { useCompactLayout } from '../hooks/index.js';

export interface UsersScreenProps {
  apiClient: AxiosInstance;
  onClose?: () => void;
}

interface TableRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

const formatRole = (user: OrgUser) => {
  if (user.isAdmin) {
    return 'Admin';
  }
  return 'Member';
};

export const UsersScreen: React.FC<UsersScreenProps> = ({ apiClient, onClose }) => {
  const app = useApp();
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);
  const setStaticLog = useAppStore((state) => state.appendStaticLog);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const loadUsers = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const list = await fetchUsers(apiClient);
      setUsers(list);
      setSelectedIndex(0);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((user) => {
      return (
        user.email.toLowerCase().includes(query) ||
        (user.name ?? '').toLowerCase().includes(query) ||
        user.id.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, users]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered, selectedIndex]);

  const rows = useMemo<TableRow[]>(
    () =>
      filtered.map((user) => ({
        id: user.id,
        name: user.name ?? '—',
        email: user.email,
        role: formatRole(user),
      })),
    [filtered],
  );

  const columns = useMemo<TableColumn<TableRow>[]>(
    () => [
      { id: 'name', header: 'Name', minWidth: 18 },
      { id: 'email', header: 'Email', minWidth: 24 },
      { id: 'role', header: 'Role', width: 10 },
    ],
    [],
  );

  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
        return;
      }
      if (key.return) {
        setSearchMode(false);
        return;
      }
      return;
    }

    if (key.escape || input.toLowerCase() === 'q') {
      onClose?.();
      app.exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(filtered.length - 1, index + 1));
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      return;
    }

    if (input.toLowerCase() === 'c') {
      const selected = filtered[selectedIndex];
      if (!selected) {
        return;
      }
      try {
        clipboardy.writeSync(selected.id);
        pushToast({ kind: 'success', message: `Copied user id ${selected.id}`, durationMs: 1500 });
        setStaticLog({ message: `Copied user id ${selected.id}`, kind: 'info' });
      } catch (error) {
        pushToast({ kind: 'error', message: (error as Error).message ?? 'Failed to copy id', durationMs: 2500 });
      }
      return;
    }

    if (input === '?') {
      setShowHelp((value) => !value);
    }
  }, [app, filtered, onClose, pushToast, searchMode, selectedIndex, setStaticLog]);

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <Text bold>Organization Users</Text>
      <Text dimColor>
        Showing {filtered.length} of {users.length}
      </Text>

      {status === 'loading' ? (
        <Box marginTop={1}>
          <Spinner tone="info" label="Loading users…" persistLabel />
        </Box>
      ) : null}

      {status === 'error' ? (
        <Box marginTop={1}>
          <ErrorNotice message={errorMessage ?? 'Failed to load users'} onRetry={() => loadUsers()} />
        </Box>
      ) : null}

      {status === 'ready' ? (
        <Box marginTop={1}>
          <Table
            columns={columns}
            data={rows}
            selectedIndex={selectedIndex}
            getRowId={(row) => row.id}
            highlightColor="cyan"
            emptyState={<Text color="gray">No users found.</Text>}
          />
        </Box>
      ) : null}

      {searchMode ? (
        <Box marginTop={1}>
          <Text color="gray">Search:</Text>
          <Box marginLeft={1}>
            <TextInput value={searchQuery} onChange={setSearchQuery} onSubmit={() => setSearchMode(false)} />
          </Box>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <KeyHelp
          items={[
            { key: '↑ / ↓', description: 'Move selection' },
            { key: '/', description: 'Search users' },
            { key: 'c', description: 'Copy user id' },
          { key: '?', description: 'Toggle help overlay' },
            { key: 'q / esc', description: 'Close' },
          ]}
          visible={showHelp}
        />
      </Box>
    </Box>
  );
};
