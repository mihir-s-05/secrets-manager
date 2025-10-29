import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import clipboardy from 'clipboardy';

import { fetchTeams } from '../../services/resources.js';
import { OrgTeam } from '../../services/schemas.js';
import { useAppStore } from '../../services/store.js';
import { ErrorNotice, KeyHelp, Spinner, Table } from '../components/index.js';
import type { TableColumn } from '../components/Table.js';
import { useCompactLayout } from '../hooks/index.js';

export interface TeamsScreenProps {
  apiClient: AxiosInstance;
  onClose?: () => void;
}

interface TableRow {
  id: string;
  name: string;
  members: string;
  description: string;
}

export const TeamsScreen: React.FC<TeamsScreenProps> = ({ apiClient, onClose }) => {
  const app = useApp();
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendStaticLog);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const loadTeams = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const list = await fetchTeams(apiClient);
      setTeams(list);
      setSelectedIndex(0);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return teams;
    }
    return teams.filter((team) => {
      return (
        team.name.toLowerCase().includes(query) ||
        (team.description ?? '').toLowerCase().includes(query) ||
        team.id.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, teams]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered, selectedIndex]);

  const rows = useMemo<TableRow[]>(
    () =>
      filtered.map((team) => ({
        id: team.id,
        name: team.name,
        members: String(team.memberCount ?? 0),
        description: team.description ?? '—',
      })),
    [filtered],
  );

  const columns = useMemo<TableColumn<TableRow>[]>(
    () => [
      { id: 'name', header: 'Team', minWidth: 20 },
      { id: 'members', header: 'Members', width: 10, align: 'right' },
      { id: 'description', header: 'Description', minWidth: 24 },
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
        pushToast({ kind: 'success', message: `Copied team id ${selected.id}`, durationMs: 1500 });
        appendLog({ message: `Copied team id ${selected.id}`, kind: 'info' });
      } catch (error) {
        pushToast({ kind: 'error', message: (error as Error).message ?? 'Failed to copy id', durationMs: 2500 });
      }
    }

    if (input === '?') {
      setShowHelp((value) => !value);
    }
  }, [app, appendLog, filtered, onClose, pushToast, searchMode, selectedIndex]);

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <Text bold>Teams</Text>
      <Text dimColor>
        Showing {filtered.length} of {teams.length}
      </Text>

      {status === 'loading' ? (
        <Box marginTop={1}>
          <Spinner tone="info" label="Loading teams…" persistLabel />
        </Box>
      ) : null}

      {status === 'error' ? (
        <Box marginTop={1}>
          <ErrorNotice message={errorMessage ?? 'Failed to load teams'} onRetry={() => loadTeams()} />
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
            emptyState={<Text color="gray">No teams found.</Text>}
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
            { key: '/', description: 'Search teams' },
            { key: 'c', description: 'Copy team id' },
          { key: '?', description: 'Toggle help overlay' },
            { key: 'q / esc', description: 'Close' },
          ]}
          visible={showHelp}
        />
      </Box>
    </Box>
  );
};
