import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Key} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import {List} from '../components/List.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {fetchSecrets} from '../api/secrets.js';
import type {SecretSummary} from '../types/dto.js';

const SecretsList: React.FC = () => {
  const {client, notify, setEditing, setEscapeHandler} = useAppServices();
  const router = useRouter();
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [selectedSecret, setSelectedSecret] = useState<SecretSummary | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecrets(client);
      setSecrets(data);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      notify(`Unable to load secrets: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    setEditing(false);
    loadSecrets().catch(() => undefined);
  }, [loadSecrets, setEditing]);

  useEffect(() => {
    if (filterActive) {
      setEscapeHandler(() => {
        setFilterActive(false);
        setEditing(false);
        return true;
      });
    } else {
      setEscapeHandler(null);
    }
    return () => {
      setEscapeHandler(null);
    };
  }, [filterActive, setEscapeHandler, setEditing]);

  const filteredSecrets = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) {
      return secrets;
    }
    return secrets.filter((secret) => {
      if (secret.key.toLowerCase().includes(term)) {
        return true;
      }
      const permissions: string[] = [];
      if (secret.myPermissions.read) permissions.push('read');
      if (secret.myPermissions.write) permissions.push('write');
      return permissions.join(' ').includes(term);
    });
  }, [filter, secrets]);

  useEffect(() => {
    if (filteredSecrets.length === 0) {
      setSelectedSecret(null);
      return;
    }
    if (!selectedSecret || !filteredSecrets.some((secret) => secret.id === selectedSecret.id)) {
      setSelectedSecret(filteredSecrets[0]);
    }
  }, [filteredSecrets, selectedSecret]);

  useInput((input: string, key: Key) => {
    if (filterActive) {
      return;
    }

    if (input === 'n') {
      router.push('SECRET_EDIT', {mode: 'create'});
      return;
    }

    if (input === 'r') {
      loadSecrets().catch(() => undefined);
      return;
    }

    if (input === '/') {
      setFilterActive(true);
      setEditing(true);
    }

    if (input === 'e') {
      if (selectedSecret?.myPermissions.write) {
        router.push('SECRET_EDIT', {mode: 'edit', secretId: selectedSecret.id});
      } else {
        notify('You need write permission to edit this secret.', 'error');
      }
    }
  });

  const handleSubmit = (secret: SecretSummary) => {
    router.push('SECRET_VIEW', {secretId: secret.id});
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan">Secrets</Text>
      </Box>
      {filterActive ? (
        <Box marginBottom={1}>
          <Text color="gray">Filter:</Text>
          <Box marginLeft={1}>
            <TextInput
              value={filter}
              onChange={setFilter}
              focus
              onSubmit={() => {
                setFilterActive(false);
                setEditing(false);
              }}
            />
          </Box>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="gray">Press / to filter</Text>
        </Box>
      )}
      {loading ? (
        <Spinner label="Loading secrets" />
      ) : error ? (
        <Text color="red">{error}</Text>
      ) : (
        <List
          focusId="secrets-list"
          isActive={!filterActive}
          maxVisible={12}
          items={filteredSecrets}
          itemKey={(item) => item.id}
          onHighlight={(item) => setSelectedSecret(item)}
          onSubmit={handleSubmit}
          renderItem={({item, isHighlighted}) => (
            <Box flexDirection="column">
              <Text color={isHighlighted ? 'cyan' : undefined}>
                {item.key} (v{item.version})
              </Text>
              <Text color="gray">Updated {new Date(item.updatedAt).toLocaleString()}</Text>
              <Text color={item.myPermissions.write ? 'green' : 'gray'}>
                RW: {item.myPermissions.read ? 'R' : '-'}{item.myPermissions.write ? 'W' : '-'}
              </Text>
            </Box>
          )}
          emptyMessage="No secrets found"
        />
      )}
      <Box marginTop={1}>
        <KeyLegend
          items={[
            {key: 'Enter', description: 'View secret'},
            {key: 'j/k', description: 'Move down/up'},
            {key: 'n', description: 'New secret'},
            {key: 'e', description: 'Edit secret'},
            {key: 'r', description: 'Refresh'},
            {key: '/', description: 'Filter secrets'}
          ]}
        />
      </Box>
    </Box>
  );
};

export default SecretsList;
