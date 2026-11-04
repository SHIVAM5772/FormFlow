import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../packages/database/generated/client/index.js';

const db = new PrismaClient();
const email = 'demo@example.com';
const credentialsFile = new URL('../.env.bootstrap', import.meta.url);
try {
  if (await db.user.findUnique({ where: { email } })) {
    console.log('Demo account already exists; existing password preserved.');
  } else {
    let password;
    try {
      password = dotenv.parse(await readFile(credentialsFile, 'utf8')).FORMFLOW_DEMO_PASSWORD;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      password = randomBytes(18).toString('base64url');
      await writeFile(
        credentialsFile,
        `FORMFLOW_DEMO_EMAIL=${email}\nFORMFLOW_DEMO_PASSWORD=${password}\n`,
        { flag: 'wx' },
      );
    }
    if (!password) throw new Error('Missing password in .env.bootstrap');
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12) } });
    console.log('Demo account created. Credentials are in ignored .env.bootstrap.');
  }
} finally {
  await db.$disconnect();
}
