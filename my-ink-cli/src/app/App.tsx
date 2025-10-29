#!/usr/bin/env node
import React, {createContext, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, Static, useApp, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {RouterProvider, useRouter, type Route, ROUTES} from './Router.js';
import {Keymap} from './Keymap.js';
import {theme} from './Theme.js';
import {sessionStore, type SessionSnapshot, isAuthenticated, hasAdminAccess} from '../state/session.js';
import {ApiClient} from '../api/client.js';
import KeyLegend from '../components/KeyLegend.js';
import Modal from '../components/Modal.js';
import Spinner from '../components/Spinner.js';
import Home from '../screens/Home.js';
import Login from '../screens/Login.js';
import SecretsList from '../screens/SecretsList.js';
import SecretView from '../screens/SecretView.js';
import SecretEdit from '../screens/SecretEdit.js';
import Directory from '../screens/Directory.js';
import Admin from '../screens/Admin.js';
import Settings from '../screens/Settings.js';
import {List} from '../components/List.js';
import {userSchema} from '../types/dto.js';

export interface AppServices {
  session: SessionSnapshot;
  updateSession: (update: Partial<SessionSnapshot>) => void;
  clearSession: () => void;
  resetSession: () => void;
  client: ApiClient;
  notify: (message: string, tone?: MessageTone) => void;
  setEditing: (editing: boolean) => void;
  isScreenReader: boolean;
  setEscapeHandler: (handler: (() => boolean) | null) => void;
}

export const AppServicesContext = createContext<AppServices | undefined>(undefined);

export const useAppServices = (): AppServices => {
  const ctx = React.useContext(AppServicesContext);
  if (!ctx) {
    throw new Error('useAppServices must be used within AppServicesContext');
  }
  return ctx;
};

type MessageTone = 'info' | 'success' | 'error';

interface MessageItem {
  id: string;
  text: string;
  tone: MessageTone;
}

const apiClient = new ApiClient(sessionStore);

const AppShell: React.FC = () => {
  const router = useRouter();
  const {exit} = useApp();
  const [session, setSession] = useState<SessionSnapshot>(sessionStore.getSnapshot());
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [isHelpVisible, setHelpVisible] = useState(false);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const escapeHandlerRef = useRef<(() => boolean) | null>(null);

  const isScreenReader = process.env.INK_SCREEN_READER === 'true';

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(setSession);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAuthenticated(session) && router.route.name !== 'LOGIN') {
      router.replace('LOGIN');
    }
    if (isAuthenticated(session) && router.route.name === 'LOGIN') {
      router.replace('HOME');
    }
  }, [router, session]);

  const notify = useCallback((text: string, tone: MessageTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages((prev) => [...prev, {id, text, tone}]);
  }, []);

  const updateSession = useCallback((update: Partial<SessionSnapshot>) => {
    sessionStore.update(update);
  }, []);

  useEffect(() => {
    if (!isAuthenticated(session) || session.user) {
      return;
    }
    apiClient
      .request('/me', {schema: userSchema})
      .then((response) => {
        const normalized = userSchema.parse(response.data);
        updateSession({user: {...normalized, teams: normalized.teams ?? []}});
      })
      .catch((err) => {
        notify(`Unable to load profile: ${(err as Error).message}`, 'error');
      });
  }, [session.accessToken, session.refreshToken, session.user, updateSession, notify]);

  const registerEscapeHandler = useCallback((handler: (() => boolean) | null) => {
    escapeHandlerRef.current = handler;
  }, []);

  const serviceValue = useMemo<AppServices>(() => ({
    session,
    updateSession,
    clearSession: () => sessionStore.clearTokens(),
    resetSession: () => sessionStore.reset(),
    client: apiClient,
    notify,
    setEditing: setIsEditing,
    isScreenReader,
    setEscapeHandler: registerEscapeHandler
  }), [session, updateSession, notify, isScreenReader, registerEscapeHandler]);

  const availableRoutes = useMemo(() => {
    return ROUTES.filter((route) => {
      if (route.requiresAdmin) {
        return hasAdminAccess(session);
      }
      if (route.requiresAuth) {
        return isAuthenticated(session);
      }
      return true;
    });
  }, [session]);

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return availableRoutes.filter((route) => route.name !== 'SECRET_VIEW' && route.name !== 'SECRET_EDIT');
    }
    return availableRoutes.filter((route) => {
      return (
        route.title.toLowerCase().includes(query) ||
        route.description.toLowerCase().includes(query) ||
        route.name.toLowerCase().includes(query)
      );
    });
  }, [availableRoutes, commandQuery]);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery('');
  }, []);

  const handleEscape = useCallback(() => {
    const handler = escapeHandlerRef.current;
    if (handler) {
      const handled = handler();
      if (handled) {
        return;
      }
    }
    if (confirmExit) {
      setConfirmExit(false);
      return;
    }
    if (isCommandPaletteOpen) {
      closeCommandPalette();
      return;
    }
    if (isHelpVisible) {
      setHelpVisible(false);
      return;
    }
    if (router.stack.length > 1) {
      router.pop();
    }
  }, [confirmExit, isCommandPaletteOpen, closeCommandPalette, isHelpVisible, router]);

  const confirmExitAndQuit = useCallback(() => {
    setConfirmExit(false);
    exit();
  }, [exit]);

  const handleExit = useCallback(() => {
    if (confirmExit) {
      confirmExitAndQuit();
      return;
    }
    if (isEditing) {
      setConfirmExit(true);
      return;
    }
    exit();
  }, [confirmExit, confirmExitAndQuit, exit, isEditing]);

  useInput((input, key) => {
    if (!confirmExit) {
      return;
    }
    if (key.return || input === 'q') {
      confirmExitAndQuit();
    }
  });

  const renderStatus = () => {
    const isAuth = isAuthenticated(session);
    const who = isAuth
      ? `${session.user?.displayName ?? session.user?.email ?? 'Signed in'}@${session.user?.org?.name ?? 'org'}`
      : 'Not signed in';
    const role = isAuth ? (session.user?.isAdmin ? 'admin' : 'member') : '';
    const routeLabel = router.route.name.toLowerCase();

    const left = role ? `${who} (${role})` : who;
    const middle = session.serverUrl;
    const right = `${routeLabel} • ? help`;

    return (
      <Box paddingX={1}>
        <Text>
          {left}  •  {middle}  •  {right}
        </Text>
      </Box>
    );
  };

  const renderScreen = () => {
    const current = router.route;
    switch (current.name) {
      case 'HOME':
        return <Home />;
      case 'LOGIN':
        return <Login />;
      case 'SECRETS':
        return <SecretsList />;
      case 'SECRET_VIEW':
        return <SecretView secretId={(current.params as {secretId?: string} | undefined)?.secretId ?? ''} />;
      case 'SECRET_EDIT':
        return (
          <SecretEdit
            secretId={(current.params as {secretId?: string} | undefined)?.secretId}
            mode={(current.params as {mode?: 'create' | 'edit'} | undefined)?.mode ?? 'create'}
          />
        );
      case 'DIRECTORY':
        return <Directory defaultTab={(current.params as {tab?: 'users' | 'teams'} | undefined)?.tab} />;
      case 'ADMIN':
        return <Admin />;
      case 'SETTINGS':
        return <Settings />;
      default:
        return <Home />;
    }
  };

  const handleCommandSubmit = (selectionIndex?: number) => {
    const index = selectionIndex ?? 0;
    const route = filteredCommands[index];
    if (route) {
      router.replace(route.name);
      closeCommandPalette();
    }
  };

  return (
    <AppServicesContext.Provider value={serviceValue}>
      <Keymap
        isEditing={isEditing || isCommandPaletteOpen}
        onToggleHelp={() => setHelpVisible((prev) => !prev)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onExitRequested={handleExit}
        onEscape={handleEscape}
      />
      <Box flexDirection="column" height="100%">
        <Static items={messages}>
          {(message) => (
            <Text key={message.id} color={messageToneToColor(message.tone)}>
              {message.text}
            </Text>
          )}
        </Static>
        <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
          {renderScreen()}
        </Box>
        <Box borderStyle="single" borderColor={theme.colors.muted}>
          {renderStatus()}
        </Box>
      </Box>

      {isHelpVisible ? (
        <Modal title="Keybindings">
          <KeyLegend
            items={[
              {key: '?', description: 'Toggle this help'},
              {key: 'g', description: 'Open command palette'},
              {key: 'Esc', description: 'Close overlay / go back'},
              {key: 'Tab', description: 'Cycle focus forward'},
              {key: 'Shift+Tab', description: 'Cycle focus backward'},
              {key: 'q / Ctrl+C', description: 'Quit application'}
            ]}
          />
        </Modal>
      ) : null}

      {isCommandPaletteOpen ? (
        <Modal title="Go to">
          <Box flexDirection="column">
            <Box flexDirection="row" marginBottom={1}>
              <Text color={theme.colors.muted}>
                Route:{' '}
              </Text>
              <TextInput
                value={commandQuery}
                onChange={setCommandQuery}
                onSubmit={() => handleCommandSubmit(0)}
              />
            </Box>
            {filteredCommands.length === 0 ? (
              <Text color={theme.colors.muted}>
                No routes match "{commandQuery}".
              </Text>
            ) : (
              <List
                key={commandQuery}
                focusId="command-palette-list"
                items={filteredCommands}
                itemKey={(item) => item.name}
                initialIndex={0}
                onSubmit={(_, index) => handleCommandSubmit(index)}
                renderItem={({item, isHighlighted}) => (
                  <Text color={isHighlighted ? theme.colors.primary : undefined}>
                    {item.title} ({item.name.toLowerCase()})
                  </Text>
                )}
              />
            )}
          </Box>
        </Modal>
      ) : null}

      {confirmExit ? (
        <Modal title="Confirm exit" footer={<Text>Press Enter to exit or Esc to stay</Text>}>
          <Text>Unsaved changes may be lost. Exit?</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.primary}>
              q / Enter
            </Text>
            <Text>
              {' '}to confirm, Esc to cancel.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Spinner label="Waiting for confirmation" />
          </Box>
        </Modal>
      ) : null}
    </AppServicesContext.Provider>
  );
};

const messageToneToColor = (tone: MessageTone): typeof theme.colors[keyof typeof theme.colors] => {
  switch (tone) {
    case 'success':
      return theme.colors.success;
    case 'error':
      return theme.colors.error;
    default:
      return theme.colors.muted;
  }
};

const App: React.FC = () => {
  const initial = sessionStore.getSnapshot();
  const initialRoute: Route = initial.accessToken ? {name: 'HOME'} : {name: 'HOME'};
  return (
    <RouterProvider initial={initialRoute}>
      <AppShell />
    </RouterProvider>
  );
};

export default App;
