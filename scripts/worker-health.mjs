import { hostname } from 'node:os';
import { Redis } from 'ioredis';
const timeout = setTimeout(() => process.exit(1), 8000);
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  retryStrategy: () => null,
});
redis.on('error', () => {});
try {
  const healthy = await redis.get(`formflow:worker:${hostname()}`);
  clearTimeout(timeout);
  redis.disconnect();
  process.exit(healthy === 'ok' ? 0 : 1);
} catch {
  clearTimeout(timeout);
  redis.disconnect();
  process.exit(1);
}
