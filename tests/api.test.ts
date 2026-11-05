import { beforeAll, beforeEach, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import { sampleForm, sampleAnswers } from './helpers.js';
import { columns } from '../packages/shared/src/index.js';
import { generateTemplate } from '../packages/excel-engine/src/index.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  requestEmailChange: vi.fn(),
  resendEmailChange: vi.fn(),
  verifyEmailChange: vi.fn(),
  cancelEmailChange: vi.fn(),
  signupRequest: vi.fn(),
  signupVerify: vi.fn(),
  signupResend: vi.fn(),
  findUnique: vi.fn(),
  createUser: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  audit: vi.fn(),
  raw: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
  template: vi.fn(),
  createTemplate: vi.fn(),
  upload: vi.fn(),
  job: vi.fn(),
  record: vi.fn(),
  updateRecord: vi.fn(),
  updateJob: vi.fn(),
  transaction: vi.fn(),
  groups: vi.fn(),
}));
vi.mock('../apps/api/src/profile.js', () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
  requestEmailChange: mocks.requestEmailChange,
  resendEmailChange: mocks.resendEmailChange,
  verifyEmailChange: mocks.verifyEmailChange,
  cancelEmailChange: mocks.cancelEmailChange,
  ProfileError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../apps/api/src/signup.js', () => ({
  requestSignup: mocks.signupRequest,
  verifySignup: mocks.signupVerify,
  resendSignup: mocks.signupResend,
  SignupError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../packages/database/src/index.js', () => ({
  db: {
    user: { findUnique: mocks.findUnique, create: mocks.createUser },
    form: { findFirst: mocks.findFirst },
    auditLog: { create: mocks.audit },
    $runCommandRaw: mocks.raw,
    excelTemplate: { findFirst: mocks.template, create: mocks.createTemplate },
    upload: { upsert: mocks.upload },
    submissionJob: { findFirst: mocks.job, updateMany: mocks.updateJob },
    submissionRecord: {
      findFirst: mocks.record,
      updateMany: mocks.updateRecord,
      groupBy: mocks.groups,
    },
    $transaction: mocks.transaction,
  },
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('../packages/submission-engine/src/queue.js', () => ({
  usesMongoQueue: () => process.env.QUEUE_BACKEND === 'mongodb',
  redisConnection: () => ({ ping: mocks.ping, disconnect: mocks.disconnect }),
  dispatch: vi.fn(async () => {}),
}));
let request: ReturnType<typeof supertest>;
let token: string;
beforeAll(async () => {
  process.env.SESSION_SECRET = 'api-test-session-secret-with-at-least-32-characters';
  process.env.DATA_KEY = 'b'.repeat(64);
  process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/formflow_test?replicaSet=rs0';
  process.env.NODE_ENV = 'test';
  process.env.QUEUE_BACKEND = 'redis';
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
  mocks.createUser.mockResolvedValue({
    id: '7926ad27-2a8b-487a-adf1-010723b037a3',
    email: 'test@example.com',
    sessionVersion: 0,
  });
});
it('authenticates profile routes and rejects cross-origin changes', async () => {
  expect((await request.get('/api/profile')).status).toBe(401);
  expect(
    (
      await request
        .post('/api/profile/email-change')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'new@example.com' })
    ).status,
  ).toBe(401);
  expect(mocks.getProfile).not.toHaveBeenCalled();
  expect(mocks.requestEmailChange).not.toHaveBeenCalled();
  expect(
    (
      await request
        .patch('/api/profile')
        .set('Cookie', `session=${token}`)
        .set('Origin', 'https://evil.example')
        .send({ name: 'Bypass' })
    ).status,
  ).toBe(403);
  expect(mocks.updateProfile).not.toHaveBeenCalled();
});
it('reads and updates only the signed-in user profile', async () => {
  mocks.getProfile.mockResolvedValue({
    id: 'current',
    email: 'test@example.com',
    name: 'Test Person',
  });
  const result = await request.get('/api/profile').set('Cookie', `session=${token}`);
  expect(result.status).toBe(200);
  expect(result.body.data.email).toBe('test@example.com');
  expect(mocks.getProfile).toHaveBeenCalledWith(
    expect.objectContaining({ id: '7926ad27-2a8b-487a-adf1-010723b037a3' }),
  );
  mocks.updateProfile.mockResolvedValue({ name: 'Updated Person' });
  const body = { name: 'Updated Person' };
  const updated = await request
    .patch('/api/profile')
    .set('Cookie', `session=${token}`)
    .set('Origin', 'http://localhost:3000')
    .send(body);
  expect(updated.status).toBe(200);
  expect(mocks.updateProfile).toHaveBeenCalledWith('7926ad27-2a8b-487a-adf1-010723b037a3', body);
});
it('issues an email-change challenge without changing the session and rotates it only after verification', async () => {
  const verificationId = '550e8400-e29b-41d4-a716-446655440000';
  mocks.requestEmailChange.mockResolvedValue({ email: 'new@example.com', verificationId });
  const requested = await request
    .post('/api/profile/email-change')
    .set('Cookie', `session=${token}`)
    .set('Origin', 'http://localhost:3000')
    .send({ email: 'new@example.com' });
  expect(requested.status).toBe(202);
  expect(requested.headers['set-cookie']).toBeUndefined();
  const { ProfileError } = await import('../apps/api/src/profile.js');
  mocks.verifyEmailChange.mockRejectedValueOnce(
    new ProfileError(400, 'Incorrect OTP', 'OTP_INVALID'),
  );
  const wrong = await request
    .post('/api/profile/email-change/verify')
    .set('Cookie', `session=${token}`)
    .set('Origin', 'http://localhost:3000')
    .send({ verificationId, code: '000000' });
  expect(wrong.status).toBe(400);
  expect(wrong.headers['set-cookie']).toBeUndefined();
  mocks.verifyEmailChange.mockResolvedValue({
    id: '7926ad27-2a8b-487a-adf1-010723b037a3',
    email: 'new@example.com',
    sessionVersion: 1,
  });
  const verified = await request
    .post('/api/profile/email-change/verify')
    .set('Cookie', `session=${token}`)
    .set('Origin', 'http://localhost:3000')
    .send({ verificationId, code: '123456' });
  expect(verified.status).toBe(200);
  expect(verified.body.data).not.toHaveProperty('sessionVersion');
  const newCookie = verified.headers['set-cookie'][0].split(';')[0];
  mocks.findUnique.mockResolvedValue({
    id: '7926ad27-2a8b-487a-adf1-010723b037a3',
    email: 'new@example.com',
    sessionVersion: 1,
  });
  expect((await request.get('/api/auth/me').set('Cookie', newCookie)).body.data.email).toBe(
    'new@example.com',
  );
  expect((await request.get('/api/auth/me').set('Cookie', `session=${token}`)).status).toBe(401);
});
it('starts signup without issuing a session or creating a user', async () => {
  mocks.signupRequest.mockResolvedValue({
    email: 'test@example.com',
    verificationId: 'pending-id',
    expiresAt: new Date().toISOString(),
    resendAfterSeconds: 60,
  });
  const res = await request
    .post('/api/auth/signup')
    .set('Origin', 'http://localhost:3000')
    .send({ email: 'test@example.com' });
  expect(res.status).toBe(202);
  expect(res.body.data.verificationId).toBe('pending-id');
  expect(res.headers['set-cookie']).toBeUndefined();
  expect(mocks.createUser).not.toHaveBeenCalled();
});
it('only issues an authenticated session after OTP verification succeeds', async () => {
  mocks.signupVerify.mockResolvedValue({
    id: '7926ad27-2a8b-487a-adf1-010723b037a3',
    email: 'test@example.com',
    sessionVersion: 0,
  });
  const body = { email: 'test@example.com', verificationId: 'pending-id', code: '123456' };
  const res = await request
    .post('/api/auth/signup/verify')
    .set('Origin', 'http://localhost:3000')
    .send(body);
  expect(res.status).toBe(201);
  expect(mocks.signupVerify).toHaveBeenCalledWith(body);
  const cookie = res.headers['set-cookie'][0];
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect((await request.get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
});
it('resends a code without authenticating the browser', async () => {
  mocks.signupResend.mockResolvedValue({ email: 'test@example.com', verificationId: 'new-id' });
  const res = await request
    .post('/api/auth/signup/resend')
    .set('Origin', 'http://localhost:3000')
    .send({});
  expect(res.status).toBe(202);
  expect(res.headers['set-cookie']).toBeUndefined();
});
it('rejects signup mutations from another origin before sending email', async () => {
  const res = await request.post('/api/auth/signup').set('Origin', 'https://evil.test').send({});
  expect(res.status).toBe(403);
  expect(mocks.signupRequest).not.toHaveBeenCalled();
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
it.each(['QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED'])(
  'wakes only an owned active batch when polling status %s',
  async (status) => {
    const { createApp } = await import('../apps/api/src/app.js');
    const wake = vi.fn(async () => {});
    const client = supertest(createApp({ dispatchJob: wake }));
    const jobId = '9926ad27-2a8b-487a-adf1-010723b037a3';
    mocks.job.mockResolvedValue({ id: jobId, status });
    mocks.groups.mockResolvedValue([{ status: 'QUEUED', _count: 1 }]);
    expect((await client.get(`/api/submissions/${jobId}`)).status).toBe(401);
    expect(wake).not.toHaveBeenCalled();
    expect(
      (await client.get(`/api/submissions/${jobId}`).set('Cookie', `session=${token}`)).status,
    ).toBe(200);
    if (['QUEUED', 'RUNNING'].includes(status)) expect(wake).toHaveBeenCalledWith(jobId);
    else expect(wake).not.toHaveBeenCalled();
    mocks.job.mockResolvedValue(null);
    wake.mockClear();
    expect(
      (await client.get(`/api/submissions/${jobId}`).set('Cookie', `session=${token}`)).status,
    ).toBe(404);
    expect(wake).not.toHaveBeenCalled();
  },
);
it('validates input and requires explicit submission authorization', async () => {
  const res = await request
    .post('/api/submissions/start')
    .set('Origin', 'http://localhost:3000')
    .set('Cookie', `session=${token}`)
    .send({ uploadId: 'bad', authorized: false });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});
it.each(['embedded', 'addin'])('downloads %s templates with the analyzed choices', async (mode) => {
  const definition = sampleForm();
  const templateId = '6926ad27-2a8b-487a-adf1-010723b037a3';
  mocks.findFirst.mockResolvedValue({
    id: '9926ad27-2a8b-487a-adf1-010723b037a3',
    schemas: [{ id: 'schema', definition }],
  });
  mocks.createTemplate.mockResolvedValue({ id: templateId });
  const response = await request
    .get(`/api/forms/9926ad27-2a8b-487a-adf1-010723b037a3/template?mode=${mode}`)
    .set('Cookie', `session=${token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
      res.on('error', callback);
    });
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain(
    mode === 'addin' ? 'spreadsheetml.sheet' : 'macroEnabled.12',
  );
  expect(response.headers['content-disposition']).toContain(mode === 'addin' ? '.xlsx' : '.xlsm');
  const zip = await JSZip.loadAsync(response.body);
  expect(Boolean(zip.file('xl/vbaProject.bin'))).toBe(mode === 'embedded');
  expect(response.headers['x-template-id']).toBe(templateId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const validation = workbook.getWorksheet('Responses')!.getCell('C2').dataValidation;
  expect(validation.type).toBe('list');
  expect(workbook.definedNames.getRanges(String(validation.formulae![0])).ranges).toHaveLength(1);
  const reference = workbook.getWorksheet('Validation Reference')!;
  const options: string[] = [];
  reference.eachRow((row) => {
    if (row.getCell(1).text === columns(definition)[2].heading) options.push(row.getCell(2).text);
  });
  expect(options).toEqual(['Engineering', 'Operations']);
});
it('serves the built add-in only to authenticated users', async () => {
  expect((await request.get('/api/excel/addin')).status).toBe(401);
  const response = await request
    .get('/api/excel/addin')
    .set('Cookie', `session=${token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
      res.on('error', callback);
    });
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain('FormFlowMultiSelect.xlam');
  const zip = await JSZip.loadAsync(response.body);
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
    'addin.macroEnabled.main+xml',
  );
  expect(zip.file('xl/vbaProject.bin')).not.toBeNull();
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
it.each(['xlsx', 'xlsm'])(
  'accepts %s responses and returns form restrictions separately from valid rows',
  async (extension) => {
    const templateId = '6926ad27-2a8b-487a-adf1-010723b037a3';
    const form = sampleForm();
    form.blockers = ['This Google Form requires respondents to sign in to Google.'];
    mocks.template.mockResolvedValue({
      schemaId: 'schema',
      schema: { definition: form, form: { id: 'form-id', schemas: [{ id: 'schema' }] } },
    });
    mocks.upload.mockResolvedValue({ id: 'upload-id' });
    const book = new ExcelJS.Workbook();
    const original = await generateTemplate(form, templateId, 10);
    await book.xlsx.load(original as any);
    book
      .getWorksheet('Responses')!
      .addRow(columns(form).map((c) => sampleAnswers[c.key as keyof typeof sampleAnswers]));
    let filled: Buffer = Buffer.from(await book.xlsx.writeBuffer());
    if (extension === 'xlsm') {
      const originalZip = await JSZip.loadAsync(original);
      const filledZip = await JSZip.loadAsync(filled);
      filledZip.file(
        'xl/vbaProject.bin',
        await originalZip.file('xl/vbaProject.bin')!.async('nodebuffer'),
      );
      filled = await filledZip.generateAsync({ type: 'nodebuffer' });
    }
    const res = await request
      .post('/api/uploads/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `session=${token}`)
      .field('templateId', templateId)
      .attach('file', filled, `responses.${extension}`);
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(1);
    expect(res.body.data.formBlockers).toEqual(form.blockers);
    expect(res.body.data.formId).toBe('form-id');
    expect(res.body.data.rows[0].answers).toBeUndefined();
  },
);
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
  expect(mocks.updateRecord.mock.calls[0][0].where.OR).toEqual([
    { submitIntentAt: null },
    { submitIntentAt: { isSet: false } },
  ]);
  mocks.record.mockResolvedValue({ ...row, status: 'UNKNOWN' });
  expect((await send()).status).toBe(409);
  mocks.record.mockResolvedValue({ ...row, submitIntentAt: new Date() });
  expect((await send()).status).toBe(409);
  expect(mocks.transaction).toHaveBeenCalledOnce();
});
