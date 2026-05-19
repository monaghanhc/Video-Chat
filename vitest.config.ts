import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    environment: 'happy-dom',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/shared/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/desktop/src/lib/**/*.ts',
        'apps/desktop/src/components/Invite*.tsx'
      ],
      all: true,
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        'apps/server/src/index.ts',
        'apps/server/src/createServer.ts',
        'apps/server/src/socketHandlers.ts',
        'apps/desktop/src/main.tsx',
        'apps/desktop/src/hooks/**',
        'apps/desktop/src/App.tsx',
        'apps/desktop/src/components/AuthPanel.tsx',
        'apps/server/src/auth/routes.ts',
        'apps/desktop/electron/**'
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 86,
        statements: 90
      }
    }
  }
});
