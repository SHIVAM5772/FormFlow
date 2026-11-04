import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '../packages/database/generated/client/index.js';
const state = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'profile-test-secret-with-at-least-32-characters';
  process.env.DATA_KEY = 'b'.repeat(64);
  process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/formflow_test?replicaSet=rs0';
  return {
    pending: null as any,
    users: [] as any[],
    mail: vi.fn(),
    config: vi.fn(),
    audit: vi.fn(),
  };
});
function matches(row: any, where: any): boolean {
  return (
    Boolean(row) &&
    Object.entries(where).every(([key, expected]: any) => {
      if (expected && typeof expected === 'object') {
        if ('lt' in expected) return row[key] < expected.lt;
        if ('lte' in expected) return row[key] <= expected.lte;
        if ('gt' in expected) return row[key] > expected.gt;
      }
      return row[key] === expected;
    })
  );
}
function project(row: any, select: any) {
  return select
    ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
    : structuredClone(row);
}
function assign(row: any, data: any) {
  for (const [key, value] of Object.entries(data))
    row[key] =
      value && typeof value === 'object' && 'increment' in value
        ? row[key] + value.increment
        : value;
}
vi.mock('../apps/api/src/signup-email.js', () => ({
  sendEmailChangeCode: state.mail,
  signupMailConfig: state.config,
}));
vi.mock('../packages/database/src/index.js', () => {
  const pending = {
    findUnique: async ({ where }: any) =>
      matches(state.pending, where) ? structuredClone(state.pending) : null,
    create: async ({ data }: any) => {
      state.pending = structuredClone(data);
      return state.pending;
    },
    updateMany: async ({ where, data }: any) => {
      if (!matches(state.pending, where)) return { count: 0 };
      assign(state.pending, data);
      return { count: 1 };
    },
    deleteMany: async ({ where }: any) => {
      if (!matches(state.pending, where)) return { count: 0 };
      state.pending = null;
      return { count: 1 };
    },
  };
  function duplicate() {
    return new Prisma.PrismaClientKnownRequestError('Duplicate email', {
      code: 'P2002',
      clientVersion: '6.19.0',
    });
  }
  const user = {
    findUnique: async ({ where, select }: any) => {
      const row = state.users.find((u) => matches(u, where));
      return row ? project(row, select) : null;
    },
    findUniqueOrThrow: async ({ where, select }: any) =>
      project(
        state.users.find((u) => matches(u, where)),
        select,
      ),
    update: async ({ where, data, select }: any) => {
      const row = state.users.find((u) => matches(u, where));
      assign(row, data);
      return project(row, select);
    },
    updateMany: async ({ where, data }: any) => {
      const row = state.users.find((u) => matches(u, where));
      if (!row) return { count: 0 };
      if (state.users.some((u) => u.id !== row.id && u.email === data.email)) throw duplicate();
      assign(row, data);
      return { count: 1 };
    },
  };
  const tx = { emailChangeVerification: pending, user, auditLog: { create: state.audit } };
  let transactions = Promise.resolve();
  return {
    db: {
      ...tx,
      $transaction: (callback: any) => {
        const result = transactions.then(async () => {
          const snapshot = structuredClone({ pending: state.pending, users: state.users });
          try {
            return await callback(tx);
          } catch (error) {
            state.pending = snapshot.pending;
            state.users = snapshot.users;
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
import {
  getProfile,
  updateProfile,
  requestEmailChange,
  verifyEmailChange,
  resendEmailChange,
  cancelEmailChange,
} from '../apps/api/src/profile.js';
const actor = { id: 'account-one', email: 'old@example.com', sessionVersion: 0 };
const details = {
  name: 'Test Person',
  phoneNumber: '+919876543210',
  address: '12 Example Road',
  dateOfBirth: '2000-02-29',
  gender: 'Other',
};
const code = () => state.mail.mock.calls.at(-1)![1] as string;
beforeEach(() => {
  vi.resetAllMocks();
  state.pending = null;
  state.users = [
    {
      ...actor,
      ...details,
      passwordHash: 'secret',
      googleRefresh: 'private-token',
      emailVerifiedAt: new Date(),
    },
  ];
  state.config.mockReturnValue({});
  state.mail.mockResolvedValue(undefined);
});
it('returns only public profile fields and saves details without accepting email or security changes', async () => {
  const profile = await getProfile(actor);
  expect(profile).toMatchObject(details);
  expect(profile).not.toHaveProperty('passwordHash');
  expect(profile).not.toHaveProperty('googleRefresh');
  await updateProfile(actor.id, { ...details, name: 'Updated Person' });
  expect(state.users[0].name).toBe('Updated Person');
  expect(state.users[0].email).toBe(actor.email);
  await expect(
    updateProfile(actor.id, { ...details, email: 'bypass@example.com' }),
  ).rejects.toThrow();
  await expect(updateProfile(actor.id, { ...details, sessionVersion: 50 })).rejects.toThrow();
  await expect(
    updateProfile(actor.id, { ...details, dateOfBirth: '2000-02-30' }),
  ).rejects.toThrow();
});
it('keeps the old email until verification, persists only a hash, and consumes OTP once', async () => {
  const result = await requestEmailChange(actor, { email: ' NEW@Example.com ' });
  expect(result.email).toBe('new@example.com');
  expect(state.users[0].email).toBe(actor.email);
  expect(state.pending.codeHash).not.toBe(code());
  expect(JSON.stringify(result)).not.toContain('codeHash');
  expect((await getProfile(actor)).pendingEmailChange).toMatchObject(result);
  const input = { verificationId: result.verificationId, code: code() };
  const next = await verifyEmailChange(actor, input);
  expect(next.email).toBe('new@example.com');
  expect(next.sessionVersion).toBe(1);
  expect(next.emailVerifiedAt).toBeInstanceOf(Date);
  expect(next).not.toHaveProperty('passwordHash');
  expect(state.pending).toBeNull();
  await expect(verifyEmailChange(actor, input)).rejects.toMatchObject({ code: 'OTP_INVALID' });
});
it('rejects wrong, expired and cross-account codes without changing email', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  const correct = code();
  await expect(
    verifyEmailChange(actor, {
      verificationId: result.verificationId,
      code: correct === '000000' ? '111111' : '000000',
    }),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  await expect(
    verifyEmailChange(
      { ...actor, id: 'other-user' },
      { verificationId: result.verificationId, code: correct },
    ),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  state.pending.expiresAt = new Date(Date.now() - 1);
  await expect(
    verifyEmailChange(actor, { verificationId: result.verificationId, code: correct }),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  expect(state.users[0].email).toBe(actor.email);
});
it('locks verification after five attempts', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  const correct = code(),
    wrong = correct === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await expect(
      verifyEmailChange(actor, { verificationId: result.verificationId, code: wrong }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  await expect(
    verifyEmailChange(actor, { verificationId: result.verificationId, code: correct }),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  expect(state.users[0].email).toBe(actor.email);
});
it('throttles resends and target changes, invalidates old codes, and limits sends per user', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  const oldCode = code();
  await expect(resendEmailChange(actor, result)).rejects.toMatchObject({ code: 'OTP_RATE_LIMIT' });
  await expect(requestEmailChange(actor, { email: 'different@example.com' })).rejects.toMatchObject(
    { code: 'OTP_RATE_LIMIT' },
  );
  state.pending.lastSentAt = new Date(Date.now() - 61000);
  const next = await resendEmailChange(actor, result);
  expect(next.verificationId).not.toBe(result.verificationId);
  await expect(
    verifyEmailChange(actor, { verificationId: result.verificationId, code: oldCode }),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  state.pending.lastSentAt = new Date(Date.now() - 61000);
  state.pending.sendCount = 5;
  await expect(resendEmailChange(actor, next)).rejects.toMatchObject({ code: 'OTP_RATE_LIMIT' });
});
it('preserves cooldown after cancelling and rejects a cancelled code', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  const correct = code();
  await cancelEmailChange(actor.id);
  expect((await getProfile(actor)).pendingEmailChange).toBeNull();
  await expect(
    verifyEmailChange(actor, { verificationId: result.verificationId, code: correct }),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  await expect(requestEmailChange(actor, { email: 'next@example.com' })).rejects.toMatchObject({
    code: 'OTP_RATE_LIMIT',
  });
});
it('rejects unchanged or already-used emails and handles a duplicate acquired before verification', async () => {
  await expect(requestEmailChange(actor, { email: actor.email })).rejects.toMatchObject({
    code: 'EMAIL_UNCHANGED',
  });
  state.users.push({ id: 'other', email: 'used@example.com' });
  await expect(requestEmailChange(actor, { email: 'used@example.com' })).rejects.toMatchObject({
    code: 'EMAIL_EXISTS',
  });
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  state.users.push({ id: 'raced', email: 'new@example.com' });
  await expect(
    verifyEmailChange(actor, { verificationId: result.verificationId, code: code() }),
  ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
  expect(state.users[0].email).toBe(actor.email);
  expect(state.pending).not.toBeNull();
});
it('does not accept OTPs after a session/email change or failed mail delivery', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  await expect(
    verifyEmailChange(
      { ...actor, sessionVersion: 1 },
      { verificationId: result.verificationId, code: code() },
    ),
  ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  state.pending.lastSentAt = new Date(Date.now() - 61000);
  state.mail.mockRejectedValueOnce(new Error('SMTP failed'));
  await expect(resendEmailChange(actor, result)).rejects.toMatchObject({
    code: 'EMAIL_DELIVERY_FAILED',
  });
  expect(state.pending.ready).toBe(false);
  expect(state.users[0].email).toBe(actor.email);
});
it('allows only one winner when correct verification requests race', async () => {
  const result = await requestEmailChange(actor, { email: 'new@example.com' });
  const input = { verificationId: result.verificationId, code: code() };
  const results = await Promise.allSettled([
    verifyEmailChange(actor, input),
    verifyEmailChange(actor, input),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(state.users[0].sessionVersion).toBe(1);
});
