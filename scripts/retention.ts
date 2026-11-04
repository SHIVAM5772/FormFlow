import 'dotenv/config';
import { db } from '../packages/database/src/index.js';
const days = Number(process.env.RETENTION_DAYS ?? 30);
if (!Number.isInteger(days) || days < 1)
  throw new Error('RETENTION_DAYS must be a positive integer');
const cutoff = new Date(Date.now() - days * 86400000);
try {
  // Retain recent send counters long enough to preserve the per-email rate limit.
  await db.signupVerification.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 15 * 60000) } },
  });
  await db.emailChangeVerification.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 15 * 60000) } },
  });
  const result = await db.upload.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [
        { job: null },
        {
          job: {
            status: { in: ['COMPLETED', 'CANCELLED'] },
            records: { none: { status: 'RUNNING' } },
          },
        },
      ],
    },
  });
  const audits = await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  console.log(
    `Removed ${result.count} expired uploads/batches and ${audits.count} audit events. Form schemas are retained until user deletion.`,
  );
} finally {
  await db.$disconnect();
}
