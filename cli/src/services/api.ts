import type { AxiosError, AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import axios, { AxiosHeaders } from 'axios';

import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  persistApiBaseUrl,
  setRuntimeApiBaseUrl,
} from './config.js';
import { refreshAccessToken } from './auth.js';
import { getAppState, useAppStore } from './store.js';
import pkg from '../../package.json';

const CLI_VERSION = pkg.version ?? 'dev';
const CLI_NAME = pkg.name ?? 'secrets-cli';

export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly details?: unknown;
  readonly original?: AxiosError;

  constructor(args: { message: string; status?: number; code?: string; details?: unknown; original?: AxiosError }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.code = args.code ?? `HTTP_${args.status ?? 'ERR'}`;
    this.details = args.details;
    this.original = args.original;
  }
}

let apiClient: AxiosInstance | null = null;

const buildUserAgentHeader = () => `${CLI_NAME}/${CLI_VERSION} (Node ${process.version})`;

const ensureAxiosHeaders = (headers: InternalAxiosRequestConfig['headers']): AxiosHeaders => {
  if (headers instanceof AxiosHeaders) {
    return headers;
  }

  return AxiosHeaders.from(headers ?? {});
};

const withAuthorization = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const state = getAppState();
  const headers = ensureAxiosHeaders(config.headers);

  if (state.accessToken) {
    headers.set('Authorization', `Bearer ${state.accessToken}`);
  } else {
    headers.delete('Authorization');
  }

  if (state.deviceId) {
    headers.set('x-device-id', state.deviceId);
  }

  headers.set('x-cli-version', CLI_VERSION);
  headers.set('User-Agent', buildUserAgentHeader());
  headers.set('Accept', 'application/json');

  config.headers = headers;
  return config;
};

const shouldAttemptRefresh = (error: AxiosError): boolean => {
  const status = error.response?.status;
  const requestUrl = error.config?.url ?? '';
  if (status !== 401) {
    return false;
  }

  if (!error.config || (error.config as AxiosRequestConfig & { _retry?: boolean })._retry) {
    return false;
  }

  if (requestUrl.includes('/auth/refresh') || requestUrl.includes('/auth/start') || requestUrl.includes('/auth/poll')) {
    return false;
  }

  return true;
};

const markRequestRetried = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  (config as InternalAxiosRequestConfig & { _retry?: boolean })._retry = true;
  return config;
};

const createApiError = (error: AxiosError | unknown, fallback?: AxiosError): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }

  const axiosError = (axios.isAxiosError(error) ? error : undefined) ?? (fallback && axios.isAxiosError(fallback) ? fallback : undefined);
  if (!axiosError) {
    return new ApiError({ message: (error as Error)?.message ?? 'Unknown error' });
  }

  const status = axiosError.response?.status;
  const data = axiosError.response?.data as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
  const code = data?.error?.code ?? `HTTP_${status ?? 'ERR'}`;
  const message = data?.error?.message ?? axiosError.message;
  const details = data?.error?.details ?? data;

  return new ApiError({
    message,
    status,
    code,
    details,
    original: axiosError,
  });
};

const installInterceptors = (client: AxiosInstance) => {
  client.interceptors.request.use(withAuthorization);
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const axiosError = error as AxiosError;
      if (!shouldAttemptRefresh(axiosError) || !apiClient) {
        throw createApiError(axiosError);
      }

      try {
        const refreshed = await refreshAccessToken(apiClient);
        if (!refreshed?.accessToken) {
          throw createApiError(axiosError);
        }

        const requestConfig = markRequestRetried(axiosError.config as InternalAxiosRequestConfig);
        const headers = ensureAxiosHeaders(requestConfig.headers);
        headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
        requestConfig.headers = headers;

        return apiClient(requestConfig);
      } catch (refreshError) {
        throw createApiError(refreshError, axiosError);
      }
    },
  );
};

export interface ApiClientOptions {
  baseUrl?: string;
  persist?: boolean;
}

export const initApiClient = async (options: ApiClientOptions = {}): Promise<AxiosInstance> => {
  const baseUrl = options.baseUrl ?? (await getApiBaseUrl()) ?? DEFAULT_API_BASE_URL;
  setRuntimeApiBaseUrl(baseUrl);

  if (apiClient) {
    apiClient.defaults.baseURL = baseUrl;
  } else {
    apiClient = axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': buildUserAgentHeader(),
      },
    });
    installInterceptors(apiClient);
  }

  if (options.persist) {
    await persistApiBaseUrl(baseUrl);
  }

  useAppStore.getState().setApiBaseUrl(baseUrl);
  return apiClient;
};

export const getApiClient = (): AxiosInstance => {
  if (!apiClient) {
    throw new Error('API client has not been initialized');
  }
  return apiClient;
};

export const resetApiClient = () => {
  apiClient = null;
};

export const normalizeApiError = (error: unknown) => createApiError(error);
