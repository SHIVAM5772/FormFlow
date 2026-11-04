import nodemailer from 'nodemailer';
import { z } from 'zod';

export function signupMailConfig() {
  const result = z
    .object({
      SMTP_HOST: z.string().trim().min(1),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
      SMTP_SECURE: z.enum(['true', 'false']).optional(),
      SMTP_USER: z.string().optional(),
      SMTP_PASSWORD: z.string().optional(),
      MAIL_FROM: z
        .string()
        .trim()
        .min(1)
        .refine((value) => !/[\r\n]/.test(value)),
    })
    .safeParse(process.env);
  if (!result.success) throw new Error('Email delivery is not configured');
  const config = result.data;
  if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASSWORD))
    throw new Error('Email delivery is not configured');
  return config;
}

export async function sendSignupCode(email: string, code: string) {
  return sendCode(email, code, false);
}

export async function sendEmailChangeCode(email: string, code: string) {
  return sendCode(email, code, true);
}

async function sendCode(email: string, code: string, emailChange: boolean) {
  const config = signupMailConfig();
  const secure = config.SMTP_SECURE ? config.SMTP_SECURE === 'true' : config.SMTP_PORT === 465;
  const local = ['localhost', '127.0.0.1', '::1'].includes(config.SMTP_HOST);
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure,
    requireTLS: !secure && (process.env.NODE_ENV === 'production' || !local),
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  try {
    const info = await transport.sendMail({
      from: config.MAIL_FROM,
      to: email,
      subject: emailChange
        ? 'Verify your new FormFlow email address'
        : 'Verify your FormFlow email address',
      text: `Your FormFlow verification code is ${code}.\n\nThis code expires in 10 minutes. Do not share it with anyone.\n${emailChange ? 'This code confirms a change to your account email. If you did not request this change, ignore this email.' : 'If you did not request an account, you can ignore this email.'}`,
    });
    if (!info.accepted.length) throw new Error('Email was not accepted');
  } finally {
    transport.close();
  }
}
