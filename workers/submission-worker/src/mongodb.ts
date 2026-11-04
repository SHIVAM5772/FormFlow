import { createServer } from 'node:http';
import pino from 'pino';
import { db } from '../../../packages/database/src/index.js';
import { processBatch } from '../../../packages/submission-engine/src/process.js';
import { workerLease } from '../../../packages/submission-engine/src/lease.js';

const logger = pino();
const lease = workerLease();
let stopping = false;
let holding = false;
let renewing = false;
let healthyAt = Date.now();
const health = createServer((_req, res) => {
  res.writeHead(Date.now() - healthyAt < 30000 ? 200 : 503).end();
});
health.listen(Number(process.env.WORKER_HEALTH_PORT ?? 4001), '0.0.0.0');

function stop() {
  stopping = true;
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const heartbeat = setInterval(() => {
  if (!holding || renewing) return;
  renewing = true;
  void lease
    .renew()
    .then((owned) => {
      if (!owned) {
        holding = false;
        stopping = true;
      } else healthyAt = Date.now();
    })
    .catch(() => {
      holding = false;
      stopping = true;
      process.exitCode = 1;
      logger.error('Worker lost database lease');
    })
    .finally(() => {
      renewing = false;
    });
}, 10000);

try {
  logger.info('MongoDB submission worker starting');
  while (!stopping) {
    try {
      if (!holding) holding = await lease.acquire();
      if (holding) {
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
          if (stopping) break;
          await processBatch(
            job.id,
            async () => {},
            undefined,
            async () => !stopping && holding && (await lease.owned()),
          );
        }
      }
      healthyAt = Date.now();
    } catch {
      logger.error('MongoDB worker polling failed; will retry');
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} finally {
  clearInterval(heartbeat);
  health.close();
  if (holding) await lease.release().catch(() => {});
  await db.$disconnect();
}
