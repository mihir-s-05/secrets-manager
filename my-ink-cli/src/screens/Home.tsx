import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {List} from '../components/List.js';
import KeyLegend from '../components/KeyLegend.js';
import Spinner from '../components/Spinner.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {isAuthenticated, hasAdminAccess} from '../state/session.js';
import {logout} from '../api/auth.js';

interface HomeAction {
  id: string;
  label: string;
  description: string;
}

const Home: React.FC = () => {
  const {session, notify, client, clearSession, setEditing} = useAppServices();
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);

  const authenticated = isAuthenticated(session);
  const admin = hasAdminAccess(session);

  const actions: HomeAction[] = [];

  if (!authenticated) {
    actions.push({id: 'login', label: 'Login', description: 'Authenticate with device code'});
  } else {
    actions.push({id: 'logout', label: 'Logout', description: 'Sign out and clear tokens'});
  }

  actions.push({id: 'secrets', label: 'Secrets', description: 'Browse and manage secrets'});
  actions.push({id: 'directory', label: 'Directory', description: 'Users and teams overview'});

  if (admin) {
    actions.push({id: 'admin', label: 'Admin', description: 'Advanced administrative tools'});
  }

  actions.push({id: 'settings', label: 'Settings', description: 'Server URL, cache, preferences'});

  const handleSelect = useCallback(
    async (item: HomeAction) => {
      if (item.id === 'login') {
        router.replace('LOGIN');
        return;
      }

      if (item.id === 'logout') {
        setIsProcessing(true);
        try {
          await logout(client);
        } catch (error) {
          notify(`Logout failed: ${(error as Error).message}`, 'error');
        } finally {
          clearSession();
          setIsProcessing(false);
          router.replace('LOGIN');
        }
        return;
      }

      if (item.id === 'secrets') {
        router.push('SECRETS');
        return;
      }

      if (item.id === 'directory') {
        router.push('DIRECTORY');
        return;
      }

      if (item.id === 'admin') {
        router.push('ADMIN');
        return;
      }

      if (item.id === 'settings') {
        router.push('SETTINGS');
      }
    },
    [router, client, notify, clearSession]
  );

  useEffect(() => {
    setEditing(false);
  }, [setEditing]);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box width="50%" flexDirection="column">
          {isProcessing ? (
            <Spinner label="Signing out" />
          ) : (
            <List
              focusId="home-menu"
              items={actions}
              itemKey={(item) => item.id}
              onSubmit={(item) => handleSelect(item)}
              renderItem={({item, isHighlighted}) => (
                <Box flexDirection="column">
                  <Text color={isHighlighted ? 'cyan' : undefined}>
                    {item.label}
                  </Text>
                  <Text color="gray">
                    {item.description}
                  </Text>
                </Box>
              )}
            />
          )}
        </Box>
        <Box width="45%" flexDirection="column">
          <Text color="gray">Tips</Text>
          <Text>- Use g to jump to any screen quickly.</Text>
          <Text>- Press ? for help and keybindings.</Text>
          <Text>- Secrets, directory, and admin sections require authentication.</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <KeyLegend
          items={[
            {key: 'Enter', description: 'Activate selected option'},
            {key: 'Tab', description: 'Move focus'},
            {key: 'Esc', description: 'Go back'}
          ]}
        />
      </Box>
    </Box>
  );
};

export default Home;
