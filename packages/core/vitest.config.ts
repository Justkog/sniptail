import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(__dirname, '../../tsconfig.json')] })],
  resolve: {
    alias: [
      {
        find: /^@sniptail\/core\/(.*)\.js$/,
        replacement: resolve(__dirname, '../../packages/core/src/$1.ts'),
      },
      {
        find: /^@sniptail\/core\/(.*)$/,
        replacement: resolve(__dirname, '../../packages/core/src/$1'),
      },
      {
        find: '@sniptail/core',
        replacement: resolve(__dirname, '../../packages/core/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/dist/**'],
    setupFiles: ['./tests/setup.ts'],
  },
});
