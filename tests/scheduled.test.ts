import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  renew: vi.fn(),
  owned: vi.fn(),
  release: vi.fn(),
  findMany: vi.fn(),
  process: vi.fn(),
}));
vi.mock('../packages/database/src/index.js', () => ({
  db: { submissionJob: { findMany: mocks.findMany } },
}));
vi.mock('../packages/submission-engine/src/lease.js', () => ({ workerLease: () => mocks }));
vi.mock('../packages/submission-engine/src/process.js', () => ({ processBatch: mocks.process }));
import { runScheduledWorker } from '../workers/submission-worker/src/scheduled.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  process.env.QUEUE_BACKEND = 'mongodb';
  mocks.acquire.mockResolvedValue(true);
  mocks.renew.mockResolvedValue(true);
  mocks.owned.mockResolvedValue(true);
  mocks.release.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it('does not consume jobs while another worker owns the lease', async () => {
  mocks.acquire.mockResolvedValue(false);
  expect(await runScheduledWorker()).toEqual({ busy: true, processedJobs: 0 });
  expect(mocks.findMany).not.toHaveBeenCalled();
});
it('stops starting jobs at the invocation budget and releases its lease', async () => {
  mocks.findMany.mockResolvedValue([{ id: 'first' }, { id: 'second' }]);
  mocks.process.mockImplementation(async (_id, _publish, _submit, owned, canStart) => {
    expect(await owned()).toBe(true);
    expect(canStart()).toBe(true);
    vi.setSystemTime(Date.now() + 180001);
    expect(canStart()).toBe(false);
  });
  expect((await runScheduledWorker()).processedJobs).toBe(1);
  expect(mocks.process).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('releases the lease and heartbeat when database access fails', async () => {
  mocks.findMany.mockRejectedValue(new Error('Unavailable'));
  await expect(runScheduledWorker()).rejects.toThrow('Unavailable');
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
