import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Key} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {logout as logoutApi} from '../api/auth.js';
import {userSchema} from '../types/dto.js';

const Settings: React.FC = () => {
  const {session, updateSession, clearSession, resetSession, notify, client, setEditing, setEscapeHandler} =
    useAppServices();
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState(session.serverUrl);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 's') {
      void handleSave();
      return;
    }

    if (input === 'l') {
      void handleLogout();
      return;
    }

    if (input === 'x') {
      handleReset();
      return;
    }

    if (input === 'r') {
      void handleReloadProfile();
    }
  });

  const handleSave = useCallback(async () => {
    const normalized = serverUrl.trim().replace(/\/$/, '');
    if (!normalized) {
      notify('Server URL cannot be empty.', 'error');
      return;
    }
    setSaving(true);
    try {
      updateSession({serverUrl: normalized});
      setMessage('Server URL saved.');
      notify(`Server URL updated to ${normalized}`, 'success');
    } finally {
      setSaving(false);
    }
  }, [notify, serverUrl, updateSession]);

  const handleLogout = useCallback(async () => {
    setSaving(true);
    try {
      await logoutApi(client);
    } catch (err) {
      notify(`Logout failed: ${(err as Error).message}`, 'error');
    } finally {
      clearSession();
      setSaving(false);
      router.replace('LOGIN');
    }
  }, [client, clearSession, notify, router]);

  const handleReset = useCallback(() => {
    resetSession();
    notify('Application state reset.', 'success');
    router.replace('HOME');
  }, [notify, resetSession, router]);

  const handleReloadProfile = useCallback(async () => {
    setSaving(true);
    try {
      const response = await client.request('/me', {schema: userSchema});
      const user = userSchema.parse(response.data);
      updateSession({user});
      notify('Profile reloaded.', 'success');
    } catch (err) {
      notify(`Failed to reload profile: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [client, notify, updateSession]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="cyan">Settings</Text>
      {message ? <Text color="green">{message}</Text> : null}
      <Box flexDirection="column">
        <Text color="gray">Server URL</Text>
        <TextInput value={serverUrl} onChange={setServerUrl} onSubmit={() => handleSave()} focus />
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text>- Press Ctrl+S to save</Text>
        <Text>- Press l to logout</Text>
        <Text>- Press x to reset app state</Text>
        <Text>- Press r to reload profile</Text>
      </Box>
      {saving ? <Spinner label="Processing" /> : null}
      <KeyLegend
        items={[
          {key: 'Ctrl+S', description: 'Save server URL'},
          {key: 'l', description: 'Logout'},
          {key: 'x', description: 'Reset app state'},
          {key: 'r', description: 'Reload profile from server'},
          {key: 'Esc', description: 'Back'}
        ]}
      />
    </Box>
  );
};

export default Settings;
