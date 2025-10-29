import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Key} from 'ink';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {fetchSecretDetail} from '../api/secrets.js';
import type {SecretDetail} from '../types/dto.js';

export interface SecretViewProps {
  secretId: string;
}

const maskValue = (value: string) => '*'.repeat(Math.min(value.length, 12));

const SecretView: React.FC<SecretViewProps> = ({secretId}) => {
  const {client, notify, setEditing, setEscapeHandler} = useAppServices();
  const router = useRouter();
  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchSecretDetail(client, secretId);
      setSecret(detail);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      notify(`Unable to load secret: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [client, secretId, notify]);

  useEffect(() => {
    setEditing(false);
    load().catch(() => undefined);
  }, [load, setEditing]);

  useEffect(() => {
    setEscapeHandler(() => {
      router.pop();
      return true;
    });
    return () => setEscapeHandler(null);
  }, [router, setEscapeHandler]);

  const canEdit = secret?.myPermissions.write ?? false;

  useInput((input: string, key: Key) => {
    if (input === 'b') {
      router.pop();
    }
    if (input === 'e' && canEdit && secret) {
      router.push('SECRET_EDIT', {mode: 'edit', secretId: secret.id});
    }
    if (input === '*') {
      setRevealed((prev) => !prev);
    }
    if (input === 'h') {
      notify('History view is not implemented yet.', 'info');
    }
  });

  const displayValue = useMemo(() => {
    if (!secret) return '';
    if (revealed) return secret.value;
    return maskValue(secret.value);
  }, [secret, revealed]);

  return (
    <Box flexDirection="column">
      {loading ? (
        <Spinner label="Loading secret" />
      ) : error ? (
        <Text color="red">{error}</Text>
      ) : secret ? (
        <>
          <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <Text color="cyan">{secret.key}</Text>
            <Text color="gray">v{secret.version} • {new Date(secret.updatedAt).toLocaleString()}</Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text color="gray">Value</Text>
            <Text>{displayValue}</Text>
            <Text color="gray">Press * to toggle visibility.</Text>
          </Box>
          <Box flexDirection="column">
            <Text color="gray">Access control</Text>
            <Box flexDirection="column" marginTop={1}>
              {secret.acls.length === 0 ? (
                <Text color="gray">No ACL entries.</Text>
              ) : (
                secret.acls.map((entry) => (
                  <Box key={`${entry.principalType}-${entry.principalId}`} flexDirection="row" justifyContent="space-between">
                    <Text>
                      {entry.principalName} ({entry.principalType})
                    </Text>
                    <Text color="gray">
                      {entry.permissions.read ? 'R' : '-'}{entry.permissions.write ? 'W' : '-'}
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </>
      ) : (
        <Text color="red">Secret not found.</Text>
      )}
      <Box marginTop={1}>
        <KeyLegend
          items={[
            {key: 'b', description: 'Back to list'},
            {key: 'e', description: 'Edit secret'},
            {key: '*', description: 'Toggle value visibility'},
            {key: 'h', description: 'View history (optional)'}
          ]}
        />
      </Box>
    </Box>
  );
};

export default SecretView;
