import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'packages/cli/vitest.cli.config.ts',
      'apps/*/vitest.config.ts',
    ],
  },
});
