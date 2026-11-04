import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { hostname } from 'node:os';
import { db } from '../../../packages/database/src/index.js';
import {
  QUEUE,
  redisConnection,
  dispatch,
  closeQueue,
} from '../../../packages/submission-engine/src/queue.js';
import { processBatch } from '../../../packages/submission-engine/src/process.js';
const logger = pino();
const publisher = redisConnection();
const workerConnection = redisConnection();
const healthKey = `formflow:worker:${hostname()}`;
let stopping = false;
let reconciling = false;
const worker = new Worker(
  QUEUE,
  (job) =>
    processBatch(job.data.id, async (userId, jobId) => {
      try {
        await publisher.publish('formflow:progress', JSON.stringify({ userId, jobId }));
      } catch {
        logger.warn({ jobId }, 'Progress event unavailable; dashboard polling will recover');
      }
    }),
  {
    connection: workerConnection,
    concurrency: Math.min(4, Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1))),
    maxStalledCount: 1,
    lockDuration: 120000,
  },
);
worker.on('error', () => logger.error('Queue worker connection error'));
worker.on('failed', (job) =>
  logger.error({ jobId: job?.id }, 'Batch failed; reconciliation will inspect persisted state'),
);
// Database-backed dispatch reconciliation closes the commit/enqueue gap, including Redis outages.
async function reconcile() {
  if (stopping || reconciling) return;
  reconciling = true;
  try {
    const jobs = await db.submissionJob.findMany({
      where: {
        OR: [
          { status: { in: ['QUEUED', 'RUNNING'] } },
          { status: { in: ['PAUSED', 'CANCELLED'] }, records: { some: { status: 'RUNNING' } } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    for (const job of jobs) await dispatch(job.id);
    await publisher.set(healthKey, 'ok', 'EX', 30);
  } catch {
    logger.error('Queue reconciliation unavailable');
  } finally {
    reconciling = false;
  }
}
const timer = setInterval(() => void reconcile(), 10000);
void reconcile();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await worker.close();
  workerConnection.disconnect();
  await closeQueue();
  publisher.disconnect();
  await db.$disconnect();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
