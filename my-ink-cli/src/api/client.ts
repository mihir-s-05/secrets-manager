import {type SessionSnapshot, sessionStore} from '../state/session.js';
import {refreshResponseSchema} from '../types/dto.js';
import type {ZodSchema} from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  schema?: ZodSchema<T>;
  allowedStatuses?: number[];
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
  skipAuthRefresh?: boolean;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

interface SessionStoreLike {
  getSnapshot: () => SessionSnapshot;
  update: (update: Partial<SessionSnapshot>) => void;
  clearTokens: () => void;
}

const parseJsonSafe = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export class ApiClient {
  private readonly session: SessionStoreLike;
  private refreshPromise?: Promise<string | null>;

  constructor(store: SessionStoreLike = sessionStore) {
    this.session = store;
  }

  private getBaseUrl(): string {
    const snapshot = this.session.getSnapshot();
    return snapshot.serverUrl.endsWith('/')
      ? snapshot.serverUrl.slice(0, -1)
      : snapshot.serverUrl;
  }

  async request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<ApiResponse<T>> {
    const {method = 'GET', schema, allowedStatuses = [], skipAuthRefresh = false, signal} = options;
    const serializedBody = this.serializeBody(options.body);
    const attemptHeaders = options.headers ? {...options.headers} : {};

    const perform = async (retrying: boolean): Promise<ApiResponse<T>> => {
      const snapshot = this.session.getSnapshot();
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...attemptHeaders
      };

      if (serializedBody !== undefined) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }

      if (snapshot.accessToken) {
        headers.Authorization = `Bearer ${snapshot.accessToken}`;
      }

      const url = this.buildUrl(path, options.query);
      const response = await fetch(url, {
        method,
        headers,
        body: serializedBody,
        signal
      });

      if (response.status === 401 && !retrying && !skipAuthRefresh) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return perform(true);
        }
      }

      const consideredOk = response.ok || allowedStatuses.includes(response.status);
      const payload = response.status === 204 ? undefined : await parseJsonSafe(response);

      if (!consideredOk) {
        const {message, code} = this.extractError(payload, response);
        throw new ApiError(response.status, code, message, payload);
      }

      const shouldParse = schema && payload !== undefined && response.ok;
      const data = shouldParse ? schema.parse(payload) : (payload as T);
      return {status: response.status, data: data as T};
    };

    return perform(false);
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = this.getBaseUrl();
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private serializeBody(body: unknown): string | undefined {
    if (body === undefined || body === null) {
      return undefined;
    }

    if (typeof body === 'string') {
      return body;
    }

    return JSON.stringify(body);
  }

  private extractError(payload: unknown, response: Response): {code: string | null; message: string} {
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const {error} = payload as {error?: {code?: string; message?: string}};
      return {
        code: error?.code ?? null,
        message: error?.message ?? response.statusText
      };
    }

    return {
      code: null,
      message: response.statusText || `Request failed (${response.status})`
    };
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const snapshot = this.session.getSnapshot();
    if (!snapshot.refreshToken || !snapshot.deviceId) {
      this.session.clearTokens();
      return null;
    }

    this.refreshPromise = (async () => {
      try {
        const url = this.buildUrl('/auth/refresh');
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({
            refreshToken: snapshot.refreshToken,
            deviceId: snapshot.deviceId
          })
        });

        if (!response.ok) {
          this.session.clearTokens();
          return null;
        }

        const payload = await parseJsonSafe(response);
        const data = refreshResponseSchema.parse(payload);
        this.session.update({accessToken: data.accessToken});
        return data.accessToken;
      } catch {
        this.session.clearTokens();
        return null;
      } finally {
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }
}

export const apiClient = new ApiClient();
