import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';
export const CONFIG_DIRECTORY = path.join(os.homedir(), '.secretsmgr');
export const CONFIG_FILE = path.join(CONFIG_DIRECTORY, 'config.json');
export const SESSION_FILE = path.join(CONFIG_DIRECTORY, 'session.json');

export interface LocalConfig {
  apiBaseUrl?: string;
  deviceId?: string;
}

let runtimeApiBaseUrl: string | undefined;
let cachedConfig: LocalConfig | null = null;
let configLoaded = false;

export const ensureConfigDirectory = async () => {
  await fs.mkdir(CONFIG_DIRECTORY, { recursive: true, mode: 0o700 });
};

const readConfigFromDisk = async (): Promise<LocalConfig> => {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LocalConfig;
    return parsed ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    console.warn('[config] Failed to read config.json, falling back to defaults:', error);
    return {};
  }
};

const writeConfigToDisk = async (config: LocalConfig): Promise<void> => {
  await ensureConfigDirectory();
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, payload, { mode: 0o600 });
};

const ensureConfigLoaded = async (): Promise<void> => {
  if (configLoaded) {
    return;
  }

  cachedConfig = await readConfigFromDisk();
  configLoaded = true;
};

export const setRuntimeApiBaseUrl = (url?: string) => {
  runtimeApiBaseUrl = url?.trim() || undefined;
};

export const getApiBaseUrl = async (): Promise<string> => {
  if (runtimeApiBaseUrl) {
    return runtimeApiBaseUrl;
  }

  const envUrl = process.env.SECRETS_API?.trim();
  if (envUrl) {
    return envUrl;
  }

  await ensureConfigLoaded();
  return cachedConfig?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
};

export const persistApiBaseUrl = async (url?: string) => {
  await ensureConfigLoaded();
  const nextConfig: LocalConfig = {
    ...(cachedConfig ?? {}),
    apiBaseUrl: url || undefined,
  };
  cachedConfig = nextConfig;
  await writeConfigToDisk(cachedConfig);
};

export const getDeviceId = async (): Promise<string> => {
  await ensureConfigLoaded();
  if (cachedConfig?.deviceId) {
    return cachedConfig.deviceId;
  }

  const generated = crypto.randomUUID();
  const nextConfig: LocalConfig = {
    ...(cachedConfig ?? {}),
    deviceId: generated,
  };
  cachedConfig = nextConfig;
  await writeConfigToDisk(nextConfig);
  return generated;
};

export const setDeviceId = async (deviceId: string | undefined) => {
  await ensureConfigLoaded();
  const nextConfig: LocalConfig = { ...(cachedConfig ?? {}) };
  if (!deviceId) {
    if (nextConfig.deviceId) {
      delete nextConfig.deviceId;
      cachedConfig = nextConfig;
      await writeConfigToDisk(nextConfig);
    }
    return;
  }

  nextConfig.deviceId = deviceId;
  cachedConfig = nextConfig;
  await writeConfigToDisk(nextConfig);
};

export const resetCachedConfig = () => {
  cachedConfig = null;
  configLoaded = false;
};

export const getConfigFilePath = () => CONFIG_FILE;
export const getSessionFilePath = () => SESSION_FILE;
export const getConfigDirectoryPath = () => CONFIG_DIRECTORY;
