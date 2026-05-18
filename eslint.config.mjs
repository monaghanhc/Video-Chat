import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/.vite/**',
      'vitest.config.ts',
      'vitest.setup.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: [
          './packages/shared/tsconfig.json',
          './apps/server/tsconfig.json',
          './apps/desktop/tsconfig.json',
          './apps/desktop/tsconfig.electron.json'
        ],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  },
  {
    files: ['apps/server/**/*.ts', 'apps/desktop/electron/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['apps/desktop/public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker
      }
    }
  }
);
