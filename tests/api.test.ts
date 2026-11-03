import { beforeAll, beforeEach, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import { sampleForm, sampleAnswers } from './helpers.js';
import { columns } from '../packages/shared/src/index.js';
import { generateTemplate } from '../packages/excel-engine/src/index.js';
import ExcelJS from 'exceljs';
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  audit: vi.fn(),
  raw: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
  template: vi.fn(),
  upload: vi.fn(),
  job: vi.fn(),
  record: vi.fn(),
  updateRecord: vi.fn(),
  updateJob: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../packages/database/src/index.js', () => ({
  db: {
    user: { findUnique: mocks.findUnique },
    form: { findFirst: mocks.findFirst },
    auditLog: { create: mocks.audit },
    $queryRaw: mocks.raw,
    excelTemplate: { findFirst: mocks.template },
    upload: { upsert: mocks.upload },
    submissionJob: { findFirst: mocks.job, updateMany: mocks.updateJob },
    submissionRecord: { findFirst: mocks.record, updateMany: mocks.updateRecord },
    $transaction: mocks.transaction,
  },
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('../packages/submission-engine/src/queue.js', () => ({
  redisConnection: () => ({ ping: mocks.ping, disconnect: mocks.disconnect }),
  dispatch: vi.fn(async () => {}),
}));
let request: ReturnType<typeof supertest>;
let token: string;
beforeAll(async () => {
  process.env.SESSION_SECRET = 'api-test-session-secret-with-at-least-32-characters';
  process.env.DATA_KEY = 'b'.repeat(64);
  process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/formflow_test';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../apps/api/src/app.js');
  const { signSession } = await import('../apps/api/src/auth.js');
  request = supertest(createApp());
  token = await signSession('7926ad27-2a8b-487a-adf1-010723b037a3', 0);
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockResolvedValue([{ ready: 1 }]);
  mocks.ping.mockResolvedValue('PONG');
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      submissionRecord: { updateMany: mocks.updateRecord },
      submissionJob: { updateMany: mocks.updateJob },
    }),
  );
  mocks.findUnique.mockResolvedValue({
    id: '7926ad27-2a8b-487a-adf1-010723b037a3',
    email: 'test@example.com',
    sessionVersion: 0,
  });
});
it('exposes liveness without authentication', async () => {
  const res = await request.get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('ok');
});
it('reports readiness only when both service probes succeed and releases its Redis client', async () => {
  const res = await request.get('/api/health/ready');
  expect(res.status).toBe(200);
  expect(mocks.raw).toHaveBeenCalledOnce();
  expect(mocks.ping).toHaveBeenCalledOnce();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
it('returns a structured unavailable status when a readiness dependency fails', async () => {
  mocks.raw.mockRejectedValueOnce(new Error('Database unavailable'));
  const res = await request.get('/api/health/ready');
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe('NOT_READY');
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
it('requires authentication on form routes', async () => {
  const res = await request.get('/api/forms');
  expect(res.status).toBe(401);
  expect(mocks.findFirst).not.toHaveBeenCalled();
});
it('rejects cross-origin mutations before reading credentials or request data', async () => {
  const res = await request
    .post('/api/submissions/start')
    .set('Origin', 'https://evil.test')
    .send({});
  expect(res.status).toBe(403);
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
it('does not leak another user’s form', async () => {
  mocks.findFirst.mockResolvedValue(null);
  const res = await request
    .get('/api/forms/9926ad27-2a8b-487a-adf1-010723b037a3')
    .set('Cookie', `session=${token}`);
  expect(res.status).toBe(404);
  expect(mocks.findFirst.mock.calls[0][0].where.userId).toBe(
    '7926ad27-2a8b-487a-adf1-010723b037a3',
  );
});
it('validates input and requires explicit submission authorization', async () => {
  const res = await request
    .post('/api/submissions/start')
    .set('Origin', 'http://localhost:3000')
    .set('Cookie', `session=${token}`)
    .send({ uploadId: 'bad', authorized: false });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});
it('refuses to generate an empty Excel template when no questions are accessible', async () => {
  const definition = sampleForm();
  definition.questions = [];
  mocks.findFirst.mockResolvedValue({
    id: '9926ad27-2a8b-487a-adf1-010723b037a3',
    schemas: [{ id: 'schema', definition }],
  });
  const res = await request
    .get('/api/forms/9926ad27-2a8b-487a-adf1-010723b037a3/template')
    .set('Cookie', `session=${token}`);
  expect(res.status).toBe(409);
  expect(res.body.error.message).toContain('No questions');
});
it('returns form restrictions separately from valid workbook rows before submission', async () => {
  const templateId = '6926ad27-2a8b-487a-adf1-010723b037a3';
  const form = sampleForm();
  form.blockers = ['This Google Form requires respondents to sign in to Google.'];
  mocks.template.mockResolvedValue({
    schemaId: 'schema',
    schema: { definition: form, form: { id: 'form-id', schemas: [{ id: 'schema' }] } },
  });
  mocks.upload.mockResolvedValue({ id: 'upload-id' });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 10)) as any);
  book
    .getWorksheet('Responses')!
    .addRow(columns(form).map((c) => sampleAnswers[c.key as keyof typeof sampleAnswers]));
  const res = await request
    .post('/api/uploads/validate')
    .set('Origin', 'http://localhost:3000')
    .set('Cookie', `session=${token}`)
    .field('templateId', templateId)
    .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'responses.xlsx');
  expect(res.status).toBe(200);
  expect(res.body.data.valid).toBe(1);
  expect(res.body.data.formBlockers).toEqual(form.blockers);
  expect(res.body.data.formId).toBe('form-id');
  expect(res.body.data.rows[0].answers).toBeUndefined();
});
it('allows an explicit retry for a pre-submit mapping failure but refuses UNKNOWN or intent-bearing records', async () => {
  const jobId = '9926ad27-2a8b-487a-adf1-010723b037a3';
  const recordId = '6926ad27-2a8b-487a-adf1-010723b037a3';
  mocks.job.mockResolvedValue({ id: jobId, status: 'PAUSED' });
  const row = {
    id: recordId,
    status: 'NEEDS_MANUAL_ACTION',
    submitIntentAt: null,
    error: 'Cannot reliably locate question: Name',
  };
  mocks.record.mockResolvedValue(row);
  mocks.updateRecord.mockResolvedValue({ count: 1 });
  mocks.updateJob.mockResolvedValue({ count: 1 });
  const send = () =>
    request
      .post(`/api/submissions/${jobId}/retry`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `session=${token}`)
      .send({ recordId });
  expect((await send()).status).toBe(200);
  expect(mocks.updateRecord.mock.calls[0][0].where.submitIntentAt).toBeNull();
  mocks.record.mockResolvedValue({ ...row, status: 'UNKNOWN' });
  expect((await send()).status).toBe(409);
  mocks.record.mockResolvedValue({ ...row, submitIntentAt: new Date() });
  expect((await send()).status).toBe(409);
  expect(mocks.transaction).toHaveBeenCalledOnce();
});
