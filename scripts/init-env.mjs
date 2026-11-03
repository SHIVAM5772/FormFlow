import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
let env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
env = env
  .replace('replace-with-at-least-32-random-characters', randomBytes(32).toString('hex'))
  .replace('replace-with-64-hex-characters', randomBytes(32).toString('hex'))
  .replace('change-this-root-password', randomBytes(24).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), env, { flag: 'wx' });
  console.log(
    'Created .env with independent random session and encryption keys. Existing files are never overwritten.',
  );
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; left unchanged.');
  else throw error;
}
