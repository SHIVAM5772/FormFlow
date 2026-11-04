import 'dotenv/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
export const QUEUE = 'formflow-submissions';
export function usesMongoQueue() {
  return (process.env.QUEUE_BACKEND ?? 'mongodb') === 'mongodb';
}
export function redisConnection() {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  client.on('error', () => {});
  return client;
}
let queue: Queue | undefined;
let queueConnection: Redis | undefined;
export function submissionQueue() {
  if (!queue) {
    queueConnection = redisConnection();
    queue = new Queue(QUEUE, {
      connection: queueConnection,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
    });
    queue.on('error', () => {});
  }
  return queue;
}
export async function dispatch(id: string) {
  // The persisted SubmissionJob is consumed by the local or scheduled worker.
  if (usesMongoQueue()) return;
  const q = submissionQueue();
  const previous = await q.getJob(id);
  if (previous && (await previous.isFailed())) await previous.remove();
  await q.add('batch', { id }, { jobId: id });
}
export async function closeQueue() {
  await queue?.close();
  queueConnection?.disconnect();
  queue = undefined;
  queueConnection = undefined;
}
