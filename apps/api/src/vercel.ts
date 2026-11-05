import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { createApp, logger } from './app.js';
import { dispatch, usesMongoQueue } from '../../../packages/submission-engine/src/queue.js';
import { runScheduledWorker } from '../../../workers/submission-worker/src/scheduled.js';

const app = express();
app.get('/api/internal/process', async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    res.json({ data: await runScheduledWorker() });
  } catch (error) {
    next(error);
  }
});
app.use(
  createApp({
    dispatchJob(jobId) {
      const work = dispatch(jobId)
        .then(async () => {
          if (usesMongoQueue()) await runScheduledWorker(jobId);
        })
        .catch((error) => {
          logger.error(
            { jobId, error: error instanceof Error ? error.message : 'Unknown failure' },
            'Background submission processing failed',
          );
        });
      // Register synchronously while the HTTP request is active. A detached
      // promise alone can be frozen as soon as Vercel sends the response.
      waitUntil(work);
      return work;
    },
  }),
);
export default app;
