import { beforeEach, it, expect, vi } from 'vitest';
import { sampleForm, sampleAnswers } from './helpers.js';
import type {
  SubmissionHooks,
  SubmissionResult,
} from '../packages/submission-engine/src/browser.js';
const storage = vi.hoisted(() => ({ job: {} as any, records: [] as any[], attempts: [] as any[] }));
function matches(record: any, where: any) {
  return (
    (!where.OR ||
      where.OR.some((clause: any) =>
        clause.submitIntentAt?.isSet === false
          ? !Object.hasOwn(record, 'submitIntentAt')
          : record.submitIntentAt === clause.submitIntentAt,
      )) &&
    (!where.id || record.id === where.id) &&
    (!where.jobId || record.jobId === where.jobId) &&
    (!where.status ||
      (typeof where.status === 'string'
        ? record.status === where.status
        : where.status.in.includes(record.status))) &&
    (!Object.hasOwn(where, 'submitIntentAt') || record.submitIntentAt === where.submitIntentAt) &&
    (!where.job || storage.job.status === where.job.status)
  );
}
vi.mock('../packages/database/src/index.js', () => ({
  decrypt: (value: string) => JSON.parse(value),
  db: {
    submissionJob: {
      findUnique: async () => storage.job,
      updateMany: async ({ where, data }: any) => {
        if (
          where.status &&
          (typeof where.status === 'string'
            ? storage.job.status !== where.status
            : !where.status.in.includes(storage.job.status))
        )
          return { count: 0 };
        Object.assign(storage.job, data);
        return { count: 1 };
      },
    },
    submissionRecord: {
      findFirst: async ({ where }: any) => storage.records.find((r) => matches(r, where)),
      count: async ({ where }: any) => storage.records.filter((r) => matches(r, where)).length,
      updateMany: async ({ where, data }: any) => {
        const rows = storage.records.filter((r) => matches(r, where));
        for (const row of rows) {
          for (const [key, value] of Object.entries(data))
            row[key] = key === 'attemptCount' ? row[key] + (value as any).increment : value;
        }
        return { count: rows.length };
      },
    },
    submissionAttempt: {
      create: async ({ data }: any) => {
        const attempt = { id: String(storage.attempts.length), ...data };
        storage.attempts.push(attempt);
        return attempt;
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          storage.attempts.find((a) => a.id === where.id),
          data,
        ),
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (values: Promise<any>[]) => Promise.all(values),
  },
}));
import { processBatch } from '../packages/submission-engine/src/process.js';
beforeEach(() => {
  storage.job = {
    id: 'batch',
    userId: 'user',
    status: 'QUEUED',
    upload: { template: { schema: { definition: sampleForm() } } },
  };
  storage.records = [2, 3].map((rowNumber) => ({
    id: String(rowNumber),
    rowNumber,
    jobId: 'batch',
    status: 'QUEUED',
    attemptCount: 0,
    submitIntentAt: null,
    encryptedAnswers: JSON.stringify(sampleAnswers),
  }));
  storage.attempts = [];
  process.env.RECORD_DELAY_MS = '1000';
});
const publish = async () => {};
it('does not recover or submit records when the worker does not own its lease', async () => {
  storage.records[0].status = 'RUNNING';
  const submit = vi.fn();
  await processBatch('batch', publish, submit, async () => false);
  expect(submit).not.toHaveBeenCalled();
  expect(storage.records[0].status).toBe('RUNNING');
});
it('refuses submission when ownership is lost after browser preparation', async () => {
  let owned = true;
  const submit = vi.fn(async (_form, _answers, hooks: SubmissionHooks) => {
    owned = false;
    expect(await hooks.isStopped()).toBe(true);
    expect(await hooks.beforeSubmit()).toBe(false);
    return { status: 'QUEUED' as const };
  });
  await processBatch('batch', publish, submit, async () => owned);
  expect(storage.records[0].submitIntentAt).toBeNull();
  expect(storage.records[0].status).toBe('RUNNING');
});
it('allows first submission when MongoDB omitted the optional intent field', async () => {
  delete storage.records[0].submitIntentAt;
  await processBatch('batch', publish, successful);
  expect(storage.records[0].status).toBe('SUBMITTED');
});
async function successful(
  _form: any,
  _answers: any,
  hooks: SubmissionHooks,
): Promise<SubmissionResult> {
  if (!(await hooks.beforeSubmit())) return { status: 'QUEUED' };
  return { status: 'SUBMITTED', submittedAt: new Date() };
}
it('processes rows sequentially, records intent before submission, and does not replay a completed batch', async () => {
  const submit = vi.fn(successful);
  await processBatch('batch', publish, submit);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(storage.records.map((r) => r.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
  expect(storage.records.every((r) => r.submitIntentAt instanceof Date)).toBe(true);
  expect(storage.job.status).toBe('COMPLETED');
  await processBatch('batch', publish, submit);
  expect(submit).toHaveBeenCalledTimes(2);
});
it('pauses for manual intervention and resumes only remaining queued rows', async () => {
  const submit = vi
    .fn()
    .mockResolvedValueOnce({ status: 'NEEDS_MANUAL_ACTION', error: 'CAPTCHA' })
    .mockImplementation(successful);
  await processBatch('batch', publish, submit);
  expect(storage.job.status).toBe('PAUSED');
  expect(storage.records.map((r) => r.status)).toEqual(['NEEDS_MANUAL_ACTION', 'QUEUED']);
  storage.job.status = 'QUEUED';
  await processBatch('batch', publish, submit);
  expect(storage.records.map((r) => r.status)).toEqual(['NEEDS_MANUAL_ACTION', 'SUBMITTED']);
  expect(submit).toHaveBeenCalledTimes(2);
});
it('preserves UNKNOWN and continues independent rows without replay', async () => {
  const submit = vi
    .fn()
    .mockImplementationOnce(async (_form, _answers, hooks) => {
      await hooks.beforeSubmit();
      return { status: 'UNKNOWN', error: 'Confirmation missing' };
    })
    .mockImplementation(successful);
  await processBatch('batch', publish, submit);
  expect(storage.records.map((r) => r.status)).toEqual(['UNKNOWN', 'SUBMITTED']);
  await processBatch('batch', publish, submit);
  expect(submit).toHaveBeenCalledTimes(2);
});
it('recovers an interrupted intent as UNKNOWN without another submission attempt', async () => {
  const submit = vi
    .fn()
    .mockImplementationOnce(async (_form, _answers, hooks) => {
      await hooks.beforeSubmit();
      throw new Error('Process terminated');
    })
    .mockImplementation(successful);
  await expect(processBatch('batch', publish, submit)).rejects.toThrow('Process terminated');
  expect(storage.records[0].status).toBe('RUNNING');
  await processBatch('batch', publish, submit);
  expect(storage.records.map((r) => r.status)).toEqual(['UNKNOWN', 'SUBMITTED']);
  expect(storage.records[0].attemptCount).toBe(1);
});
it('respects cancellation immediately before durable intent', async () => {
  const submit = vi.fn(async (_form, _answers, hooks) => {
    storage.job.status = 'CANCELLED';
    expect(await hooks.beforeSubmit()).toBe(false);
    return { status: 'QUEUED' } as SubmissionResult;
  });
  await processBatch('batch', publish, submit);
  expect(storage.records[0].status).toBe('CANCELLED');
  expect(storage.records[0].submitIntentAt).toBeNull();
  expect(submit).toHaveBeenCalledOnce();
});
it('settles an interrupted row even when cancellation happened before recovery', async () => {
  storage.job.status = 'CANCELLED';
  storage.records[0].status = 'RUNNING';
  storage.records[0].submitIntentAt = new Date();
  storage.records[1].status = 'CANCELLED';
  const submit = vi.fn(successful);
  await processBatch('batch', publish, submit);
  expect(storage.records.map((r) => r.status)).toEqual(['UNKNOWN', 'CANCELLED']);
  expect(storage.job.status).toBe('CANCELLED');
  expect(submit).not.toHaveBeenCalled();
});
