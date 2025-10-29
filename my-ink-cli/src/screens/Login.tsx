import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import InkLink from 'ink-link';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {startDeviceFlow, pollDeviceFlow} from '../api/auth.js';
import {userSchema, type DeviceStartResponse} from '../types/dto.js';
import {openInBrowser} from '../utils/open.js';

const Login: React.FC = () => {
  const {session, updateSession, notify, client, setEditing} = useAppServices();
  const router = useRouter();
  const [flow, setFlow] = useState<DeviceStartResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'pending' | 'expired' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimers = () => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const beginCountdown = (expiresIn: number) => {
    setTimeRemaining(expiresIn);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    countdownRef.current = setInterval(() => {
      setTimeRemaining((current) => (current && current > 0 ? current - 1 : 0));
    }, 1000);
  };

  const pollForApproval = useCallback(
    async (device: DeviceStartResponse) => {
      clearTimeout(pollingRef.current ?? undefined);
      try {
        const result = await pollDeviceFlow(client, {deviceCode: device.deviceCode, deviceId: session.deviceId}, device.pollIntervalSec);
        if (result.status === 'PENDING') {
          pollingRef.current = setTimeout(() => pollForApproval(device), device.pollIntervalSec * 1000);
          return;
        }

        if (result.status === 'SUCCESS') {
          clearTimers();
          const {payload} = result;
          const normalizedUser = userSchema.parse(payload.user);
          updateSession({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            user: {
              ...normalizedUser,
              teams: normalizedUser.teams ?? []
            }
          });
          notify(`Signed in as ${payload.user.displayName ?? payload.user.email}`, 'success');
          router.replace('HOME');
          return;
        }

        if (result.status === 'EXPIRED') {
          clearTimers();
          setStatus('expired');
          notify(result.message, 'error');
        }
      } catch (error) {
        notify(`Polling failed: ${(error as Error).message}`, 'error');
        setStatus('error');
      }
    },
    [client, session.deviceId, updateSession, notify, router]
  );

  const start = useCallback(async () => {
    clearTimers();
    setFlow(null);
    setError(null);
    setStatus('starting');
    try {
      const response = await startDeviceFlow(client);
      setFlow(response);
      setStatus('pending');
      beginCountdown(response.expiresIn);
      pollingRef.current = setTimeout(() => {
        void pollForApproval(response);
      }, response.pollIntervalSec * 1000);
    } catch (cause) {
      setError((cause as Error).message);
      setStatus('error');
      notify(`Unable to start device flow: ${(cause as Error).message}`, 'error');
    }
  }, [client, notify, pollForApproval]);

  useEffect(() => {
    setEditing(false);
    start();
    return () => {
      clearTimers();
    };
  }, [start, setEditing]);

  useInput((input: string) => {
    if (input === 'r') {
      start().catch(() => undefined);
      return;
    }

    if (input === 'o' && flow) {
      const url = flow.verificationUriComplete ?? flow.verificationUri;
      openInBrowser(url).catch((error) => {
        notify(`Unable to open browser: ${(error as Error).message}`, 'error');
      });
      return;
    }

    if (input === 'c' && flow) {
      notify(`User code: ${flow.userCode}`, 'info');
    }
  });

  useEffect(() => () => clearTimers(), []);

  const renderStatus = () => {
    if (status === 'starting') {
      return <Spinner label="Requesting device code" />;
    }

    if (status === 'pending' && flow) {
      return (
        <Box flexDirection="column">
          <Text color="gray">Waiting for approval... {timeRemaining ?? 0}s</Text>
          <Spinner label="Polling" />
        </Box>
      );
    }

    if (status === 'expired') {
      return <Text color="yellow">Code expired. Press r to restart the login flow.</Text>;
    }

    if (status === 'error') {
      return <Text color="red">{error ?? 'Failed to start login flow'}</Text>;
    }

    return null;
  };

  return (
    <Box flexDirection="column">
      <Text color="cyan">Authenticate via your browser</Text>
      {flow ? (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1} width={60}>
          <Text>1. Visit:</Text>
          <InkLink url={flow.verificationUriComplete ?? flow.verificationUri}>
            {flow.verificationUriComplete ?? flow.verificationUri}
          </InkLink>
          <Box marginTop={1}>
            <Text>2. Enter this code:</Text>
          </Box>
          <Box borderStyle="single" borderColor="magenta" paddingX={2} paddingY={1} marginTop={1}>
            <Text color="magenta">{flow.userCode}</Text>
          </Box>
        </Box>
      ) : null}
      <Box marginTop={1}>{renderStatus()}</Box>
      <Box marginTop={1}>
        <KeyLegend
          items={[
            {key: 'o', description: 'Open verification URL'},
            {key: 'c', description: 'Show code for copying'},
            {key: 'r', description: 'Restart login'},
            {key: 'Esc', description: 'Cancel and go back'}
          ]}
        />
      </Box>
    </Box>
  );
};

export default Login;
