import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mail = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), create: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mail.create } }));
import {
  sendSignupCode,
  sendEmailChangeCode,
  signupMailConfig,
} from '../apps/api/src/signup-email.js';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_SECURE', 'false');
  vi.stubEnv('SMTP_USER', 'smtp-user');
  vi.stubEnv('SMTP_PASSWORD', 'smtp-password');
  vi.stubEnv('MAIL_FROM', 'FormFlow <no-reply@example.com>');
  mail.create.mockReturnValue({ sendMail: mail.send, close: mail.close });
  mail.send.mockResolvedValue({ accepted: ['test@example.com'] });
});
afterEach(() => vi.unstubAllEnvs());
it('sends a six-digit signup code over TLS and closes its transport', async () => {
  await sendSignupCode('test@example.com', '012345');
  expect(mail.create).toHaveBeenCalledWith(
    expect.objectContaining({ requireTLS: true, secure: false, logger: false, debug: false }),
  );
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'test@example.com', text: expect.stringContaining('012345') }),
  );
  expect(mail.close).toHaveBeenCalledOnce();
});
it('requires host and sender configuration without silently pretending to send', async () => {
  vi.stubEnv('SMTP_HOST', '');
  expect(() => signupMailConfig()).toThrow('Email delivery is not configured');
  await expect(sendSignupCode('test@example.com', '012345')).rejects.toThrow();
  expect(mail.send).not.toHaveBeenCalled();
});
it('sends email-change OTPs with a purpose-specific message using the configured transport', async () => {
  await sendEmailChangeCode('new@example.com', '012345');
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'new@example.com',
      subject: 'Verify your new FormFlow email address',
      text: expect.stringContaining('change to your account email'),
    }),
  );
  expect(mail.close).toHaveBeenCalledOnce();
});
it('rejects incomplete SMTP credentials and failed recipients', async () => {
  vi.stubEnv('SMTP_PASSWORD', '');
  expect(() => signupMailConfig()).toThrow();
  vi.stubEnv('SMTP_PASSWORD', 'smtp-password');
  mail.send.mockResolvedValue({ accepted: [] });
  await expect(sendSignupCode('test@example.com', '012345')).rejects.toThrow(
    'Email was not accepted',
  );
  expect(mail.close).toHaveBeenCalledOnce();
});
