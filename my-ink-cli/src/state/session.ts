import Conf from 'conf';
import {randomUUID} from 'node:crypto';
import {User} from '../types/dto.js';

export interface SessionSnapshot {
  serverUrl: string;
  deviceId: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  user?: User | null;
  viewAsUserId?: string;
  viewAsUserName?: string;
}

const DEFAULT_SERVER_URL = 'http://localhost:4000';

const conf = new Conf<SessionSnapshot>({
  projectName: 'secrets-cli'
});

if (!conf.has('serverUrl')) {
  conf.set('serverUrl', DEFAULT_SERVER_URL);
}

if (!conf.has('deviceId')) {
  conf.set('deviceId', randomUUID());
}

const listeners = new Set<(snapshot: SessionSnapshot) => void>();

const getSnapshot = (): SessionSnapshot => {
  const snapshot = {
    serverUrl: conf.get('serverUrl') ?? DEFAULT_SERVER_URL,
    deviceId: conf.get('deviceId') ?? randomUUID(),
    accessToken: conf.get('accessToken'),
    accessTokenExpiresAt: conf.get('accessTokenExpiresAt'),
    refreshToken: conf.get('refreshToken'),
    user: conf.get('user') ?? null,
    viewAsUserId: conf.get('viewAsUserId'),
    viewAsUserName: conf.get('viewAsUserName')
  } as SessionSnapshot;

  return snapshot;
};

const emit = () => {
  const snapshot = getSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
};

export const sessionStore = {
  getSnapshot,
  subscribe(listener: (snapshot: SessionSnapshot) => void) {
    listeners.add(listener);
    listener(getSnapshot());
    return () => {
      listeners.delete(listener);
    };
  },
  update(update: Partial<SessionSnapshot>) {
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) {
        conf.delete(key as keyof SessionSnapshot);
      } else {
        conf.set(key as keyof SessionSnapshot, value as never);
      }
    }
    emit();
  },
  clearTokens() {
    conf.delete('accessToken');
    conf.delete('accessTokenExpiresAt');
    conf.delete('refreshToken');
    conf.delete('user');
    emit();
  },
  reset() {
    const preservedServerUrl = conf.get('serverUrl') ?? DEFAULT_SERVER_URL;
    const preservedDeviceId = conf.get('deviceId') ?? randomUUID();
    conf.clear();
    conf.set('serverUrl', preservedServerUrl);
    conf.set('deviceId', preservedDeviceId);
    emit();
  }
};

export type SessionListener = Parameters<typeof sessionStore.subscribe>[0];

export const isAuthenticated = (snapshot: SessionSnapshot): boolean =>
  Boolean(snapshot.accessToken && snapshot.refreshToken);

export const hasAdminAccess = (snapshot: SessionSnapshot): boolean =>
  Boolean(snapshot.user?.isAdmin);
