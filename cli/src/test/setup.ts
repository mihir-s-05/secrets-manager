import { afterEach, vi } from 'vitest';
import { cleanup } from 'ink-testing-library';

import { resetAppStore } from '../services/store.js';

afterEach(() => {
  cleanup();
  resetAppStore();
  vi.clearAllMocks();
  vi.useRealTimers();
});
