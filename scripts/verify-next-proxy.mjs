import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const children = [];
let browser;
const snapshots = ['apps/web/next-env.d.ts', 'apps/web/tsconfig.json'].map((file) => ({
  file: path.join(root, file),
  contents: fs.readFileSync(path.join(root, file)),
}));
async function free(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
function start(script, args, extra) {
  const child = spawn(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    env: { ...process.env, ...extra },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  // Consume output without logging credentials or unrelated request data.
  child.stdout.resume();
  child.stderr.resume();
  return child;
}
async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}
async function ready(url) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null))
      throw new Error('A verification server exited early');
    try {
      if ((await request(url)).ok) return;
    } catch {
      /* Startup/compilation is still in progress. */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Verification server startup timed out');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
try {
  await free(4100);
  await free(3300);
  console.log(
    'Checking Next.js rewrites using temporary API:4100 and web:3300. No worker or submissions are started.',
  );
  start('node_modules/tsx/dist/cli.mjs', ['apps/api/src/server.ts'], {
    PORT: '4100',
    WEB_ORIGIN: 'http://localhost:3300',
    NODE_ENV: 'development',
  });
  await ready('http://127.0.0.1:4100/api/health/ready');
  start(
    'node_modules/next/dist/bin/next',
    ['dev', 'apps/web', '--hostname', '127.0.0.1', '--port', '3300', '--webpack'],
    {
      API_PROXY_URL: 'http://127.0.0.1:4100',
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DIST_DIR: '.next-proxy-check',
    },
  );
  const base = 'http://127.0.0.1:3300';
  await ready(base + '/api/health');
  assert(
    (await request(base + '/api/health/ready')).status === 200,
    'API readiness rewrite failed',
  );
  for (const [origin, expected] of [
    ['http://localhost:3300', 401],
    ['https://evil.test', 403],
  ]) {
    const response = await request(base + '/api/submissions/start', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(response.status === expected, 'Origin/auth protection changed through Next.js');
  }
  const origin = 'http://localhost:3300';
  const opened = await request(base + '/socket.io/?EIO=4&transport=polling', {
    headers: { Origin: origin },
  });
  const packet = await opened.text();
  assert(opened.ok && packet.startsWith('0'), 'Socket.IO polling rewrite failed');
  const sid = JSON.parse(packet.slice(1)).sid;
  const closed = await request(
    base + '/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(sid),
    { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '1' },
  );
  assert(closed.ok, 'Socket.IO polling POST rewrite failed');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3300', { waitUntil: 'domcontentloaded' });
  const browserPolling = await page.evaluate(async () => {
    const response = await fetch('/socket.io/?EIO=4&transport=polling', { credentials: 'include' });
    const text = await response.text();
    if (!response.ok || !text.startsWith('0')) return false;
    const sid = JSON.parse(text.slice(1)).sid;
    return (
      await fetch('/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(sid), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '1',
        credentials: 'include',
      })
    ).ok;
  });
  assert(browserPolling, 'Actual same-origin browser polling failed');
  console.log(
    'PASS: real Next.js API rewrites, MySQL/Redis readiness, Origin/auth checks and Socket.IO polling GET/POST. No responses submitted.',
  );
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGTERM');
    }
  }
  // Next.js may extend TypeScript's generated-file includes for this temporary output path.
  // Restore the normal project configuration after the temporary server exits.
  for (const snapshot of snapshots) fs.writeFileSync(snapshot.file, snapshot.contents);
}
