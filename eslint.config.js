import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // ignore build output
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,

  // Prettier should be last so it can disable conflicting rules
  prettier,

  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // sensible TS defaults
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
];
