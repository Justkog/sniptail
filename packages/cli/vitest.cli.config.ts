import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(__dirname, '../../tsconfig.json')] })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/dist/**'],
  },
});
