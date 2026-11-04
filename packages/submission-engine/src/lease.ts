import { randomUUID } from 'node:crypto';
import { db } from '../../database/src/index.js';
import { Prisma } from '../../database/generated/client/index.js';

export const WORKER_LEASE_ID = 'submission-worker';
const LEASE_MS = 60000;

// A global consumer lease prevents overlapping releases from processing the
// same batch. Browser submission intent checks ownership again before sending.
export function workerLease() {
  const owner = randomUUID();
  return {
    async acquire() {
      const now = new Date();
      const data = { owner, expiresAt: new Date(now.getTime() + LEASE_MS) };
      const claimed = await db.workerLease.updateMany({
        where: { id: WORKER_LEASE_ID, expiresAt: { lte: now } },
        data,
      });
      if (claimed.count) return true;
      try {
        await db.workerLease.create({ data: { id: WORKER_LEASE_ID, ...data } });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          return false;
        throw error;
      }
    },
    async renew() {
      const now = new Date();
      const result = await db.workerLease.updateMany({
        where: { id: WORKER_LEASE_ID, owner, expiresAt: { gt: now } },
        data: { expiresAt: new Date(now.getTime() + LEASE_MS) },
      });
      return result.count === 1;
    },
    async owned() {
      return (
        (await db.workerLease.count({
          where: { id: WORKER_LEASE_ID, owner, expiresAt: { gt: new Date() } },
        })) === 1
      );
    },
    async release() {
      await db.workerLease.deleteMany({ where: { id: WORKER_LEASE_ID, owner } });
    },
  };
}
