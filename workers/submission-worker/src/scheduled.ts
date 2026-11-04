import { db } from '../../../packages/database/src/index.js';
import { processBatch } from '../../../packages/submission-engine/src/process.js';
import { workerLease } from '../../../packages/submission-engine/src/lease.js';

export async function runScheduledWorker() {
  if ((process.env.QUEUE_BACKEND ?? 'mongodb') !== 'mongodb')
    throw new Error('Vercel scheduled processing requires QUEUE_BACKEND=mongodb');
  const lease = workerLease();
  if (!(await lease.acquire())) return { busy: true, processedJobs: 0 };
  const deadline = Date.now() + 180000;
  let owned = true;
  let renewing = false;
  let renewal: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    renewal = lease
      .renew()
      .then((value) => {
        owned = value;
      })
      .catch(() => {
        owned = false;
      })
      .finally(() => {
        renewing = false;
      });
  }, 10000);
  let processedJobs = 0;
  try {
    const jobs = await db.submissionJob.findMany({
      where: {
        OR: [
          { status: { in: ['QUEUED', 'RUNNING'] } },
          { status: { in: ['PAUSED', 'CANCELLED'] }, records: { some: { status: 'RUNNING' } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 20,
    });
    for (const job of jobs) {
      if (!owned || Date.now() >= deadline) break;
      await processBatch(
        job.id,
        async () => {},
        undefined,
        async () => owned && (await lease.owned()),
        () => Date.now() < deadline,
      );
      processedJobs++;
    }
    return { busy: false, processedJobs };
  } finally {
    clearInterval(heartbeat);
    await renewal;
    await lease.release();
  }
}
