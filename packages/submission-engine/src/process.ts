import { db, decrypt } from '../../database/src/index.js';
import { formSchema, type Answers, type RecordState } from '../../shared/src/index.js';
import { submitResponse } from './browser.js';
export type Progress = (userId: string, jobId: string) => Promise<void>;
export async function processBatch(
  jobId: string,
  publish: Progress,
  submit = submitResponse,
  ownsLease: () => Promise<boolean> = async () => true,
  canStartRecord: () => boolean = () => true,
) {
  if (!(await ownsLease())) return;
  const job = await db.submissionJob.findUnique({
    where: { id: jobId },
    include: { upload: { include: { template: { include: { schema: true } } } } },
  });
  if (!job) return;
  // Re-delivery of a batch cannot prove what the previous browser did. Do not replay in-flight rows.
  await db.submissionRecord.updateMany({
    where: { jobId, status: 'RUNNING' },
    data: {
      status: 'UNKNOWN',
      error:
        'Worker interrupted. Previous browser result is unverified; this row will not be retried.',
    },
  });
  await db.submissionAttempt.updateMany({
    where: { record: { jobId }, status: 'RUNNING' },
    data: { status: 'UNKNOWN', finishedAt: new Date(), error: 'Worker interrupted' },
  });
  if (!['QUEUED', 'RUNNING'].includes(job.status)) {
    await publish(job.userId, jobId);
    return;
  }
  const claimed = await db.submissionJob.updateMany({
    where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'RUNNING', reason: null },
  });
  if (!claimed.count) return;
  const form = formSchema.parse(job.upload.template.schema.definition);
  while (true) {
    // Finish between rows before a scheduled invocation reaches its deadline.
    if (!canStartRecord()) break;
    if (!(await ownsLease())) return;
    const state = await db.submissionJob.findUnique({ where: { id: jobId } });
    if (state?.status !== 'RUNNING') break;
    const record = await db.submissionRecord.findFirst({
      where: { jobId, status: 'QUEUED' },
      orderBy: { rowNumber: 'asc' },
    });
    if (!record) break;
    const claim = await db.submissionRecord.updateMany({
      where: { id: record.id, status: 'QUEUED', job: { status: 'RUNNING' } },
      data: { status: 'RUNNING', attemptCount: { increment: 1 }, error: null },
    });
    if (!claim.count) continue;
    const attempt = await db.submissionAttempt.create({
      data: { recordId: record.id, status: 'RUNNING' },
    });
    await publish(job.userId, jobId);
    const result = await submit(form, decrypt<Answers>(record.encryptedAnswers), {
      isStopped: async () =>
        !(await ownsLease()) ||
        (await db.submissionJob.findUnique({ where: { id: jobId }, select: { status: true } }))
          ?.status !== 'RUNNING',
      beforeSubmit: async () => {
        if (!(await ownsLease())) return false;
        const updated = await db.submissionRecord.updateMany({
          where: {
            id: record.id,
            status: 'RUNNING',
            OR: [{ submitIntentAt: null }, { submitIntentAt: { isSet: false } }],
            job: { status: 'RUNNING' },
          },
          data: { submitIntentAt: new Date() },
        });
        return updated.count === 1;
      },
    });
    if (!(await ownsLease())) return;
    const current = await db.submissionJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    const status: RecordState =
      result.status === 'QUEUED' && current?.status === 'CANCELLED' ? 'CANCELLED' : result.status;
    await db.$transaction([
      db.submissionRecord.updateMany({
        where: { id: record.id, status: 'RUNNING' },
        data: { status, error: result.error ?? null, submittedAt: result.submittedAt },
      }),
      db.submissionAttempt.update({
        where: { id: attempt.id },
        data: { status, error: result.error ?? null, finishedAt: new Date() },
      }),
    ]);
    if (status === 'NEEDS_MANUAL_ACTION')
      await db.submissionJob.updateMany({
        where: { id: jobId, status: 'RUNNING' },
        data: { status: 'PAUSED', reason: result.error },
      });
    await publish(job.userId, jobId);
    if (status === 'QUEUED') break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1000, Number(process.env.RECORD_DELAY_MS ?? 3000))),
    );
  }
  const remaining = await db.submissionRecord.count({
    where: { jobId, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (!remaining)
    await db.submissionJob.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: { status: 'COMPLETED' },
    });
  await publish(job.userId, jobId);
}
