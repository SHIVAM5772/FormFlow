import { spawnSync } from 'node:child_process';

// Pin the CLI and use its Node.js launcher on Windows: the native launcher in
// this version cannot resolve @vercel/backends when starting multiple services.
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    'exec',
    '--yes',
    '--package=vercel@65.11.0',
    '--',
    'vercel',
    'dev',
    '--local',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...(process.platform === 'win32' ? { VERCEL_CLI_USE_NATIVE_BINARY: '0' } : {}),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
