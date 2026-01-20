import { afterEach, beforeEach, vi } from 'vitest';

const BASE_ENV = {
  NODE_ENV: 'test',
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};

beforeEach(() => {
  process.env = { ...BASE_ENV };
});

afterEach(() => {
  vi.restoreAllMocks();
});
