import 'dotenv/config';
import { PrismaClient } from '../generated/client/index.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const globalDatabase = globalThis as unknown as { formflowDatabase?: PrismaClient };
export const db =
  globalDatabase.formflowDatabase ??
  new PrismaClient({
    transactionOptions: { maxWait: 10000, timeout: 30000 },
  });
if (process.env.NODE_ENV !== 'production') globalDatabase.formflowDatabase = db;
function key() {
  const value = process.env.DATA_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('DATA_KEY must contain 64 hexadecimal characters');
  return Buffer.from(value, 'hex');
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decrypt<T>(value: string): T {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T;
}
