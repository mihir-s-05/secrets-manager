import React, { useEffect, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';

import type { AxiosInstance } from 'axios';

import { hydrateSession } from './services/auth.js';
import { getApiClient, initApiClient } from './services/api.js';
import { useAppStore } from './services/store.js';
import { Toasts } from './ui/components/index.js';

export interface ScreenPropsWithClient {
  apiClient?: AxiosInstance;
  [key: string]: unknown;
}

export interface AppProps<TProps extends ScreenPropsWithClient = ScreenPropsWithClient> {
  screen: React.ComponentType<TProps>;
  screenProps: Omit<TProps, 'apiClient'>;
  /**
   * Optional API base URL override. When provided, the api client is initialised before render.
   */
  apiBaseUrl?: string;
}

export const App = <TProps extends ScreenPropsWithClient>({ screen: Screen, screenProps, apiBaseUrl }: AppProps<TProps>) => {
  const setScreenReaderEnabled = useAppStore((state) => state.setScreenReaderEnabled);
  const apiUrlInStore = useAppStore((state) => state.apiBaseUrl);
  const isScreenReaderEnabled = useIsScreenReaderEnabled?.() ?? false;
  const [clientReady, setClientReady] = useState(() => {
    try {
      getApiClient();
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setScreenReaderEnabled(isScreenReaderEnabled);
  }, [isScreenReaderEnabled, setScreenReaderEnabled]);

  useEffect(() => {
    let cancelled = false;

    setClientReady(() => {
      try {
        getApiClient();
        return true;
      } catch {
        return false;
      }
    });

    void (async () => {
      try {
        const client = await initApiClient({ baseUrl: apiBaseUrl ?? apiUrlInStore, persist: Boolean(apiBaseUrl) });
        // prime session if available
        await hydrateSession();
        if (!cancelled) {
          setClientReady(true);
        }
        return client;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[app] Failed to initialise API client:', error);
        if (!cancelled) {
          setClientReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiUrlInStore]);

  if (!clientReady) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text role="status">Connecting to API…</Text>
      </Box>
    );
  }

  const mergedProps = {
    ...(screenProps as object),
    apiClient: getApiClient(),
  } as TProps;

  return (
    <Box flexDirection="column">
      <Screen {...mergedProps} />
      <Box flexDirection="column" alignItems="flex-end" marginTop={1}>
        <Toasts />
      </Box>
    </Box>
  );
};
