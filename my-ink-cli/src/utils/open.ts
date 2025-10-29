import {execFile} from 'node:child_process';
import {platform} from 'node:process';
import {readFileSync} from 'node:fs';

type CommandSpec = {
  command: string;
  args: string[];
};

const runCommand = (spec: CommandSpec): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = execFile(spec.command, spec.args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    child.on('error', reject);
  });

const parseBrowserEnv = (target: string): CommandSpec | null => {
  const value = process.env.BROWSER?.trim();
  if (!value) {
    return null;
  }

  const parts = value.split(/\s+/u);
  if (parts.length === 0) {
    return null;
  }

  return {
    command: parts[0] ?? '',
    args: [...parts.slice(1), target]
  };
};

/**
 * Detects if running in WSL (Windows Subsystem for Linux)
 */
const isWSL = (): boolean => {
  if (platform !== 'linux') {
    return false;
  }

  // Check for WSL indicators
  try {
    // Check /proc/version for Microsoft/WSL
    const procVersion = readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (procVersion.includes('microsoft') || procVersion.includes('wsl')) {
      return true;
    }
  } catch {
    // If we can't read /proc/version, try checking for WSL_DISTRO_NAME env var
  }

  // Check environment variable
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }

  return false;
};

const linuxCandidates = (target: string): CommandSpec[] => {
  const candidates: CommandSpec[] = [];
  const envCommand = parseBrowserEnv(target);
  if (envCommand) {
    candidates.push(envCommand);
  }

  // If running in WSL, try using Windows cmd.exe to open browser
  if (isWSL()) {
    candidates.push({command: 'cmd.exe', args: ['/c', 'start', '', target]});
  }

  candidates.push(
    {command: 'xdg-open', args: [target]},
    {command: 'gio', args: ['open', target]},
    {command: 'gnome-open', args: [target]},
    {command: 'sensible-browser', args: [target]}
  );

  return candidates;
};

export const openInBrowser = async (target: string): Promise<void> => {
  const currentPlatform = platform;
  const attempts: CommandSpec[] =
    currentPlatform === 'darwin'
      ? [{command: 'open', args: [target]}]
      : currentPlatform === 'win32'
        ? [{command: 'cmd', args: ['/c', 'start', '', target]}]
        : linuxCandidates(target);

  const errors: Error[] = [];
  for (const spec of attempts) {
    try {
      await runCommand(spec);
      return;
    } catch (error) {
      errors.push(error as Error);
    }
  }

  const detail = errors.find((err) => 'code' in err && (err as {code?: string}).code === 'ENOENT');
  const isWslEnv = isWSL();
  const hint =
    currentPlatform === 'win32'
      ? 'Set the BROWSER environment variable or ensure Windows shell can locate your default browser.'
      : currentPlatform === 'darwin'
        ? 'Ensure the `open` command is available.'
        : isWslEnv
          ? 'On WSL, ensure cmd.exe is available, or set $BROWSER to a command that opens URLs in Windows.'
          : 'Install a browser opener (`xdg-open`, `gio`, or set $BROWSER) before using the shortcut.';

  const message = detail
    ? `No supported browser opener found. ${hint}`
    : `Failed to launch browser (${errors[errors.length - 1]?.message ?? 'unknown error'}).`;

  throw new Error(message);
};
