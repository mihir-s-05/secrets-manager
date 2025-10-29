import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { Box, Text, useApp, useInput, useIsScreenReaderEnabled } from 'ink';
import Link from 'ink-link';
import open from 'open';

import {
  DeviceFlowExpiredError,
  DeviceFlowPollResult,
  DeviceFlowStartResponse,
  pollDeviceFlow,
  startDeviceFlow,
} from '../../services/auth.js';
import { normalizeApiError } from '../../services/api.js';
import { useAppStore } from '../../services/store.js';
import { BoxedPanel, ErrorNotice, KeyHelp, Spinner } from '../components/index.js';
import { useCompactLayout } from '../hooks/index.js';

export interface LoginScreenProps {
  apiClient: AxiosInstance;
  autoOpenBrowser?: boolean;
  onSuccess?: (result: DeviceFlowPollResult) => void;
  onCancel?: () => void;
}

type LoginStatus = 'idle' | 'starting' | 'pending' | 'success' | 'expired' | 'error';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  apiClient,
  autoOpenBrowser = true,
  onSuccess,
  onCancel,
}) => {
  const app = useApp();
  const compact = useCompactLayout();
  const screenReader = useIsScreenReaderEnabled?.() ?? false;
  const pushToast = useAppStore((state) => state.pushToast);

  const [status, setStatus] = useState<LoginStatus>('idle');
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowStartResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [successResult, setSuccessResult] = useState<DeviceFlowPollResult | null>(null);

  const timersRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);
  const unmountedRef = useRef(false);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  };

  const startPolling = useCallback(async () => {
    if (!deviceFlow) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const poll = async () => {
      if (unmountedRef.current) {
        return;
      }

      try {
        const result = await pollDeviceFlow(apiClient, {
          deviceCode: deviceFlow.deviceCode,
          deviceId: deviceFlow.deviceId,
          signal: controller.signal,
        });

        if (unmountedRef.current) {
          return;
        }

        if (!result) {
          const next = setTimeout(poll, (deviceFlow.pollIntervalSec ?? 5) * 1000);
          timersRef.current.add(next);
          return;
        }

        setStatus('success');
        setSuccessResult(result);
        pushToast({
          kind: 'success',
          message: `Signed in as ${result.user.email ?? result.user.id}`,
          durationMs: 2500,
          persistent: true,
        });
        onSuccess?.(result);
        const timer = setTimeout(() => app.exit(), 750);
        timersRef.current.add(timer);
      } catch (error) {
        if (unmountedRef.current) {
          return;
        }

        if (error instanceof DeviceFlowExpiredError) {
          setStatus('expired');
          setErrorMessage('Your device code expired. Press [r] to restart the flow.');
          pushToast({
            kind: 'error',
            message: 'Device code expired',
            durationMs: 4000,
            persistent: true,
          });
          return;
        }

        const apiError = normalizeApiError(error);
        setStatus('error');
        setErrorMessage(apiError.message ?? 'Unable to complete login');
      }
    };

    setStatus('pending');
    await poll();
  }, [apiClient, app, deviceFlow, onSuccess, pushToast]);

  const beginDeviceFlow = useCallback(async () => {
    clearTimers();
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('starting');
    setErrorMessage(null);
    setSuccessResult(null);
    openedRef.current = false;

    try {
      const start = await startDeviceFlow(apiClient);
      if (unmountedRef.current) {
        return;
      }
      setDeviceFlow(start);
      setStatus('pending');
    } catch (error) {
      if (unmountedRef.current) {
        return;
      }
      const apiError = normalizeApiError(error);
      setStatus('error');
      setErrorMessage(apiError.message ?? 'Failed to initiate device flow');
    }
  }, [apiClient]);

  const openVerificationUrl = useCallback(async () => {
    if (!deviceFlow) {
      return;
    }
    const url = deviceFlow.verificationUriComplete ?? deviceFlow.verificationUri;
    if (!url) {
      return;
    }
    try {
      await open(url);
      pushToast({ kind: 'info', message: 'Opened browser for login', durationMs: 2000 });
    } catch (error) {
      const apiError = normalizeApiError(error);
      pushToast({ kind: 'error', message: apiError.message ?? 'Failed to open browser', durationMs: 4000, persistent: true });
    }
  }, [deviceFlow, pushToast]);

  useEffect(() => {
    beginDeviceFlow();
    return () => {
      unmountedRef.current = true;
      clearTimers();
      abortRef.current?.abort();
    };
  }, [beginDeviceFlow]);

  useEffect(() => {
    if (status !== 'pending' || !deviceFlow) {
      return;
    }
    if (autoOpenBrowser && !openedRef.current && deviceFlow.verificationUri) {
      openedRef.current = true;
      void openVerificationUrl();
    }
    void startPolling();

    return () => {
      abortRef.current?.abort();
    };
  }, [autoOpenBrowser, deviceFlow, openVerificationUrl, startPolling, status]);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') {
      onCancel?.();
      app.exit();
      return;
    }

    if (input === '?') {
      setShowHelp((current) => !current);
      return;
    }

    if (input.toLowerCase() === 'r') {
      void beginDeviceFlow();
      return;
    }

    if (input.toLowerCase() === 'o') {
      void openVerificationUrl();
      return;
    }
  });

  const instructions = useMemo(() => {
    if (!deviceFlow) {
      return null;
    }
    const url = deviceFlow.verificationUriComplete ?? deviceFlow.verificationUri;
    return (
      <Box flexDirection="column">
        <Text>Visit the verification URL and enter this device code to continue.</Text>
        {url ? (
          <Box marginTop={compact ? 0 : 1}>
            <Link url={url}>{url}</Link>
          </Box>
        ) : null}
        <Box marginTop={compact ? 0 : 1}>
          <Text>
            Device code: <Text bold>{deviceFlow.userCode}</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press [o] to open the URL again.</Text>
        </Box>
      </Box>
    );
  }, [compact, deviceFlow]);

  const helpItems = useMemo(
    () => [
      { key: 'o', description: 'Open verification URL' },
      { key: 'r', description: 'Restart login flow' },
      { key: '?', description: 'Toggle help overlay' },
      { key: 'q / esc', description: 'Cancel login' },
    ],
    [],
  );

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 2} paddingY={1}>
      <BoxedPanel
        title="Sign in to Secrets Manager"
        subtitle={status === 'pending' ? 'Complete login in your browser' : undefined}
        width={compact ? 60 : 72}
        role="main"
        ariaLabel="Device flow login"
      >
        {instructions}
      </BoxedPanel>

      {status === 'starting' || status === 'pending' ? (
        <Box marginTop={1}>
          <Spinner
            tone="info"
            label={screenReader ? 'Waiting for login confirmation' : 'Waiting for you to confirm login in the browser…'}
            persistLabel
          />
        </Box>
      ) : null}

      {status === 'expired' || status === 'error' ? (
        <Box marginTop={1}>
          <ErrorNotice
            title={status === 'expired' ? 'Device code expired' : 'Login failed'}
            message={errorMessage ?? ''}
            onRetry={() => beginDeviceFlow()}
          />
        </Box>
      ) : null}

      {status === 'success' && successResult ? (
        <Box marginTop={1}>
          <Text color="green" role="status">
            Logged in as {successResult.user.email ?? successResult.user.id}. Closing…
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <KeyHelp items={helpItems} visible={showHelp} />
      </Box>
    </Box>
  );
};
