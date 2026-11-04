import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The configured app DB is never used for test records. Keep collections/indexes
// in a separate test database; the suite deletes only its own fixtures.
const root = fileURLToPath(new URL('..', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol)) throw new Error('MongoDB URL required');
url.pathname = '/formflow_codex_test';
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  NODE_ENV: 'test',
  QUEUE_BACKEND: 'mongodb',
  WEB_ORIGIN: 'http://localhost:3000',
  RECORD_DELAY_MS: '1000',
};
for (const [script, args] of [
  [
    'node_modules/prisma/build/index.js',
    ['db', 'push', '--skip-generate', '--schema', 'packages/database/prisma/schema.prisma'],
  ],
  ['node_modules/vitest/vitest.mjs', ['run', '--config', 'vitest.services.config.ts']],
]) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`../${script}`, import.meta.url)), ...args],
    {
      cwd: root,
      env,
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
