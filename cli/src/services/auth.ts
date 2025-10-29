import fs from 'node:fs/promises';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

import {
  ensureConfigDirectory,
  getDeviceId as getConfigDeviceId,
  getSessionFilePath,
  setDeviceId as setConfigDeviceId,
} from './config.js';
import { AuthSession, OrgUser, getAppState, useAppStore } from './store.js';

export const KEYTAR_SERVICE = 'secretsmgr';
export const KEYTAR_ACCOUNT = 'default';
const SESSION_FILE = getSessionFilePath();

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface DeviceFlowStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  pollIntervalSec: number;
  interval?: number;
  deviceId?: string;
}

export interface DeviceFlowPollResult {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  accessTokenExpiresIn?: number;
  user: OrgUser;
}

export class DeviceFlowExpiredError extends Error {
  constructor(message = 'Device flow session expired') {
    super(message);
    this.name = 'DeviceFlowExpiredError';
  }
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
  deviceId?: string;
  accessTokenExpiresIn?: number;
  user?: OrgUser;
}

interface PersistedSession {
  refreshToken: string;
  deviceId?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  user?: OrgUser | null;
}

let keytarModulePromise: Promise<KeytarModule | null> | null = null;
let cachedSession: PersistedSession | null = null;
let refreshInFlight: Promise<AuthSession | null> | null = null;

const loadKeytar = async (): Promise<KeytarModule | null> => {
  if (process.env.SECRETS_DISABLE_KEYTAR === '1') {
    return null;
  }

  if (!keytarModulePromise) {
    keytarModulePromise = import('keytar')
      .then((mod) => (mod.default ?? mod) as KeytarModule)
      .catch((error) => {
        console.warn('[auth] keytar unavailable, using file fallback:', error);
        return null;
      });
  }

  const module = await keytarModulePromise;
  return module ?? null;
};

const readSessionFromFile = async (): Promise<PersistedSession | null> => {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    return JSON.parse(raw) as PersistedSession;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    console.warn('[auth] Failed to read session file:', error);
    return null;
  }
};

const writeSessionToFile = async (session: PersistedSession) => {
  await ensureConfigDirectory();
  const payload = JSON.stringify(session, null, 2);
  await fs.writeFile(SESSION_FILE, payload, { mode: 0o600 });
};

const deleteSessionFile = async () => {
  try {
    await fs.rm(SESSION_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[auth] Failed to remove session file:', error);
    }
  }
};

const readSessionFromKeytar = async (): Promise<PersistedSession | null> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return null;
  }

  try {
    const content = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    if (!content) {
      return null;
    }
    return JSON.parse(content) as PersistedSession;
  } catch (error) {
    console.warn('[auth] Failed to read session from keytar:', error);
    return null;
  }
};

const writeSessionToKeytar = async (session: PersistedSession) => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }

  try {
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(session));
    return true;
  } catch (error) {
    console.warn('[auth] Failed to persist session to keytar:', error);
    return false;
  }
};

const deleteSessionFromKeytar = async () => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }

  try {
    await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    return true;
  } catch (error) {
    console.warn('[auth] Failed to remove session from keytar:', error);
    return false;
  }
};

const toAuthSession = (session: PersistedSession | null): AuthSession | null => {
  if (!session) {
    return null;
  }

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    deviceId: session.deviceId,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    user: session.user ?? null,
  } satisfies AuthSession;
};

const mergeSession = (session: PersistedSession, partial: Partial<PersistedSession>): PersistedSession => ({
  ...session,
  ...partial,
});

export const getStoredSession = async (): Promise<AuthSession | null> => {
  if (cachedSession) {
    return toAuthSession(cachedSession);
  }

  const sessionFromKeytar = await readSessionFromKeytar();
  const session = sessionFromKeytar ?? (await readSessionFromFile());
  cachedSession = session;
  return toAuthSession(session);
};

export const persistSession = async (session: AuthSession) => {
  if (!session.refreshToken) {
    throw new Error('Cannot persist session without a refresh token');
  }

  const persisted: PersistedSession = {
    refreshToken: session.refreshToken,
    deviceId: session.deviceId,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    user: session.user ?? null,
  };

  cachedSession = persisted;

  const storedInKeytar = await writeSessionToKeytar(persisted);
  if (storedInKeytar) {
    await deleteSessionFile();
  } else {
    await writeSessionToFile(persisted);
  }

  useAppStore.getState().setSession(session);
};

export const clearSession = async () => {
  cachedSession = null;
  await deleteSessionFromKeytar();
  await deleteSessionFile();
  useAppStore.getState().clearSession();
};

export const hydrateSession = async () => {
  const session = await getStoredSession();
  if (session) {
    useAppStore.getState().setSession(session);
  }
};

const getRefreshContext = async (): Promise<{
  refreshToken: string | undefined;
  deviceId: string;
}> => {
  const state = getAppState();
  let refreshToken = state.refreshToken;
  let deviceId = state.deviceId;

  if (!refreshToken || !deviceId) {
    const stored = await getStoredSession();
    refreshToken = refreshToken ?? stored?.refreshToken;
    deviceId = deviceId ?? stored?.deviceId ?? (await getConfigDeviceId());
  }

  return { refreshToken, deviceId: deviceId ?? (await getConfigDeviceId()) };
};

export const refreshAccessToken = async (client: AxiosInstance): Promise<AuthSession | null> => {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const { refreshToken, deviceId } = await getRefreshContext();
    if (!refreshToken || !deviceId) {
      return null;
    }

    try {
      const response = await client.post<RefreshResponse>('/auth/refresh', {
        refreshToken,
        deviceId,
      });

      const data = response.data;
      const session: AuthSession = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? refreshToken,
        deviceId: data.deviceId ?? deviceId,
        accessTokenExpiresAt: data.accessTokenExpiresIn
          ? Date.now() + data.accessTokenExpiresIn * 1000
          : undefined,
        user: data.user ?? getAppState().user,
      };

      await persistSession(session);
      if (data.deviceId && data.deviceId !== deviceId) {
        await setConfigDeviceId(data.deviceId);
      }

      return session;
    } catch (error) {
      await clearSession();
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
};

export const startDeviceFlow = async (
  client: AxiosInstance,
  options: { deviceId?: string } = {},
): Promise<DeviceFlowStartResponse> => {
  const deviceId = options.deviceId ?? (await getConfigDeviceId());
  const response = await client.post<DeviceFlowStartResponse>('/auth/start', {
    deviceId,
  });

  const payload = response.data;

  if ((payload as { deviceId?: string }).deviceId && payload.deviceId !== deviceId) {
    await setConfigDeviceId(payload.deviceId);
  }

  const pollIntervalSec = payload.pollIntervalSec ?? payload.interval ?? 5;

  return {
    ...payload,
    pollIntervalSec,
  };
};

const isApiError = (error: unknown): error is { status?: number } =>
  typeof error === 'object' && error !== null && 'status' in error;

export const pollDeviceFlow = async (
  client: AxiosInstance,
  params: { deviceCode: string; deviceId?: string; signal?: AbortSignal },
): Promise<DeviceFlowPollResult | null> => {
  const deviceId = params.deviceId ?? (await getConfigDeviceId());
  try {
    const response = await client.post<DeviceFlowPollResult>(
      '/auth/poll',
      {
        deviceCode: params.deviceCode,
        deviceId,
      },
      {
        signal: params.signal,
      },
    );

    const result = response.data;

    const session: AuthSession = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      deviceId: result.deviceId ?? deviceId,
      accessTokenExpiresAt: result.accessTokenExpiresIn
        ? Date.now() + result.accessTokenExpiresIn * 1000
        : undefined,
      user: result.user,
    };

    await setConfigDeviceId(session.deviceId);
    await persistSession(session);

    return result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 428) {
        return null;
      }
      // Treat server-side rate limiting as a pending state; the caller will wait and retry
      if (status === 429) {
        return null;
      }
      if (status === 401) {
        throw new DeviceFlowExpiredError();
      }
    }
    if (isApiError(error)) {
      const status = typeof error.status === 'number' ? error.status : undefined;
      if (status === 428 || status === 429) {
        return null;
      }
      if (status === 401) {
        throw new DeviceFlowExpiredError();
      }
    }
    throw error;
  }
};

export const logout = async (client: AxiosInstance): Promise<void> => {
  const stored = await getStoredSession();
  const refreshToken = stored?.refreshToken ?? getAppState().refreshToken;

  try {
    if (refreshToken) {
      await client.post('/auth/logout', { refreshToken });
    } else {
      await client.post('/auth/logout');
    }
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status && status >= 500) {
      throw error;
    }
    // Ignore client errors; we still clear local state below.
  }

  await clearSession();
};

export const getCurrentUser = (): OrgUser | null => getAppState().user;

export const updateSessionUser = (user: OrgUser | null) => {
  const state = useAppStore.getState();
  const session: AuthSession = {
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    deviceId: state.deviceId,
    accessTokenExpiresAt: state.accessTokenExpiresAt,
    user,
  };

  state.setSession(session);
  if (cachedSession) {
    cachedSession = mergeSession(cachedSession, { user });
  }
};
