import 'dotenv/config';
import { z } from 'zod';
import { allowedOrigins } from './origins.js';
export const config = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    SESSION_SECRET: z.string().min(32),
    DATA_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    DATABASE_URL: z.string().min(1),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(25).default(10),
    MAX_ROWS: z.coerce.number().min(1).max(10000).default(2000),
  })
  .parse(process.env);
if (config.NODE_ENV === 'production' && !config.WEB_ORIGIN.startsWith('https://'))
  throw new Error('Production requires an HTTPS WEB_ORIGIN');
export const webOrigins = allowedOrigins(config.WEB_ORIGIN, config.NODE_ENV);
