import { hostname } from 'node:os';
import { Redis } from 'ioredis';
if ((process.env.QUEUE_BACKEND ?? 'mongodb') === 'mongodb') {
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.WORKER_HEALTH_PORT ?? 4001}/health`,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}
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
