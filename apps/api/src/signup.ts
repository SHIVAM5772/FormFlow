import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, encrypt, decrypt } from '../../../packages/database/src/index.js';
import {
  Prisma,
  type SignupVerification,
} from '../../../packages/database/generated/client/index.js';
import { signupProfileSchema } from '../../../packages/shared/src/account.js';
import { config } from './config.js';
import { sendSignupCode, signupMailConfig } from './signup-email.js';

export class SignupError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(191)
  .transform((value) => value.toLowerCase());
const signupSchema = signupProfileSchema.extend({
  email: emailSchema,
  password: z
    .string()
    .min(12)
    .max(72)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 72,
      'Password must fit within 72 UTF-8 bytes',
    ),
});
type PendingAccount = Omit<z.infer<typeof signupSchema>, 'password'> & { passwordHash: string };
const verificationSchema = z.object({ email: emailSchema, verificationId: z.string().uuid() });
const CODE_MS = 10 * 60000;
const WINDOW_MS = 15 * 60000;
const COOLDOWN_MS = 60000;
const MAX_ATTEMPTS = 5;
const invalidCode = () =>
  new SignupError(400, 'Incorrect or expired OTP. Try again or request a new code.', 'OTP_INVALID');
const cooldown = () =>
  new SignupError(
    429,
    'Please wait before requesting another code. You can resend after 60 seconds; at most 5 emails are allowed per 15 minutes.',
    'OTP_RATE_LIMIT',
  );
const duplicate = () =>
  new SignupError(
    409,
    'An account with this email already exists. Please sign in.',
    'EMAIL_EXISTS',
  );

function codeHash(email: string, generation: string, code: string) {
  return createHmac('sha256', config.SESSION_SECRET)
    .update(JSON.stringify([email, generation, code]))
    .digest('hex');
}
function requireMail() {
  try {
    signupMailConfig();
  } catch {
    throw new SignupError(
      503,
      'Email delivery is not configured. Please contact the administrator.',
      'EMAIL_NOT_CONFIGURED',
    );
  }
}

async function issueCode(
  email: string,
  encryptedPayload: string,
  previous: SignupVerification | null,
) {
  const now = new Date();
  const sameWindow = previous && now.getTime() - previous.sendWindowStart.getTime() < WINDOW_MS;
  if (
    previous &&
    (now.getTime() - previous.lastSentAt.getTime() < COOLDOWN_MS ||
      (sameWindow && previous.sendCount >= 5))
  )
    throw cooldown();
  const generation = randomUUID();
  const code = randomInt(0, 1000000).toString().padStart(6, '0');
  const data = {
    generation,
    codeHash: codeHash(email, generation, code),
    encryptedPayload,
    expiresAt: new Date(now.getTime() + CODE_MS),
    attempts: 0,
    ready: false,
    lastSentAt: now,
    sendWindowStart: sameWindow ? previous!.sendWindowStart : now,
    sendCount: sameWindow ? previous!.sendCount + 1 : 1,
  };
  if (previous) {
    const reserved = await db.signupVerification.updateMany({
      where: {
        email,
        generation: previous.generation,
        lastSentAt: { lte: new Date(now.getTime() - COOLDOWN_MS) },
      },
      data,
    });
    if (!reserved.count) throw cooldown();
  } else {
    try {
      await db.signupVerification.create({ data: { email, ...data } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw cooldown();
      throw error;
    }
  }
  try {
    await sendSignupCode(email, code);
    const delivered = await db.signupVerification.updateMany({
      where: { email, generation },
      data: { ready: true },
    });
    if (!delivered.count) throw new Error('Verification changed during delivery');
  } catch (error) {
    await db.signupVerification
      .updateMany({
        where: { email, generation },
        data: { ready: false, expiresAt: new Date() },
      })
      .catch(() => {});
    throw new SignupError(
      503,
      error instanceof Error && error.name === 'SmtpIpBlockedError'
        ? 'Email provider blocked this server. Ask the administrator to authorize its IP.'
        : 'Could not send the verification email. Please try again after 60 seconds.',
      error instanceof Error && error.name === 'SmtpIpBlockedError'
        ? 'SMTP_IP_BLOCKED'
        : 'EMAIL_DELIVERY_FAILED',
    );
  }
  return {
    email,
    verificationId: generation,
    expiresAt: data.expiresAt.toISOString(),
    resendAfterSeconds: 60,
  };
}

export async function requestSignup(input: unknown) {
  const { password, ...profile } = signupSchema.parse(input);
  if (await db.user.findUnique({ where: { email: profile.email }, select: { id: true } }))
    throw duplicate();
  requireMail();
  const previous = await db.signupVerification.findUnique({ where: { email: profile.email } });
  // Only a password hash is retained, inside an encrypted pending profile.
  const payload: PendingAccount = { ...profile, passwordHash: await bcrypt.hash(password, 12) };
  return issueCode(profile.email, encrypt(payload), previous);
}

export async function resendSignup(input: unknown) {
  const { email, verificationId } = verificationSchema.parse(input);
  requireMail();
  const pending = await db.signupVerification.findUnique({ where: { email } });
  if (!pending || pending.generation !== verificationId) throw invalidCode();
  return issueCode(email, pending.encryptedPayload, pending);
}

export async function verifySignup(input: unknown) {
  const { email, verificationId, code } = verificationSchema
    .extend({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/),
    })
    .parse(input);
  const pending = await db.signupVerification.findUnique({ where: { email } });
  if (
    !pending ||
    !pending.ready ||
    pending.generation !== verificationId ||
    pending.expiresAt <= new Date()
  )
    throw invalidCode();
  const attempt = await db.signupVerification.updateMany({
    where: {
      email,
      generation: verificationId,
      ready: true,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
  if (!attempt.count) throw invalidCode();
  const actual = Buffer.from(codeHash(email, verificationId, code), 'hex');
  const expected = Buffer.from(pending.codeHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalidCode();
  const payload = decrypt<PendingAccount>(pending.encryptedPayload);
  try {
    return await db.$transaction(async (tx) => {
      // Consumption and account creation commit together, so parallel requests cannot replay a code.
      const consumed = await tx.signupVerification.deleteMany({
        where: {
          email,
          generation: verificationId,
          ready: true,
          expiresAt: { gt: new Date() },
          attempts: { lte: MAX_ATTEMPTS },
        },
      });
      if (!consumed.count) throw invalidCode();
      const user = await tx.user.create({
        data: { ...payload, email, emailVerifiedAt: new Date() },
      });
      await tx.auditLog.create({ data: { userId: user.id, action: 'SIGNUP' } });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw duplicate();
    throw error;
  }
}
