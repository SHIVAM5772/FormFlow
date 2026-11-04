import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'packages/database/generated/**',
      '**/.next/**',
      '**/.next-proxy-check/**',
      '**/next-env.d.ts',
      'dist/**',
      'apps/web/dist/**',
      'playwright-report/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
