import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../packages/database/src/index.js';
import { z } from 'zod';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Prisma } from '@prisma/client';

// Password is read from stdin, never from command-line arguments or logged.
const email = z.string().email().max(191).safeParse(process.argv[2]?.trim().toLowerCase());
let hidden = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
try {
  if (!email.success)
    throw new Error('Enter a valid email: npm run user:create -- you@example.com');
  let password = '';
  while (true) {
    process.stdout.write('New workspace password (12–72 characters; typing is hidden): ');
    hidden = true;
    try {
      password = await rl.question('');
    } finally {
      hidden = false;
      process.stdout.write('\n');
    }
    if (password.length < 12) {
      console.error('Password must contain at least 12 characters. Please try again.');
      continue;
    }
    if (password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) {
      console.error('Password must fit within 72 UTF-8 bytes. Please use a shorter password.');
      continue;
    }
    break;
  }
  await db.user.create({
    data: { email: email.data, passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log(
    `Account created for ${email.data}. You can now sign in with this email and password.`,
  );
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error(
      'An account with this email already exists. Sign in using its existing password.',
    );
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error(
      'Cannot connect to MySQL. Start Docker services and apply database migrations first.',
    );
  } else if (error instanceof Error && 'code' in error && error.code === 'ERR_USE_AFTER_CLOSE') {
    console.error('Password input was closed. Run the command again in an interactive PowerShell.');
  } else {
    console.error(error instanceof Error ? error.message : 'Account creation failed.');
  }
  process.exitCode = 1;
} finally {
  rl.close();
  await db.$disconnect();
}
