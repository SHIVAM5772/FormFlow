import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  create: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock('../packages/database/src/index.js', () => ({ db: { workerLease: mocks } }));
import { workerLease } from '../packages/submission-engine/src/lease.js';
import { Prisma } from '../packages/database/generated/client/index.js';

beforeEach(() => {
  vi.resetAllMocks();
});
it('only acquires an expired lease and does not claim an active consumer', async () => {
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('Duplicate', {
      code: 'P2002',
      clientVersion: '6.19.0',
    }),
  );
  expect(await workerLease().acquire()).toBe(false);
  expect(mocks.updateMany.mock.calls[0][0].where.expiresAt.lte).toBeInstanceOf(Date);
});
it('renews only its own unexpired lease and releases only its own ownership', async () => {
  const lease = workerLease();
  mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  expect(await lease.renew()).toBe(true);
  expect(await lease.renew()).toBe(false);
  await lease.release();
  const where = mocks.updateMany.mock.calls[0][0].where;
  expect(where.expiresAt.gt).toBeInstanceOf(Date);
  expect(mocks.deleteMany.mock.calls[0][0].where.owner).toBe(where.owner);
});
