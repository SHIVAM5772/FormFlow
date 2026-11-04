import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createApp } from './app.js';
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
app.use(createApp());
export default app;
