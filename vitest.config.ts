import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
    exclude: ['tests/services/**'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
