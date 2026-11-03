import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const database = new URL(process.env.DATABASE_URL);
const redis = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
if (
  process.env.NODE_ENV === 'production' ||
  ![database.hostname, redis.hostname].every((host) => ['localhost', '127.0.0.1'].includes(host)) ||
  database.username !== 'formflow'
) {
  throw new Error('This helper only supports the local Compose formflow account and local Redis.');
}
database.pathname = '/formflow_next_test';
redis.pathname = '/15';
const docker =
  process.env.DOCKER_BIN ||
  (process.platform === 'win32'
    ? path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'Docker',
        'Docker',
        'resources',
        'bin',
        'docker.exe',
      )
    : 'docker');
const container = execFileSync(docker, ['compose', 'ps', '-q', 'mysql'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (!container) throw new Error('Start the local Compose MySQL service first.');
// The root password stays in the container environment, never in host arguments or output.
execFileSync(
  docker,
  ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'],
  {
    input:
      "CREATE DATABASE IF NOT EXISTS formflow_next_test; GRANT ALL PRIVILEGES ON formflow_next_test.* TO 'formflow'@'%';\n",
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: database.href,
  REDIS_URL: redis.href,
  WEB_ORIGIN: 'http://localhost:3000',
  RECORD_DELAY_MS: '1000',
};
function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  'Using isolated formflow_next_test database and Redis /15; application records are untouched.',
);
run('node_modules/prisma/build/index.js', [
  'migrate',
  'deploy',
  '--schema',
  'packages/database/prisma/schema.prisma',
]);
run('node_modules/vitest/vitest.mjs', ['run', '--config', 'vitest.services.config.ts']);
