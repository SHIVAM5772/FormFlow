import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const files = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  readFileSync: files.read,
}));
import { signupMailConfig } from '../apps/api/src/signup-email.js';
const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'];
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  for (const key of keys) vi.stubEnv(key, undefined);
  files.read.mockReset();
  files.read.mockImplementation((path: URL) =>
    path.pathname.endsWith('package.json')
      ? JSON.stringify({ name: 'formflow-automation-nextjs' })
      : 'SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=local-user\nSMTP_PASSWORD=local-test-password\nMAIL_FROM=no-reply@example.com',
  );
});
afterEach(() => vi.unstubAllEnvs());
it('loads local mail defaults from the repository independently of the startup folder', () => {
  expect(signupMailConfig()).toMatchObject({
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_USER: 'local-user',
  });
  expect(
    files.read.mock.calls.some(([path]) => path.href === new URL('../.env', import.meta.url).href),
  ).toBe(true);
});
it('keeps nonempty environment overrides and fills empty local service values', () => {
  vi.stubEnv('SMTP_HOST', 'override.example.com');
  vi.stubEnv('SMTP_SECURE', '');
  expect(signupMailConfig()).toMatchObject({
    SMTP_HOST: 'override.example.com',
    SMTP_SECURE: 'false',
  });
});
it('never reads local mail credentials in production or test mode', () => {
  for (const mode of ['production', 'test']) {
    vi.stubEnv('NODE_ENV', mode);
    expect(() => signupMailConfig()).toThrow('Email delivery is not configured');
  }
  expect(files.read).not.toHaveBeenCalled();
});
