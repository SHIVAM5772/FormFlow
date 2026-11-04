import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const run = vi.hoisted(() => vi.fn());
vi.mock('../workers/submission-worker/src/scheduled.js', () => ({ runScheduledWorker: run }));
vi.mock('../apps/api/src/app.js', () => ({ createApp: () => express() }));
import app from '../apps/api/src/vercel.js';

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
});
it('rejects missing, incorrect and unconfigured cron credentials without processing jobs', async () => {
  expect((await request(app).get('/api/internal/process')).status).toBe(401);
  expect(
    (await request(app).get('/api/internal/process').set('Authorization', 'Bearer invalid')).status,
  ).toBe(401);
  delete process.env.CRON_SECRET;
  expect(
    (await request(app).get('/api/internal/process').set('Authorization', 'Bearer undefined'))
      .status,
  ).toBe(401);
  expect(run).not.toHaveBeenCalled();
});
it('awaits authenticated processing before completing the function response', async () => {
  run.mockResolvedValue({ busy: false, processedJobs: 1 });
  const response = await request(app)
    .get('/api/internal/process')
    .set('Authorization', 'Bearer test-cron-secret');
  expect(response.status).toBe(200);
  expect(response.body.data.processedJobs).toBe(1);
  expect(run).toHaveBeenCalledOnce();
});
