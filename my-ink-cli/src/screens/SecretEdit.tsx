import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useFocus, useFocusManager, useInput} from 'ink';
import type {Key} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {randomUUID} from 'node:crypto';
import {List} from '../components/List.js';
import MultiLineInput from '../components/MultiLineInput.js';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import Modal from '../components/Modal.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {createSecret, fetchSecretDetail, updateSecret} from '../api/secrets.js';
import {fetchTeams, fetchUsers} from '../api/directory.js';
import {
  secretWritePayloadSchema,
  type Permissions,
  type SecretDetail,
  type SecretWritePayload,
  type Team,
  type User
} from '../types/dto.js';

interface SecretEditProps {
  secretId?: string;
  mode: 'create' | 'edit';
}

interface AclFormEntry {
  id: string;
  principalType: 'org' | 'team' | 'user';
  principalId: string;
  label: string;
  permissions: Permissions;
}

interface AclSelection {
  type: 'org' | 'team' | 'user';
  principalId: string;
  label: string;
}

type PermissionCursor = 'read' | 'write';

type AddModalState =
  | {step: 'type'}
  | {step: 'principal'; type: 'team' | 'user'};

type FocusSlot = 'none' | 'key' | 'value' | 'acl';

interface KeyInputFieldProps {
  value: string;
  onChange: (value: string) => void;
  isActive: boolean;
}

const KeyInputField: React.FC<KeyInputFieldProps> = ({value, onChange, isActive}) => {
  const {isFocused} = useFocus({id: 'secret-edit-key', isActive});

  return (
    <Box flexDirection="column">
      <Text color="gray">Key</Text>
      <TextInput value={value} onChange={onChange} focus={isFocused} showCursor />
    </Box>
  );
};

const FocusSentinel: React.FC<{isActive: boolean}> = ({isActive}) => {
  useFocus({id: 'secret-edit-idle', isActive});
  return <Box width={0} height={0} />;
};

const SecretEdit: React.FC<SecretEditProps> = ({secretId, mode}) => {
  const {client, notify, session, setEditing, setEscapeHandler} = useAppServices();
  const router = useRouter();
  const focusManager = useFocusManager();
  const isEditMode = mode === 'edit';

  const [focusSlot, setFocusSlot] = useState<FocusSlot>(() => (isEditMode ? 'value' : 'none'));

  const [keyValue, setKeyValue] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [aclEntries, setAclEntries] = useState<AclFormEntry[]>([]);
  const [selectedAclId, setSelectedAclId] = useState<string | null>(null);
  const [permissionCursor, setPermissionCursor] = useState<PermissionCursor>('read');
  const selectedAclIdRef = useRef<string | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [modalState, setModalState] = useState<AddModalState | null>(null);
  const [queuedSelection, setQueuedSelection] = useState<AclSelection | null>(null);

  const focusOrder = useMemo<FocusSlot[]>(() => {
    const order: FocusSlot[] = ['none'];
    if (!isEditMode) {
      order.push('key');
    }
    order.push('value', 'acl');
    return order;
  }, [isEditMode]);

  const isAclFocused = focusSlot === 'acl';

  const cycleFocus = useCallback(
    (direction: 1 | -1) => {
      setFocusSlot((current) => {
        const currentIndex = focusOrder.indexOf(current);
        const safeIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = (safeIndex + direction + focusOrder.length) % focusOrder.length;
        return focusOrder[nextIndex];
      });
    },
    [focusOrder]
  );

  useEffect(() => {
    if (focusSlot === 'key') {
      focusManager.focus('secret-edit-key');
    } else if (focusSlot === 'value') {
      focusManager.focus('secret-edit-value');
    } else if (focusSlot === 'acl') {
      focusManager.focus('secret-edit-acl');
    } else {
      focusManager.focus('secret-edit-idle');
    }
  }, [focusManager, focusSlot]);

  useEffect(() => {
    if (focusSlot === 'acl') {
      setPermissionCursor('read');
    }
  }, [focusSlot]);

  const fetchDirectory = useCallback(async () => {
    try {
      const [teamsResult, usersResult] = await Promise.all([fetchTeams(client), fetchUsers(client)]);
      setTeams(teamsResult);
      setUsers(usersResult);
    } catch (err) {
      notify(`Unable to load directory: ${(err as Error).message}`, 'error');
    }
  }, [client, notify]);

  const primeFromSecret = useCallback((detail: SecretDetail) => {
    setKeyValue(detail.key);
    setSecretValue(detail.value);
    const seeds = detail.acls.map<AclFormEntry>((entry) => ({
      id: randomUUID(),
      principalType: entry.principalType,
      principalId: entry.principalId,
      label: entry.principalName,
      permissions: {...entry.permissions}
    }));
    setAclEntries(seeds);
    const initialId = seeds[0]?.id ?? null;
    setSelectedAclId(initialId);
    selectedAclIdRef.current = initialId;
  }, []);

  useEffect(() => {
    setEditing(true);
    setEscapeHandler(() => {
      router.pop();
      return true;
    });

    return () => {
      setEditing(false);
      setEscapeHandler(null);
    };
  }, [router, setEditing, setEscapeHandler]);

  useEffect(() => {
    if (isEditMode && secretId) {
      setLoading(true);
      fetchSecretDetail(client, secretId)
        .then(primeFromSecret)
        .catch((err: Error) => {
          setError(err.message);
          notify(`Unable to load secret: ${err.message}`, 'error');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [client, secretId, isEditMode, primeFromSecret, notify]);

  useEffect(() => {
    fetchDirectory().catch(() => undefined);
  }, [fetchDirectory]);

  useEffect(() => {
    if (queuedSelection) {
      addAclEntry(queuedSelection);
      setQueuedSelection(null);
    }
  }, [queuedSelection]);

  const addAclEntry = useCallback(
    (selection: AclSelection) => {
      setAclEntries((prev) => {
        const exists = prev.some(
          (entry) => entry.principalType === selection.type && entry.principalId === selection.principalId
        );
        if (exists) {
          notify('ACL entry already exists for that principal.', 'error');
          return prev;
        }
        const nextEntry: AclFormEntry = {
          id: randomUUID(),
          principalType: selection.type,
          principalId: selection.principalId,
          label: selection.label,
          permissions: {read: true, write: false}
        };
        const next = [...prev, nextEntry];
        setSelectedAclId(nextEntry.id);
        selectedAclIdRef.current = nextEntry.id;
        setPermissionCursor('read');
        return next;
      });
    },
    [notify]
  );

  const removeSelectedEntry = useCallback(() => {
    const activeId = selectedAclId;
    if (!activeId) return;
    setAclEntries((prev) => {
      const filtered = prev.filter((entry) => entry.id !== activeId);
      const nextId = filtered[0]?.id ?? null;
      setSelectedAclId(nextId);
      selectedAclIdRef.current = nextId;
      return filtered;
    });
  }, [selectedAclId]);

  const togglePermissionById = useCallback((entryId: string, permission: PermissionCursor) => {
    setAclEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              permissions: {
                ...entry.permissions,
                [permission]: !entry.permissions[permission]
              }
            }
          : entry
      )
    );
  }, []);

  const toggleSelectedPermission = useCallback(() => {
    const currentId = selectedAclIdRef.current ?? selectedAclId;
    if (!currentId) return;
    togglePermissionById(currentId, permissionCursor);
  }, [permissionCursor, selectedAclId, togglePermissionById]);

  const handleSave = useCallback(async () => {
    setFormErrors([]);
    setError(null);

    const payload: SecretWritePayload = {
      key: keyValue.trim(),
      value: secretValue,
      acls: aclEntries.map((entry) => ({
        principalType: entry.principalType,
        principalId: entry.principalId,
        permissions: entry.permissions
      }))
    };

    const parsed = secretWritePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => issue.message);
      setFormErrors(issues);
      if (issues.length > 0) {
        notify(issues[0], 'error');
      }
      return;
    }

    setSaving(true);
    try {
      if (isEditMode && secretId) {
        const updated = await updateSecret(client, secretId, {...payload, replaceAcls: true});
        notify(`Secret '${updated.key}' saved (v${updated.version})`, 'success');
        router.replace('SECRET_VIEW', {secretId: updated.id});
      } else {
        const created = await createSecret(client, payload);
        notify(`Secret '${created.key}' saved (v${created.version})`, 'success');
        router.replace('SECRET_VIEW', {secretId: created.id});
      }
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      notify(`Failed to save secret: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [aclEntries, client, isEditMode, keyValue, notify, router, secretId, secretValue]);

  useInput((input: string, key: Key) => {
    if (modalState) {
      if (key.escape) {
        setModalState(null);
      }
      return;
    }

    if (key.tab) {
      cycleFocus(key.shift ? -1 : 1);
      return;
    }

    // Global focus navigation shortcuts
    if (key.ctrl && key.downArrow) {
      cycleFocus(1);
      return;
    }
    if (key.ctrl && key.upArrow) {
      cycleFocus(-1);
      return;
    }
    if (key.ctrl && input === '3') {
      setFocusSlot('acl');
      return;
    }
    if (key.ctrl && input === '2') {
      setFocusSlot('value');
      return;
    }
    if (!isEditMode && key.ctrl && input === '1') {
      setFocusSlot('key');
      return;
    }

    if (key.ctrl && input === 's') {
      void handleSave();
      return;
    }

    if (!key.ctrl && (input === 's' || input === 'S')) {
      void handleSave();
      return;
    }

    if (isAclFocused) {
      if (input === 'a') {
        setModalState({step: 'type'});
        return;
      }
      if (input === 'd') {
        removeSelectedEntry();
        return;
      }
      if (input === ' ') {
        toggleSelectedPermission();
        return;
      }
      if (key.leftArrow) {
        setPermissionCursor('read');
        return;
      }
      if (key.rightArrow) {
        setPermissionCursor('write');
        return;
      }
    }

    if (key.escape) {
      router.pop();
    }
  });

  useEffect(() => {
    if (aclEntries.length > 0 && !selectedAclId) {
      setSelectedAclId(aclEntries[0].id);
    }
  }, [aclEntries, selectedAclId]);

  const aclItems = useMemo(() => aclEntries, [aclEntries]);
  const activeEntry = aclEntries.find((entry) => entry.id === selectedAclId) ?? null;

  const renderKeyField = () => {
    if (isEditMode) {
      return (
        <Box flexDirection="column">
          <Text color="gray">Key</Text>
          <Text>{keyValue}</Text>
          <Text color="gray">(immutable)</Text>
        </Box>
      );
    }

    return <KeyInputField value={keyValue} onChange={setKeyValue} isActive={focusSlot === 'key'} />;
  };

  const openOrgAcl = () => {
    const org = session.user?.org;
    if (!org?.id) {
      notify('Unable to determine organization id for ACL entry.', 'error');
      return;
    }
    setQueuedSelection({type: 'org', principalId: org.id, label: org.name ?? 'Organization'});
  };

  const handleSelectType = (type: 'org' | 'team' | 'user') => {
    if (type === 'org') {
      openOrgAcl();
      setModalState(null);
      return;
    }
    setModalState({step: 'principal', type});
  };

  const handleSelectPrincipal = (selection: AclSelection) => {
    setQueuedSelection(selection);
    setModalState(null);
  };

  if (loading) {
    return <Spinner label="Loading secret" />;
  }

  return (
    <>
      <FocusSentinel isActive={focusSlot === 'none'} />
      <Box flexDirection="column" gap={1}>
        <Text color="cyan">{isEditMode ? 'Edit secret' : 'Create secret'}</Text>
        {formErrors.length > 0 ? (
          <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} paddingY={0}>
            {formErrors.map((issue) => (
              <Text key={issue} color="red">
                {issue}
              </Text>
            ))}
          </Box>
        ) : null}
        {error ? <Text color="red">{error}</Text> : null}

        {renderKeyField()}

        <Box flexDirection="column">
          <Text color="gray">Value</Text>
          <MultiLineInput
            value={secretValue}
            onChange={setSecretValue}
            focusId="secret-edit-value"
            isActive={focusSlot === 'value'}
            maxRows={6}
          />
        </Box>

        <Box flexDirection="column">
          <Text color="gray">Access control</Text>
          <List
            focusId="secret-edit-acl"
            isActive={focusSlot === 'acl'}
            items={aclItems}
            emptyMessage="No ACL entries. Press 'a' to add one."
            itemKey={(item) => item.id}
            onHighlight={(item) => {
              selectedAclIdRef.current = item.id;
              setSelectedAclId(item.id);
            }}
            renderItem={({item, isHighlighted}) => (
              <Box flexDirection="column">
                <Text color={isHighlighted ? 'cyan' : undefined}>
                  {item.label} ({item.principalType})
                </Text>
                <Box flexDirection="row" gap={1}>
                  <Text color={permissionCursor === 'read' && isHighlighted && isAclFocused ? 'cyan' : 'gray'}>
                    Read [{item.permissions.read ? 'x' : ' '}]
                  </Text>
                  <Text color={permissionCursor === 'write' && isHighlighted && isAclFocused ? 'cyan' : 'gray'}>
                    Write [{item.permissions.write ? 'x' : ' '}]
                  </Text>
                </Box>
              </Box>
            )}
          />
          {activeEntry ? (
            <Text color="gray">Selected: {activeEntry.label}</Text>
          ) : null}
        </Box>

        {saving ? <Spinner label="Saving" /> : null}

        <KeyLegend
          items={[
            {key: 'Ctrl+S', description: 'Save secret'},
            {key: 'Tab', description: 'Next section'},
            {key: 'Shift+Tab', description: 'Previous section'},
            {key: 'Ctrl+↑/↓', description: 'Switch section'},
            {key: 'Ctrl+3', description: 'Focus ACL'},
            {key: 'a', description: 'Add ACL entry'},
            {key: 'd', description: 'Delete ACL entry'},
            {key: 'Space', description: 'Toggle permission'},
            {key: '←/→', description: 'Switch permission focus'},
            {key: 'Esc', description: 'Back without saving'}
          ]}
        />

        {modalState ? (
          <AclModal
            state={modalState}
            onCancel={() => setModalState(null)}
            onSelectType={handleSelectType}
            onSelectPrincipal={handleSelectPrincipal}
            teams={teams}
            users={users}
          />
        ) : null}
      </Box>
    </>
  );
};

interface AclModalProps {
  state: AddModalState;
  onCancel: () => void;
  onSelectType: (type: 'org' | 'team' | 'user') => void;
  onSelectPrincipal: (selection: AclSelection) => void;
  teams: Team[];
  users: User[];
}

const AclModal: React.FC<AclModalProps> = ({state, onCancel, onSelectType, onSelectPrincipal, teams, users}) => {
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (state.step === 'type') {
    const items: Array<{label: string; value: 'org' | 'team' | 'user'}> = [
      {label: 'Organization', value: 'org'},
      {label: 'Team', value: 'team'},
      {label: 'User', value: 'user'}
    ];
    return (
      <Modal title="Add ACL entry">
        <Text>Select principal type:</Text>
        <SelectInput<'org' | 'team' | 'user'> items={items} onSelect={(item) => onSelectType(item.value)} />
        <Text color="gray">Esc to cancel</Text>
      </Modal>
    );
  }

  if (state.type === 'team') {
    return (
      <Modal title="Select team">
        {teams.length === 0 ? (
          <Text color="gray">No teams available.</Text>
        ) : (
          <SelectInput<Team>
            items={teams.map((team) => ({label: team.name, value: team}))}
            onSelect={(item) =>
              onSelectPrincipal({
                type: 'team',
                principalId: item.value.id,
                label: item.value.name
              })
            }
          />
        )}
        <Text color="gray">Esc to cancel</Text>
      </Modal>
    );
  }

  return (
    <Modal title="Select user">
      {users.length === 0 ? (
        <Text color="gray">No users available.</Text>
      ) : (
        <SelectInput<User>
          items={users.map((user) => ({
            label: `${user.displayName ?? user.email} <${user.email}>`,
            value: user
          }))}
          onSelect={(item) =>
            onSelectPrincipal({
              type: 'user',
              principalId: item.value.id,
              label: item.value.displayName ?? item.value.email
            })
          }
        />
      )}
      <Text color="gray">Esc to cancel</Text>
    </Modal>
  );
};

export default SecretEdit;
