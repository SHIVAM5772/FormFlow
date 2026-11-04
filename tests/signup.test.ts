import { beforeEach, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { Prisma } from '../packages/database/generated/client/index.js';
const state = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'signup-test-secret-with-at-least-32-characters';
  process.env.DATA_KEY = 'b'.repeat(64);
  process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/formflow_test?replicaSet=rs0';
  return {
    pending: null as any,
    users: [] as any[],
    mail: vi.fn(),
    mailConfig: vi.fn(),
    create: vi.fn(),
    audit: vi.fn(),
  };
});
function matches(where: any) {
  const row = state.pending;
  return (
    row &&
    row.email === where.email &&
    (!where.generation || row.generation === where.generation) &&
    (where.ready === undefined || row.ready === where.ready) &&
    (!where.lastSentAt || row.lastSentAt <= where.lastSentAt.lte) &&
    (!where.expiresAt || row.expiresAt > where.expiresAt.gt) &&
    (!where.attempts ||
      (where.attempts.lt !== undefined
        ? row.attempts < where.attempts.lt
        : row.attempts <= where.attempts.lte))
  );
}
vi.mock('../apps/api/src/signup-email.js', () => ({
  sendSignupCode: state.mail,
  signupMailConfig: state.mailConfig,
}));
vi.mock('../packages/database/src/index.js', async (original) => {
  const actual = await original<typeof import('../packages/database/src/index.js')>();
  const pending = {
    findUnique: async ({ where }: any) =>
      state.pending?.email === where.email ? structuredClone(state.pending) : null,
    create: async ({ data }: any) => {
      if (state.pending)
        throw new Prisma.PrismaClientKnownRequestError('Duplicate email', {
          code: 'P2002',
          clientVersion: '6.19.0',
        });
      state.pending = { ...data, createdAt: new Date() };
      return state.pending;
    },
    updateMany: async ({ where, data }: any) => {
      if (!matches(where)) return { count: 0 };
      for (const [key, value] of Object.entries(data))
        state.pending[key] =
          key === 'attempts' && typeof value === 'object'
            ? state.pending.attempts + (value as any).increment
            : value;
      return { count: 1 };
    },
    deleteMany: async ({ where }: any) => {
      if (!matches(where)) return { count: 0 };
      state.pending = null;
      return { count: 1 };
    },
  };
  const tx = {
    signupVerification: pending,
    user: { create: state.create },
    auditLog: { create: state.audit },
  };
  let transactions = Promise.resolve();
  return {
    ...actual,
    db: {
      ...tx,
      user: {
        create: state.create,
        findUnique: async ({ where }: any) =>
          state.users.find((u) => u.email === where.email) ?? null,
      },
      $transaction: (callback: any) => {
        const result = transactions.then(async () => {
          const before = { pending: structuredClone(state.pending), users: [...state.users] };
          try {
            return await callback(tx);
          } catch (error) {
            state.pending = before.pending;
            state.users = before.users;
            throw error;
          }
        });
        transactions = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    },
  };
});
import { requestSignup, resendSignup, verifySignup } from '../apps/api/src/signup.js';
import { decrypt } from '../packages/database/src/index.js';

const body = {
  name: 'Test Person',
  email: 'test@example.com',
  phoneNumber: '+91 98765 43210',
  address: '12 Test Street',
  dateOfBirth: '2000-02-29',
  gender: 'Other',
  password: 'signup-test-password',
};
const latestCode = () => state.mail.mock.calls.at(-1)![1] as string;
beforeEach(() => {
  vi.resetAllMocks();
  state.pending = null;
  state.users = [];
  state.mailConfig.mockReturnValue({});
  state.mail.mockResolvedValue(undefined);
  state.create.mockImplementation(async ({ data }: any) => {
    const user = { id: 'test-user', sessionVersion: 0, ...data };
    state.users.push(user);
    return user;
  });
});
it('stores an encrypted pending profile and keyed code hash, but no account before verification', async () => {
  const result = await requestSignup({ ...body, email: ' TEST@Example.com ' });
  expect(result.email).toBe(body.email);
  expect(state.create).not.toHaveBeenCalled();
  expect(latestCode()).toMatch(/^\d{6}$/);
  expect(state.pending.codeHash).not.toBe(latestCode());
  expect(state.pending.encryptedPayload).not.toContain(body.password);
  expect(state.pending.encryptedPayload).not.toContain(body.address);
  const payload = decrypt<any>(state.pending.encryptedPayload);
  expect(payload.password).toBeUndefined();
  expect(await bcrypt.compare(body.password, payload.passwordHash)).toBe(true);
  expect(payload.phoneNumber).toBe('+919876543210');
  expect(JSON.stringify(result)).not.toContain('codeHash');
  expect(result).not.toHaveProperty('code');
});
it('creates a verified user once, preserves profile details and rejects OTP replay', async () => {
  const result = await requestSignup(body);
  const input = { ...result, code: latestCode() };
  const user = await verifySignup(input);
  expect(user).toMatchObject({
    name: body.name,
    email: body.email,
    phoneNumber: '+919876543210',
    address: body.address,
    dateOfBirth: body.dateOfBirth,
    gender: body.gender,
  });
  expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  expect(state.pending).toBeNull();
  await expect(verifySignup(input)).rejects.toMatchObject({ code: 'OTP_INVALID' });
  expect(state.create).toHaveBeenCalledOnce();
});
it('allows at most five attempts and rejects the correct code after that limit', async () => {
  const result = await requestSignup(body);
  const code = latestCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await expect(verifySignup({ ...result, code: wrong })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
  await expect(verifySignup({ ...result, code })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  expect(state.create).not.toHaveBeenCalled();
});
it('rejects expired, unready and mismatched-email challenges', async () => {
  const result = await requestSignup(body);
  const code = latestCode();
  await expect(verifySignup({ ...result, email: 'other@example.com', code })).rejects.toMatchObject(
    { code: 'OTP_INVALID' },
  );
  state.pending.ready = false;
  await expect(verifySignup({ ...result, code })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  state.pending.ready = true;
  state.pending.expiresAt = new Date(Date.now() - 1);
  await expect(verifySignup({ ...result, code })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  expect(state.create).not.toHaveBeenCalled();
});
it('enforces email cooldown across repeated requests, and resend invalidates the old challenge', async () => {
  const first = await requestSignup(body);
  const code = latestCode();
  await expect(resendSignup(first)).rejects.toMatchObject({ status: 429 });
  await expect(requestSignup(body)).rejects.toMatchObject({ status: 429 });
  state.pending.lastSentAt = new Date(Date.now() - 61000);
  const second = await resendSignup(first);
  expect(second.verificationId).not.toBe(first.verificationId);
  await expect(verifySignup({ ...first, code })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  await verifySignup({ ...second, code: latestCode() });
  expect(state.create).toHaveBeenCalledOnce();
});
it('limits each email to five sends per 15-minute window', async () => {
  let challenge = await requestSignup(body);
  for (let i = 0; i < 4; i++) {
    state.pending.lastSentAt = new Date(Date.now() - 61000);
    challenge = await resendSignup(challenge);
  }
  state.pending.lastSentAt = new Date(Date.now() - 61000);
  await expect(resendSignup(challenge)).rejects.toMatchObject({ status: 429 });
  expect(state.mail).toHaveBeenCalledTimes(5);
});
it('creates at most one account when correct verification requests arrive together', async () => {
  const challenge = await requestSignup(body);
  const input = { ...challenge, code: latestCode() };
  const results = await Promise.allSettled([verifySignup(input), verifySignup(input)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(state.create).toHaveBeenCalledOnce();
});
it('reserves only one email delivery when two signup requests race', async () => {
  const results = await Promise.allSettled([requestSignup(body), requestSignup(body)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(state.mail).toHaveBeenCalledOnce();
});
it('rejects existing accounts without sending another signup email', async () => {
  state.users.push({ email: body.email });
  await expect(requestSignup(body)).rejects.toMatchObject({ status: 409, code: 'EMAIL_EXISTS' });
  expect(state.mail).not.toHaveBeenCalled();
  expect(state.pending).toBeNull();
});
it('does not create users or leave usable codes when email delivery fails', async () => {
  state.mail.mockRejectedValue(new Error('SMTP failed'));
  await expect(requestSignup(body)).rejects.toMatchObject({
    status: 503,
    code: 'EMAIL_DELIVERY_FAILED',
  });
  expect(state.pending.ready).toBe(false);
  expect(state.create).not.toHaveBeenCalled();
});
it('requires mail configuration and valid profile input before storing a challenge', async () => {
  await expect(requestSignup({ ...body, dateOfBirth: '2999-01-01' })).rejects.toThrow();
  state.mailConfig.mockImplementation(() => {
    throw new Error('Missing configuration');
  });
  await expect(requestSignup(body)).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
  expect(state.pending).toBeNull();
});
it('rolls back OTP consumption if creating the account fails', async () => {
  const challenge = await requestSignup(body);
  state.create.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(verifySignup({ ...challenge, code: latestCode() })).rejects.toThrow(
    'Database unavailable',
  );
  expect(state.pending).not.toBeNull();
  expect(state.users).toHaveLength(0);
});
