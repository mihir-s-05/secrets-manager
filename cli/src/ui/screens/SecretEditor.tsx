import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import stringWidth from 'string-width';

import {
  createSecret,
  fetchSecretVersion,
  fetchTeams,
  fetchUsers,
  updateSecret,
} from '../../services/resources.js';
import { OrgTeam, OrgUser, SecretVersion } from '../../services/schemas.js';
import { normalizeApiError } from '../../services/api.js';
import { useAppStore } from '../../services/store.js';
import { BoxedPanel, ErrorNotice, KeyHelp, Spinner } from '../components/index.js';
import { useCompactLayout } from '../hooks/index.js';

interface AccessEntry {
  id: string;
  label: string;
  read: boolean;
  write: boolean;
  description?: string;
}

interface SecretEditorProps {
  apiClient: AxiosInstance;
  secretKey?: string;
  defaultKey?: string;
  isNew?: boolean;
  fallbackToCreate?: boolean;
  onClose?: () => void;
  onSaved?: (secret: SecretVersion) => void;
}

type ActiveSection = 'key' | 'value' | 'sharing';
type SharingTab = 'org' | 'teams' | 'users';

type EditorStatus = 'loading' | 'ready' | 'saving' | 'error';

const TAB_ORDER: SharingTab[] = ['org', 'teams', 'users'];

const cycleAccess = (entry: AccessEntry) => {
  if (!entry.read && !entry.write) {
    return { read: true, write: false };
  }
  if (entry.read && !entry.write) {
    return { read: true, write: true };
  }
  return { read: false, write: false };
};

const describeAccess = (entry: Pick<AccessEntry, 'read' | 'write'>) => {
  if (entry.read && entry.write) {
    return 'RW';
  }
  if (entry.write) {
    return 'W';
  }
  if (entry.read) {
    return 'R';
  }
  return '—';
};

const clampPanelWidth = (width?: number) => {
  if (!width || Number.isNaN(width)) {
    return 72;
  }
  return Math.min(100, Math.max(20, Math.floor(width)));
};

const getValuePanelWidth = (compact: boolean) => clampPanelWidth(compact ? 60 : 68);

const getValueContentWidth = (panelWidth: number) => Math.max(0, panelWidth - 4);

const getVisibleValueRows = (compact: boolean) => (compact ? 8 : 12);

const splitLineIntoRows = (line: string, maxWidth: number): string[] => {
  if (maxWidth <= 0) {
    return [''];
  }
  if (line === '') {
    return [''];
  }

  const rows: string[] = [];
  let current = '';
  for (const char of line) {
    const next = `${current}${char}`;
    if (stringWidth(next) > maxWidth) {
      if (current) {
        rows.push(current);
        current = char;
      } else {
        rows.push(char);
        current = '';
      }
    } else {
      current = next;
    }
  }

  if (current) {
    rows.push(current);
  }

  return rows.length > 0 ? rows : [''];
};

const splitValueIntoRows = (text: string, maxWidth: number): string[] => {
  if (!text) {
    return [''];
  }

  const lines = text.split('\n');
  const rows = lines.flatMap((line) => {
    const segments = splitLineIntoRows(line, maxWidth);
    return segments.length > 0 ? segments : [''];
  });

  return rows.length > 0 ? rows : [''];
};

export const SecretEditor: React.FC<SecretEditorProps> = ({
  apiClient,
  secretKey,
  defaultKey,
  isNew = false,
  fallbackToCreate = false,
  onClose,
  onSaved,
}) => {
  const compact = useCompactLayout();
  const pushToast = useAppStore((state) => state.pushToast);
  const directoryCache = useAppStore((state) => state.directoryCache);
  const updateDirectoryCache = useAppStore((state) => state.updateDirectoryCache);

  const [status, setStatus] = useState<EditorStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState<SecretVersion | null>(null);
  const [value, setValue] = useState('');
  const [orgAccess, setOrgAccess] = useState({ read: true, write: false });
  const [teamEntries, setTeamEntries] = useState<AccessEntry[]>([]);
  const [userEntries, setUserEntries] = useState<AccessEntry[]>([]);
  const [creating, setCreating] = useState(isNew);
  const [activeSection, setActiveSection] = useState<ActiveSection>(creating ? 'key' : 'value');
  const [activeTab, setActiveTab] = useState<SharingTab>('org');
  const [orgFocus, setOrgFocus] = useState<'read' | 'write'>('read');
  const [teamIndex, setTeamIndex] = useState(0);
  const [userIndex, setUserIndex] = useState(0);
  const [teamSearch, setTeamSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [teamSearchMode, setTeamSearchMode] = useState(false);
  const [userSearchMode, setUserSearchMode] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [keyName, setKeyName] = useState(defaultKey ?? secretKey ?? '');
  const previousCreatingRef = useRef(creating);

  useEffect(() => {
    const previous = previousCreatingRef.current;
    if (creating && !previous) {
      setActiveSection('key');
    }
    if (!creating && previous && activeSection === 'key') {
      setActiveSection('value');
    }
    previousCreatingRef.current = creating;
  }, [creating, activeSection]);

  const loadDirectoryTeams = useCallback(async () => {
    if (directoryCache.teams) {
      return directoryCache.teams.data as OrgTeam[];
    }
    const data = await fetchTeams(apiClient);
    updateDirectoryCache('teams', data);
    return data;
  }, [apiClient, directoryCache.teams, updateDirectoryCache]);

  const loadDirectoryUsers = useCallback(async () => {
    if (directoryCache.users) {
      return directoryCache.users.data as OrgUser[];
    }
    const data = await fetchUsers(apiClient);
    updateDirectoryCache('users', data);
    return data;
  }, [apiClient, directoryCache.users, updateDirectoryCache]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      setStatus('loading');
      setErrorMessage(null);
      try {
        const [teams, users] = await Promise.all([loadDirectoryTeams(), loadDirectoryUsers()]);
        if (cancelled) {
          return;
        }

        if (creating) {
          setSecret(null);
          setValue('');
          setOrgAccess({ read: true, write: false });
          setTeamEntries(
            teams.map((team) => ({
              id: team.id,
              label: team.name,
              read: false,
              write: false,
              description: `${team.memberCount ?? 0} member${(team.memberCount ?? 0) === 1 ? '' : 's'}`,
            })),
          );
          setUserEntries(
            users.map((user) => ({
              id: user.id,
              label: user.name ?? user.email,
              description: user.email,
              read: false,
              write: false,
            })),
          );
          setKeyName((current) => current || defaultKey || secretKey || '');
          setStatus('ready');
          setReadOnly(false);
          return;
        }

        if (!secretKey) {
          throw new Error('No secret key provided');
        }

        const existing = await fetchSecretVersion(apiClient, secretKey);
        if (cancelled) {
          return;
        }

        setSecret(existing);
        setValue(existing.value ?? '');
        setKeyName(existing.key);
        const acl = existing.acl;
        setOrgAccess({
          read: acl?.org?.read ?? true,
          write: acl?.org?.write ?? false,
        });
        setTeamEntries(
          teams.map((team) => {
            const entry = acl?.teams?.find((item) => item.id === team.id);
            return {
              id: team.id,
              label: team.name,
              description: `${team.memberCount ?? 0} member${(team.memberCount ?? 0) === 1 ? '' : 's'}`,
              read: Boolean(entry?.read),
              write: Boolean(entry?.write),
            };
          }),
        );
        setUserEntries(
          users.map((user) => {
            const entry = acl?.users?.find((item) => item.id === user.id);
            return {
              id: user.id,
              label: user.name ?? user.email,
              description: user.email,
              read: Boolean(entry?.read),
              write: Boolean(entry?.write),
            };
          }),
        );
        setReadOnly(!(existing.permissions?.write || existing.permissions?.admin));
        setStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        const apiError = normalizeApiError(error);
        if (apiError.status === 404 && fallbackToCreate) {
          setCreating(true);
          setKeyName(defaultKey ?? secretKey ?? '');
          setStatus('loading');
          setReloadKey((key) => key + 1);
          return;
        }
        setErrorMessage(apiError.message ?? 'Failed to load secret');
        setStatus('error');
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [apiClient, creating, defaultKey, loadDirectoryTeams, loadDirectoryUsers, reloadKey, secretKey]);

  const teamFiltered = useMemo(() => {
    const query = teamSearch.trim().toLowerCase();
    if (!query) {
      return teamEntries;
    }
    return teamEntries.filter((entry) => entry.label.toLowerCase().includes(query));
  }, [teamEntries, teamSearch]);

  const userFiltered = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) {
      return userEntries;
    }
    return userEntries.filter((entry) => {
      return entry.label.toLowerCase().includes(query) || (entry.description ?? '').toLowerCase().includes(query);
    });
  }, [userEntries, userSearch]);

  useEffect(() => {
    if (teamIndex >= teamFiltered.length) {
      setTeamIndex(Math.max(0, teamFiltered.length - 1));
    }
  }, [teamFiltered, teamIndex]);

  useEffect(() => {
    if (userIndex >= userFiltered.length) {
      setUserIndex(Math.max(0, userFiltered.length - 1));
    }
  }, [userFiltered, userIndex]);

  const valuePanelWidth = useMemo(() => getValuePanelWidth(compact), [compact]);

  const hasWriter = useMemo(() => {
    if (orgAccess.write) {
      return true;
    }
    if (teamEntries.some((entry) => entry.write)) {
      return true;
    }
    if (userEntries.some((entry) => entry.write)) {
      return true;
    }
    return false;
  }, [orgAccess.write, teamEntries, userEntries]);

  const buildAclPayload = () => ({
    org: orgAccess,
    teams: teamEntries.filter((entry) => entry.read || entry.write).map(({ id, read, write }) => ({ id, read, write })),
    users: userEntries.filter((entry) => entry.read || entry.write).map(({ id, read, write }) => ({ id, read, write })),
  });

  const handleRetry = () => {
    setReloadKey((key) => key + 1);
    setStatus('loading');
  };

  const handleSave = useCallback(async () => {
    if (readOnly) {
      return;
    }
    if (!hasWriter) {
      setValidationError('Assign write access to at least one entity before saving.');
      return;
    }
    if (creating && !keyName.trim()) {
      setValidationError('Provide a secret key before saving.');
      return;
    }
    setValidationError(null);
    setStatus('saving');
    try {
      const payload = buildAclPayload();
      let result: SecretVersion;
      if (creating) {
        const key = keyName.trim();
        result = await createSecret(apiClient, { key, value, acl: payload });
      } else {
        const id = secret?.id ?? secretKey;
        if (!id) {
          throw new Error('Secret identifier missing');
        }
        result = await updateSecret(apiClient, { id, value, acl: payload });
      }
      pushToast({
        kind: 'success',
        message: creating ? `Created secret ${result.key}` : `Updated secret ${result.key}`,
        durationMs: 2500,
        persistent: true,
      });
      onSaved?.(result);
      onClose?.();
    } catch (error) {
      const apiError = normalizeApiError(error);
      setErrorMessage(apiError.message ?? 'Failed to save secret');
      setStatus('error');
    }
  }, [apiClient, buildAclPayload, creating, hasWriter, keyName, onClose, onSaved, pushToast, readOnly, secret?.id, secretKey, value]);

  useInput((input, key) => {
    if (key.escape) {
      onClose?.();
      return;
    }

    if (status !== 'ready') {
      return;
    }

    if (input === '?') {
      setShowHelp((value) => !value);
      return;
    }

    if (key.ctrl && input.toLowerCase() === 's') {
      void handleSave();
      return;
    }

    if (key.tab) {
      const order: ActiveSection[] = creating ? ['key', 'value', 'sharing'] : ['value', 'sharing'];
      const currentIndex = order.indexOf(activeSection);
      const nextIndex = (currentIndex + 1) % order.length;
      setActiveSection(order[nextIndex]);
      return;
    }

    if (activeSection === 'key') {
      return;
    }

    if (activeSection === 'value') {
      if (readOnly) {
        return;
      }

      if (key.backspace || key.delete) {
        if (value.length === 0) {
          return;
        }
        setValue(value.slice(0, -1));
        return;
      }

      if (key.return) {
        setValue(`${value}\n`);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        setValue(`${value}${input}`);
      }
      return;
    }

    if (activeSection === 'sharing') {
      if (key.leftArrow) {
        const currentIndex = TAB_ORDER.indexOf(activeTab);
        const nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        const nextTab = TAB_ORDER[nextIndex];
        setActiveTab(nextTab);
        setTeamSearchMode(false);
        setUserSearchMode(false);
        return;
      }

      if (key.rightArrow) {
        const currentIndex = TAB_ORDER.indexOf(activeTab);
        const nextIndex = (currentIndex + 1) % TAB_ORDER.length;
        const nextTab = TAB_ORDER[nextIndex];
        setActiveTab(nextTab);
        setTeamSearchMode(false);
        setUserSearchMode(false);
        return;
      }

      if (activeTab === 'org') {
        if (key.upArrow || key.downArrow) {
          setOrgFocus((focus) => (focus === 'read' ? 'write' : 'read'));
          return;
        }
        if (input === ' ') {
          if (orgFocus === 'read') {
            setOrgAccess((access) => ({ ...access, read: !access.read }));
          } else {
            setOrgAccess((access) => ({ ...access, write: !access.write }));
          }
        }
        return;
      }

      if (activeTab === 'teams') {
        if (teamSearchMode) {
          if (key.escape) {
            setTeamSearchMode(false);
            setTeamSearch('');
          }
          if (key.return) {
            setTeamSearchMode(false);
          }
          return;
        }
        if (input === '/') {
          setTeamSearchMode(true);
          return;
        }
        if (key.upArrow) {
          setTeamIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          setTeamIndex((index) => Math.min(teamFiltered.length - 1, index + 1));
          return;
        }
        if (input === ' ') {
          if (teamFiltered.length === 0) {
            return;
          }
          setTeamEntries((entries) =>
            entries.map((entry) => {
              if (entry.id !== teamFiltered[teamIndex]?.id) {
                return entry;
              }
              const next = cycleAccess(entry);
              return { ...entry, ...next };
            }),
          );
        }
        return;
      }

      if (activeTab === 'users') {
        if (userSearchMode) {
          if (key.escape) {
            setUserSearchMode(false);
            setUserSearch('');
          }
          if (key.return) {
            setUserSearchMode(false);
          }
          return;
        }
        if (input === '/') {
          setUserSearchMode(true);
          return;
        }
        if (key.upArrow) {
          setUserIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          setUserIndex((index) => Math.min(userFiltered.length - 1, index + 1));
          return;
        }
        if (input === ' ') {
          if (userFiltered.length === 0) {
            return;
          }
          setUserEntries((entries) =>
            entries.map((entry) => {
              if (entry.id !== userFiltered[userIndex]?.id) {
                return entry;
              }
              const next = cycleAccess(entry);
              return { ...entry, ...next };
            }),
          );
        }
      }
    }
  });

  const keyHelpItems = useMemo(() => {
    const items = [
      { key: 'ctrl+s', description: readOnly ? 'Save (disabled)' : 'Save secret' },
      { key: 'tab', description: creating ? 'Switch key/value/sharing' : 'Switch value/sharing' },
      { key: '← / →', description: 'Change sharing tab' },
      { key: 'space', description: 'Toggle ACL entry' },
      { key: '/', description: 'Search within lists' },
      { key: '?', description: 'Toggle help overlay' },
      { key: 'esc', description: 'Close editor' },
    ];
    if (creating) {
      items.unshift({ key: 'enter', description: 'Insert newline (value panel)' });
    }
    return items;
  }, [creating, readOnly]);

  if (status === 'loading') {
    return (
      <Box paddingY={1} paddingX={2}>
        <Spinner tone="info" label="Loading secret…" persistLabel />
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box paddingY={1} paddingX={2}>
        <ErrorNotice message={errorMessage ?? 'Unable to load secret'} onRetry={handleRetry} />
      </Box>
    );
  }

  const header = creating ? 'Create secret' : `Edit secret ${secret?.key ?? secretKey ?? ''}`;

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <Text bold>{header}</Text>

      <Box flexDirection={compact ? 'column' : 'row'} marginTop={1}>
        <Box flexGrow={1} flexBasis={compact ? 'auto' : 1}>
          <BoxedPanel title="Value" subtitle={readOnly ? 'Read-only' : undefined} width={valuePanelWidth}>
            <Box flexDirection="column">
              <Box flexDirection="row" alignItems="center">
                <Text color="gray">Key:</Text>
                <Box marginLeft={1}>
                  {creating ? (
                    <Box
                      paddingX={1}
                      borderStyle="round"
                      borderColor={activeSection === 'key' ? 'cyan' : 'gray'}
                    >
                      <TextInput
                        value={keyName}
                        onChange={setKeyName}
                        onSubmit={() => setActiveSection('value')}
                        focus={activeSection === 'key'}
                      />
                    </Box>
                  ) : (
                    <Text color="cyan">{keyName || secret?.key || secretKey || ''}</Text>
                  )}
                </Box>
              </Box>

              <Box
                marginTop={1}
                borderStyle="round"
                borderColor={activeSection === 'value' ? 'cyan' : 'gray'}
                paddingX={1}
                paddingY={0}
              >
                {value.length === 0 ? (
                  <Text color="gray">[empty]</Text>
                ) : (
                  <Text>{value}</Text>
                )}
              </Box>

              <Box marginTop={1}>
                <Text dimColor>{value.length} characters</Text>
              </Box>
              {validationError ? (
                <Box marginTop={1}>
                  <Text color="yellow">{validationError}</Text>
                </Box>
              ) : null}
            </Box>
          </BoxedPanel>
        </Box>

        <Box marginLeft={compact ? 0 : 2} marginTop={compact ? 1 : 0} flexBasis={compact ? 'auto' : 1}>
          <BoxedPanel title="Sharing" width={compact ? 60 : 52}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text>
                <Text color={activeTab === 'org' ? 'cyan' : undefined}>Org</Text>
                {'  '}
                <Text color={activeTab === 'teams' ? 'cyan' : undefined}>Teams</Text>
                {'  '}
                <Text color={activeTab === 'users' ? 'cyan' : undefined}>Users</Text>
              </Text>
              <Text dimColor>{hasWriter ? '' : 'No writers selected'}</Text>
            </Box>

            {activeTab === 'org' ? (
              <Box marginTop={1} flexDirection="column">
                <Text inverse={orgFocus === 'read'}>
                  Org can read: {orgAccess.read ? 'Yes' : 'No'}
                </Text>
                <Text inverse={orgFocus === 'write'}>
                  Org can write: {orgAccess.write ? 'Yes' : 'No'}
                </Text>
              </Box>
            ) : null}

            {activeTab === 'teams' ? (
              <Box marginTop={1} flexDirection="column">
                {teamSearchMode ? (
                  <Box flexDirection="row">
                    <Text color="gray">Search teams:</Text>
                    <Box marginLeft={1}>
                      <TextInput value={teamSearch} onChange={setTeamSearch} onSubmit={() => setTeamSearchMode(false)} />
                    </Box>
                  </Box>
                ) : null}
                {teamFiltered.length === 0 ? (
                  <Text color="gray">No teams</Text>
                ) : (
                  teamFiltered.map((entry, index) => (
                    <Text key={entry.id} inverse={index === teamIndex}>
                      {entry.label}
                      {entry.description ? ` — ${entry.description}` : ''} ({describeAccess(entry)})
                    </Text>
                  ))
                )}
              </Box>
            ) : null}

            {activeTab === 'users' ? (
              <Box marginTop={1} flexDirection="column">
                {userSearchMode ? (
                  <Box flexDirection="row">
                    <Text color="gray">Search users:</Text>
                    <Box marginLeft={1}>
                      <TextInput value={userSearch} onChange={setUserSearch} onSubmit={() => setUserSearchMode(false)} />
                    </Box>
                  </Box>
                ) : null}
                {userFiltered.length === 0 ? (
                  <Text color="gray">No users</Text>
                ) : (
                  userFiltered.map((entry, index) => (
                    <Text key={entry.id} inverse={index === userIndex}>
                      {entry.label}
                      {entry.description ? ` — ${entry.description}` : ''} ({describeAccess(entry)})
                    </Text>
                  ))
                )}
              </Box>
            ) : null}
          </BoxedPanel>
        </Box>
      </Box>

      <Box marginTop={1}>
        <KeyHelp items={keyHelpItems} visible={showHelp} />
      </Box>
    </Box>
  );
};
