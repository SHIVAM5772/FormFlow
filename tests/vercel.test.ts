import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const worker = vi.hoisted(() => ({
  run: vi.fn(),
  waitUntil: vi.fn(),
  dispatch: vi.fn(),
  error: vi.fn(),
  mongodb: true,
  dispatchJob: undefined as undefined | ((id: string) => Promise<void>),
}));
const run = worker.run;
vi.mock('../workers/submission-worker/src/scheduled.js', () => ({
  runScheduledWorker: worker.run,
}));
vi.mock('@vercel/functions', () => ({ waitUntil: worker.waitUntil }));
vi.mock('../packages/submission-engine/src/queue.js', () => ({
  dispatch: worker.dispatch,
  usesMongoQueue: () => worker.mongodb,
}));
vi.mock('../apps/api/src/app.js', () => ({
  createApp: (options: { dispatchJob: (id: string) => Promise<void> }) => {
    worker.dispatchJob = options.dispatchJob;
    return express();
  },
  logger: { error: worker.error },
}));
import app from '../apps/api/src/vercel.js';

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  worker.mongodb = true;
  worker.dispatch.mockResolvedValue(undefined);
});
it('registers immediate MongoDB processing with the Vercel response lifetime', async () => {
  let finish!: () => void;
  run.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ busy: false, processedJobs: 1 });
    }),
  );
  const pending = worker.dispatchJob!('authorized-job');
  expect(worker.waitUntil).toHaveBeenCalledWith(pending);
  await Promise.resolve();
  expect(worker.dispatch).toHaveBeenCalledWith('authorized-job');
  expect(run).toHaveBeenCalledWith('authorized-job');
  finish();
  await pending;
});
it('tracks Redis dispatch without starting the MongoDB worker', async () => {
  worker.mongodb = false;
  await worker.dispatchJob!('redis-job');
  expect(worker.waitUntil).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
});
it('logs background processing failures without an unhandled rejection', async () => {
  run.mockRejectedValue(new Error('Worker unavailable'));
  await expect(worker.dispatchJob!('authorized-job')).resolves.toBeUndefined();
  expect(worker.error).toHaveBeenCalledOnce();
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
