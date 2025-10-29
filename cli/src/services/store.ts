import crypto from 'node:crypto';
import { create } from 'zustand';

import { DEFAULT_API_BASE_URL } from './config.js';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  durationMs?: number;
  createdAt: number;
  persistent?: boolean;
}

export interface StaticLogEntry {
  id: string;
  message: string;
  kind: ToastKind;
  timestamp: number;
}

export interface OrgUser {
  id: string;
  email: string;
  name?: string;
  isAdmin?: boolean;
}

export interface OrgTeam {
  id: string;
  name: string;
  memberCount: number;
  description?: string;
}

export interface DirectoryCache {
  users?: {
    data: OrgUser[];
    fetchedAt: number;
  };
  teams?: {
    data: OrgTeam[];
    fetchedAt: number;
  };
}

type DirectoryCacheKey = keyof DirectoryCache;
type DirectoryCachePayload<K extends DirectoryCacheKey> = DirectoryCache[K] extends {
  data: infer T;
}
  ? T
  : never;

export interface AuthSession {
  accessToken?: string;
  refreshToken?: string;
  deviceId?: string;
  accessTokenExpiresAt?: number;
  user?: OrgUser | null;
}

export interface AppState {
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;

  accessToken?: string;
  refreshToken?: string;
  deviceId?: string;
  accessTokenExpiresAt?: number;
  user: OrgUser | null;

  setSession: (session: AuthSession) => void;
  updateAccessToken: (token: string, expiresAt?: number) => void;
  clearSession: () => void;

  directoryCache: DirectoryCache;
  updateDirectoryCache: <K extends DirectoryCacheKey>(key: K, data: DirectoryCachePayload<K>) => void;
  clearDirectoryCache: () => void;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id' | 'createdAt'> & { id?: string }) => Toast;
  dismissToast: (id: string) => void;
  clearToasts: () => void;

  staticLog: StaticLogEntry[];
  appendStaticLog: (entry: Omit<StaticLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => StaticLogEntry;

  isScreenReaderEnabled: boolean;
  setScreenReaderEnabled: (enabled: boolean) => void;
}

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
};

export const useAppStore = create<AppState>((set, get) => ({
  apiBaseUrl: DEFAULT_API_BASE_URL,
  setApiBaseUrl: (url) => {
    set({ apiBaseUrl: url });
  },

  accessToken: undefined,
  refreshToken: undefined,
  deviceId: undefined,
  accessTokenExpiresAt: undefined,
  user: null,

  setSession: (session) => {
    set({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      deviceId: session.deviceId,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      user: session.user ?? null,
    });
  },
  updateAccessToken: (token, expiresAt) => {
    set({ accessToken: token, accessTokenExpiresAt: expiresAt });
  },
  clearSession: () => {
    set({ accessToken: undefined, refreshToken: undefined, deviceId: undefined, accessTokenExpiresAt: undefined, user: null });
  },

  directoryCache: {},
  updateDirectoryCache: (key, data) => {
    set((state) => ({
      directoryCache: {
        ...state.directoryCache,
        [key]: {
          data,
          fetchedAt: Date.now(),
        },
      } as DirectoryCache,
    }));
  },
  clearDirectoryCache: () => {
    set({ directoryCache: {} });
  },

  toasts: [],
  pushToast: ({ id, kind, message, detail, durationMs, persistent = false }) => {
    const toast: Toast = {
      id: id ?? generateId(),
      kind,
      message,
      detail,
      durationMs,
      persistent,
      createdAt: Date.now(),
    };
    set((state) => ({ toasts: [...state.toasts.filter((item) => item.id !== toast.id), toast] }));
    return toast;
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  clearToasts: () => {
    set({ toasts: [] });
  },

  staticLog: [],
  appendStaticLog: ({ id, message, kind, timestamp }) => {
    const entry: StaticLogEntry = {
      id: id ?? generateId(),
      message,
      kind,
      timestamp: timestamp ?? Date.now(),
    };
    set((state) => ({ staticLog: [...state.staticLog, entry] }));
    return entry;
  },

  isScreenReaderEnabled: false,
  setScreenReaderEnabled: (enabled) => set({ isScreenReaderEnabled: enabled }),
}));

export const getAppState = () => useAppStore.getState();

export const resetAppStore = () => {
  useAppStore.setState({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    accessToken: undefined,
    refreshToken: undefined,
    deviceId: undefined,
    accessTokenExpiresAt: undefined,
    user: null,
    directoryCache: {},
    toasts: [],
    staticLog: [],
    isScreenReaderEnabled: false,
  });
};
