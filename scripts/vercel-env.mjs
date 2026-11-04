import 'dotenv/config';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Use a linked project and pass secret values only over stdin, never CLI args.
const origin = new URL(process.argv[2] ?? '');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password)
  throw new Error('Usage: node scripts/vercel-env.mjs https://your-project.vercel.app');
await access(new URL('../.vercel/project.json', import.meta.url));
const cliEntry = process.env.VERCEL_CLI_ENTRY;
if (!cliEntry)
  throw new Error('Set VERCEL_CLI_ENTRY to the installed Vercel CLI JavaScript entrypoint.');
for (const name of ['DATABASE_URL', 'SESSION_SECRET', 'DATA_KEY']) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
}
const values = {
  NODE_ENV: 'production',
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATA_KEY: process.env.DATA_KEY,
  WEB_ORIGIN: origin.origin,
  QUEUE_BACKEND: 'mongodb',
  PORT: '4000',
  WORKER_HEALTH_PORT: '4001',
  MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB ?? '10',
  MAX_ROWS: process.env.MAX_ROWS ?? '2000',
  RECORD_DELAY_MS: process.env.RECORD_DELAY_MS ?? '3000',
  RETENTION_DAYS: process.env.RETENTION_DAYS ?? '30',
};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  Object.assign(values, {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: `${origin.origin}/api/google/callback`,
  });
}
const secrets = new Set(['DATABASE_URL', 'SESSION_SECRET', 'DATA_KEY', 'GOOGLE_CLIENT_SECRET']);
for (const [name, value] of Object.entries(values)) {
  const result = spawnSync(
    process.execPath,
    [
      cliEntry,
      'env',
      'add',
      name,
      '--environment',
      'production',
      '--force',
      '--yes',
      ...(secrets.has(name) ? ['--sensitive'] : ['--no-sensitive']),
    ],
    {
      input: value,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Could not configure ${name}; check Vercel login and project access.`);
  console.log(`Configured production ${name}`);
}
