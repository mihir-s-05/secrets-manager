import React from 'react';
import { render } from 'ink';
import type { Command } from 'commander';

import { App, ScreenPropsWithClient } from '../app.js';

export interface RenderScreenOptions {
  command: Command;
  apiBaseUrl?: string;
}

export const getApiOption = (command: Command): string | undefined => {
  let cursor: Command | null = command;
  while (cursor?.parent) {
    cursor = cursor.parent;
  }
  const opts = cursor?.opts?.() ?? {};
  return typeof opts.api === 'string' ? opts.api : undefined;
};

export const renderScreen = async <TProps extends ScreenPropsWithClient>(
  Screen: React.ComponentType<TProps>,
  props: Omit<TProps, 'apiClient'>,
  options: RenderScreenOptions,
) => {
  const apiBaseUrl = options.apiBaseUrl ?? getApiOption(options.command);
  const instance = render(<App screen={Screen} screenProps={props as TProps} apiBaseUrl={apiBaseUrl} />);
  await instance.waitUntilExit?.();
};

export const handleCommandError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exitCode = 1;
};
