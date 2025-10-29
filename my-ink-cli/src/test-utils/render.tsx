import React from 'react';
import {EventEmitter} from 'node:events';
import {render as inkRender, type Instance} from 'ink';
import {RouterContext, type Route} from '../app/Router.js';
import {AppServicesContext, type AppServices} from '../app/App.js';
import {type SessionSnapshot} from '../state/session.js';
import {ApiClient} from '../api/client.js';
import {vi} from 'vitest';

class TestStdout extends EventEmitter {
  frames: string[] = [];
  private _lastFrame?: string;

  write(frame: string) {
    this.frames.push(frame);
    this._lastFrame = frame;
  }

  lastFrame = () => this._lastFrame;

  get columns() {
    return 100;
  }
}

class TestStderr extends EventEmitter {
  frames: string[] = [];
  private _lastFrame?: string;

  write(frame: string) {
    this.frames.push(frame);
    this._lastFrame = frame;
  }

  lastFrame = () => this._lastFrame;
}

class TestStdin extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  isTTY = true;
  private buffer: string[] = [];

  write(data: string) {
    this.buffer.push(data);
    this.emit('data', data);
    this.emit('readable');
  }

  read() {
    return this.buffer.shift() ?? null;
  }

  setEncoding() {}

  setRawMode() {}

  resume() {}

  pause() {}

  ref() {}

  unref() {}
}

interface InkRenderResult {
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
  cleanup: () => void;
  waitUntilExit: Instance['waitUntilExit'];
  stdout: TestStdout;
  stderr: TestStderr;
  stdin: TestStdin;
  frames: string[];
  lastFrame: () => string | undefined;
}

const renderInk = (tree: React.ReactElement): InkRenderResult => {
  const stdout = new TestStdout();
  const stderr = new TestStderr();
  const stdin = new TestStdin();

  const instance: Instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    debug: true,
    exitOnCtrlC: false,
  });

  return {
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
    waitUntilExit: instance.waitUntilExit,
    stdout,
    stderr,
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame
  };
};

export interface RenderOptionsWithProviders {
  route?: Route;
  session?: SessionSnapshot;
  services?: Partial<AppServices>;
}

const createDefaultSession = (): SessionSnapshot => ({
  serverUrl: 'http://localhost:4000',
  deviceId: 'device-1',
  accessToken: undefined,
  accessTokenExpiresAt: undefined,
  refreshToken: undefined,
  user: null
});

const createRouter = (route: Route) => {
  const router = {
    stack: [route],
    route,
    push: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    reset: vi.fn()
  };
  return router;
};

const noop = () => undefined;

export const renderWithProviders = (
  node: React.ReactElement,
  {route = {name: 'HOME'}, session = createDefaultSession(), services = {}}: RenderOptionsWithProviders = {}
) => {
  const router = createRouter(route);
  const defaultServices: AppServices = {
    session,
    updateSession: noop,
    clearSession: noop,
    resetSession: noop,
    client: new ApiClient(),
    notify: vi.fn(),
    setEditing: noop,
    isScreenReader: false,
    setEscapeHandler: noop
  };

  const mergedServices: AppServices = {...defaultServices, ...services};

  const rendered = renderInk(
    <RouterContext.Provider value={router}>
      <AppServicesContext.Provider value={mergedServices}>{node}</AppServicesContext.Provider>
    </RouterContext.Provider>
  );

  return Object.assign(rendered, {router, services: mergedServices});
};
