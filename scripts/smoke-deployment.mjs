import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';

const origin = new URL(process.argv[2] ?? '');
if (origin.protocol !== 'https:' || origin.pathname !== '/')
  throw new Error('Provide the deployed HTTPS origin.');
const credentials = dotenv.parse(
  await readFile(new URL('../.env.bootstrap', import.meta.url), 'utf8'),
);
let cookie = '';
async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  console.log(`PASS ${path}: HTTP ${response.status}`);
  return response;
}
await request('/');
await request('/api/health');
await request('/api/health/ready');
const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: credentials.FORMFLOW_DEMO_EMAIL,
    password: credentials.FORMFLOW_DEMO_PASSWORD,
  }),
});
const session = login.headers.get('set-cookie');
if (!session || !session.includes('HttpOnly') || !session.includes('Secure'))
  throw new Error('Secure session cookie missing');
cookie = session.split(';')[0];
for (const path of [
  '/api/auth/me',
  '/api/dashboard/stats',
  '/api/forms',
  '/api/templates',
  '/api/submissions',
  '/api/settings',
]) {
  await request(path);
}
await request('/api/auth/logout', { method: 'POST' });
const loggedOut = await fetch(new URL('/api/auth/me', origin), {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(30000),
});
if (loggedOut.status !== 401) throw new Error('Logout did not invalidate the session');
console.log('PASS logout invalidates the session. No Google responses submitted.');
