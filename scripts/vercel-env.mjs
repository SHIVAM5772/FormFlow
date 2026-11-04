import dotenv from 'dotenv';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

// Use a linked project and pass secret values only over stdin, never CLI args.
const origin = new URL(process.argv[2] ?? '');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password)
  throw new Error('Usage: node scripts/vercel-env.mjs https://your-project.vercel.app');
const dryRun = process.argv.includes('--dry-run');
const cliEntry = process.env.VERCEL_CLI_ENTRY;
if (!dryRun) await access(new URL('../.vercel/project.json', import.meta.url));
if (!dryRun && !cliEntry)
  throw new Error('Set VERCEL_CLI_ENTRY to the installed Vercel CLI JavaScript entrypoint.');
for (const name of [
  'DATABASE_URL',
  'SESSION_SECRET',
  'DATA_KEY',
  'CRON_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
]) {
  if (!process.env[name] && !dryRun) throw new Error(`Missing ${name} in .env`);
}
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE?.trim() || (smtpPort === 465 ? 'true' : 'false');
if (
  !Number.isInteger(smtpPort) ||
  smtpPort < 1 ||
  smtpPort > 65535 ||
  !['true', 'false'].includes(smtpSecure)
)
  throw new Error('SMTP_PORT or SMTP_SECURE is invalid in .env');
const values = {
  NODE_ENV: 'production',
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATA_KEY: process.env.DATA_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  WEB_ORIGIN: origin.origin,
  QUEUE_BACKEND: 'mongodb',
  // Leave room for multipart headers below Vercel's 4.5 MB request limit.
  MAX_UPLOAD_MB: String(Math.min(4, Number(process.env.MAX_UPLOAD_MB ?? 4))),
  MAX_ROWS: process.env.MAX_ROWS ?? '2000',
  RECORD_DELAY_MS: process.env.RECORD_DELAY_MS ?? '3000',
  RETENTION_DAYS: process.env.RETENTION_DAYS ?? '30',
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: String(smtpPort),
  SMTP_SECURE: smtpSecure,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  MAIL_FROM: process.env.MAIL_FROM,
};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  Object.assign(values, {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: `${origin.origin}/api/google/callback`,
  });
}
const secrets = new Set([
  'DATABASE_URL',
  'SESSION_SECRET',
  'DATA_KEY',
  'CRON_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'SMTP_PASSWORD',
]);
if (dryRun) {
  for (const [name, value] of Object.entries(values))
    console.log(
      `Would configure production ${name}${secrets.has(name) ? ' (sensitive)' : ''}${value ? '' : ' [MISSING]'}`,
    );
  process.exit(0);
}
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
