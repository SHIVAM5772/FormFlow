import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../../packages/database/src/index.js';
import {
  Prisma,
  type EmailChangeVerification,
} from '../../../packages/database/generated/client/index.js';
import { signupProfileSchema } from '../../../packages/shared/src/account.js';
import { config } from './config.js';
import { sendEmailChangeCode, signupMailConfig } from './signup-email.js';

export class ProfileError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
type Actor = { id: string; email: string; sessionVersion: number };
const profileSelect = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  address: true,
  dateOfBirth: true,
  gender: true,
  emailVerifiedAt: true,
} as const;
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(191)
  .transform((value) => value.toLowerCase());
const verificationSchema = z.object({ verificationId: z.string().uuid() });
const invalid = () =>
  new ProfileError(400, 'Incorrect or expired OTP. Request a new code if needed.', 'OTP_INVALID');
const duplicate = () =>
  new ProfileError(409, 'This email address is already used by another account.', 'EMAIL_EXISTS');
const cooldown = () =>
  new ProfileError(
    429,
    'Wait 60 seconds between codes. At most 5 emails are allowed per 15 minutes.',
    'OTP_RATE_LIMIT',
  );
const hash = (userId: string, email: string, generation: string, code: string) =>
  createHmac('sha256', config.SESSION_SECRET)
    .update(JSON.stringify(['email-change', userId, email, generation, code]))
    .digest('hex');
const current = (
  pending: EmailChangeVerification | null,
  user: Actor,
): pending is EmailChangeVerification =>
  Boolean(
    pending &&
    pending.previousEmail === user.email &&
    pending.sessionVersion === user.sessionVersion,
  );
function verification(pending: EmailChangeVerification) {
  return {
    email: pending.email,
    verificationId: pending.generation,
    expiresAt: pending.expiresAt.toISOString(),
    resendAfterSeconds: Math.max(
      0,
      Math.ceil((pending.lastSentAt.getTime() + 60000 - Date.now()) / 1000),
    ),
  };
}
export async function getProfile(user: Actor) {
  const [profile, pending] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: profileSelect }),
    db.emailChangeVerification.findUnique({ where: { userId: user.id } }),
  ]);
  if (!profile) throw new ProfileError(404, 'Account not found', 'NOT_FOUND');
  return {
    ...profile,
    pendingEmailChange:
      current(pending, user) && pending.ready && pending.expiresAt > new Date()
        ? verification(pending)
        : null,
  };
}
export async function updateProfile(userId: string, input: unknown) {
  // Email and all account/security fields are excluded from this endpoint.
  const data = signupProfileSchema.strict().parse(input);
  return db.$transaction(async (tx) => {
    const profile = await tx.user.update({ where: { id: userId }, data, select: profileSelect });
    await tx.auditLog.create({ data: { userId, action: 'PROFILE_UPDATED' } });
    return profile;
  });
}
async function issue(user: Actor, email: string, previous: EmailChangeVerification | null) {
  try {
    signupMailConfig();
  } catch {
    throw new ProfileError(503, 'Email delivery is not configured.', 'EMAIL_NOT_CONFIGURED');
  }
  const now = new Date();
  const sameWindow = previous && now.getTime() - previous.sendWindowStart.getTime() < 15 * 60000;
  if (
    previous &&
    (now.getTime() - previous.lastSentAt.getTime() < 60000 ||
      (sameWindow && previous.sendCount >= 5))
  )
    throw cooldown();
  const generation = randomUUID();
  const code = randomInt(0, 1000000).toString().padStart(6, '0');
  const data = {
    email,
    previousEmail: user.email,
    sessionVersion: user.sessionVersion,
    generation,
    codeHash: hash(user.id, email, generation, code),
    expiresAt: new Date(now.getTime() + 10 * 60000),
    attempts: 0,
    ready: false,
    lastSentAt: now,
    sendWindowStart: sameWindow ? previous!.sendWindowStart : now,
    sendCount: sameWindow ? previous!.sendCount + 1 : 1,
  };
  if (previous) {
    const reserved = await db.emailChangeVerification.updateMany({
      where: {
        userId: user.id,
        generation: previous.generation,
        lastSentAt: { lte: new Date(now.getTime() - 60000) },
      },
      data,
    });
    if (!reserved.count) throw cooldown();
  } else {
    try {
      await db.emailChangeVerification.create({ data: { userId: user.id, ...data } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw cooldown();
      throw error;
    }
  }
  try {
    await sendEmailChangeCode(email, code);
    const delivered = await db.emailChangeVerification.updateMany({
      where: { userId: user.id, generation },
      data: { ready: true },
    });
    if (!delivered.count) throw new Error('Verification replaced');
  } catch {
    await db.emailChangeVerification
      .updateMany({
        where: { userId: user.id, generation },
        data: { ready: false, expiresAt: new Date() },
      })
      .catch(() => {});
    throw new ProfileError(
      503,
      'Could not send the verification email. Try again after 60 seconds.',
      'EMAIL_DELIVERY_FAILED',
    );
  }
  return verification({ userId: user.id, ...data });
}
export async function requestEmailChange(user: Actor, input: unknown) {
  const { email } = z.object({ email: emailSchema }).parse(input);
  if (email === user.email)
    throw new ProfileError(400, 'Enter a different email address.', 'EMAIL_UNCHANGED');
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw duplicate();
  const previous = await db.emailChangeVerification.findUnique({ where: { userId: user.id } });
  return issue(user, email, previous);
}
export async function resendEmailChange(user: Actor, input: unknown) {
  const { verificationId } = verificationSchema.parse(input);
  const pending = await db.emailChangeVerification.findUnique({ where: { userId: user.id } });
  if (!current(pending, user) || pending.generation !== verificationId) throw invalid();
  if (await db.user.findUnique({ where: { email: pending.email }, select: { id: true } }))
    throw duplicate();
  return issue(user, pending.email, pending);
}
export async function cancelEmailChange(userId: string) {
  // Preserve send counters so cancellation cannot bypass throttling.
  await db.emailChangeVerification.updateMany({
    where: { userId },
    data: { ready: false, expiresAt: new Date() },
  });
}
export async function verifyEmailChange(user: Actor, input: unknown) {
  const { verificationId, code } = verificationSchema
    .extend({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/),
    })
    .parse(input);
  const pending = await db.emailChangeVerification.findUnique({ where: { userId: user.id } });
  if (
    !current(pending, user) ||
    !pending.ready ||
    pending.generation !== verificationId ||
    pending.expiresAt <= new Date()
  )
    throw invalid();
  const where = {
    userId: user.id,
    generation: verificationId,
    ready: true,
    expiresAt: { gt: new Date() },
  };
  const attempt = await db.emailChangeVerification.updateMany({
    where: { ...where, attempts: { lt: 5 } },
    data: { attempts: { increment: 1 } },
  });
  if (!attempt.count) throw invalid();
  const actual = Buffer.from(hash(user.id, pending.email, verificationId, code), 'hex');
  const expected = Buffer.from(pending.codeHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  try {
    return await db.$transaction(async (tx) => {
      const consumed = await tx.emailChangeVerification.deleteMany({
        where: { ...where, expiresAt: { gt: new Date() }, attempts: { lte: 5 } },
      });
      if (!consumed.count) throw invalid();
      const changed = await tx.user.updateMany({
        where: {
          id: user.id,
          email: pending.previousEmail,
          sessionVersion: pending.sessionVersion,
        },
        data: {
          email: pending.email,
          emailVerifiedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      if (!changed.count) throw invalid();
      await tx.auditLog.create({ data: { userId: user.id, action: 'EMAIL_CHANGED' } });
      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { ...profileSelect, sessionVersion: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw duplicate();
    throw error;
  }
}
