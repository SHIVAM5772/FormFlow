import 'dotenv/config';
import { beforeAll, afterAll, it, expect } from 'vitest';
import supertest from 'supertest';
import { PrismaClient } from '../../packages/database/generated/client/index.js';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { fixtureServer } from '../fixture-server.js';
import { sampleForm, sampleAnswers } from '../helpers.js';
import { columns, type FormDefinition } from '../../packages/shared/src/index.js';
import { submitLocalFixture } from '../../packages/submission-engine/src/browser.js';
import { usesMongoQueue } from '../../packages/submission-engine/src/queue.js';

// Explicitly opt into a disposable test database. Never create, flush, or reset a user's database.
const databaseUrl = new URL(process.env.DATABASE_URL ?? 'mongodb://invalid/invalid');
if (!databaseUrl.pathname.endsWith('_test'))
  throw new Error('Service tests require DATABASE_URL ending in _test');
if (!usesMongoQueue() && !process.env.REDIS_URL?.endsWith('/15'))
  throw new Error('Service tests require dedicated REDIS_URL database /15');
const userId = randomUUID();
let fixture: Awaited<ReturnType<typeof fixtureServer>>;
let db: PrismaClient;
let uploadId: string;
let token: string;
let request: ReturnType<typeof supertest>;
let schema: FormDefinition;
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_KEY ??= 'c'.repeat(64);
  process.env.SESSION_SECRET ??= 'service-tests-session-secret-longer-than-32';
  fixture = await fixtureServer();
  schema = sampleForm(fixture.url);
  const database = await import('../../packages/database/src/index.js');
  db = database.db;
  await db.user.create({
    data: { id: userId, email: `${userId}@example.com`, passwordHash: 'not-a-login-hash' },
  });
  const form = await db.form.create({
    data: {
      userId,
      title: schema.title,
      sourceUrl: schema.sourceUrl,
      schemas: {
        create: {
          version: 1,
          fingerprint: schema.fingerprint,
          definition: JSON.parse(JSON.stringify(schema)),
        },
      },
    },
    include: { schemas: true },
  });
  const template = await db.excelTemplate.create({ data: { schemaId: form.schemas[0].id } });
  const { createApp } = await import('../../apps/api/src/app.js');
  const { signSession } = await import('../../apps/api/src/auth.js');
  request = supertest(createApp());
  token = await signSession(userId, 0);
  const templateResponse = await request
    .get(`/api/forms/${form.id}/template`)
    .set('Cookie', `session=${token}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(templateResponse.status).toBe(200);
  const templateId = templateResponse.headers['x-template-id'];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(templateResponse.body as any);
  book
    .getWorksheet('Responses')!
    .addRow(columns(schema).map((c) => sampleAnswers[c.key as keyof typeof sampleAnswers]));
  const validate = await request
    .post('/api/uploads/validate')
    .set('Cookie', `session=${token}`)
    .set('Origin', 'http://localhost:3000')
    .field('templateId', templateId)
    .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'responses.xlsx');
  expect(validate.status).toBe(200);
  expect(validate.body.data.valid).toBe(1);
  uploadId = validate.body.data.id;
  expect(template.id).toBeTruthy();
});
afterAll(async () => {
  if (db) {
    await db.user.deleteMany({ where: { id: userId } });
    await db.workerLease.deleteMany({ where: { id: 'submission-worker' } });
    await db.$disconnect();
  }
  await fixture?.close();
  const { closeQueue } = await import('../../packages/submission-engine/src/queue.js');
  await closeQueue();
});
it('coordinates overlapping MongoDB workers and recovers an expired lease', async () => {
  const { workerLease } = await import('../../packages/submission-engine/src/lease.js');
  const first = workerLease();
  const second = workerLease();
  expect(await first.acquire()).toBe(true);
  expect(await second.acquire()).toBe(false);
  expect(await first.renew()).toBe(true);
  await db.workerLease.update({
    where: { id: 'submission-worker' },
    data: { expiresAt: new Date(0) },
  });
  expect(await first.owned()).toBe(false);
  expect(await second.acquire()).toBe(true);
  expect(await first.renew()).toBe(false);
  await first.release();
  expect(await second.owned()).toBe(true);
  await second.release();
});
it('persists API validation, deduplicates start, honors pause/resume, processes a real browser row and reports it', async () => {
  const start = async () =>
    request
      .post('/api/submissions/start')
      .set('Cookie', `session=${token}`)
      .set('Origin', 'http://localhost:3000')
      .send({ uploadId, authorized: true, confirmedValidRows: 1 });
  const started = await start();
  expect(started.status).toBe(201);
  const jobId = started.body.data.id;
  expect((await start()).body.data.id).toBe(jobId);
  for (const action of ['pause', 'resume']) {
    const res = await request
      .post(`/api/submissions/${jobId}/${action}`)
      .set('Cookie', `session=${token}`)
      .set('Origin', 'http://localhost:3000')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(action === 'pause' ? 'PAUSED' : 'QUEUED');
  }
  const { processBatch } = await import('../../packages/submission-engine/src/process.js');
  const events: string[] = [];
  await processBatch(
    jobId,
    async (_user, id) => {
      events.push(id);
    },
    submitLocalFixture,
  );
  const fresh = new PrismaClient();
  try {
    const record = await fresh.submissionRecord.findFirstOrThrow({ where: { jobId } });
    expect(record.status).toBe('SUBMITTED');
    expect(record.submittedAt).toBeInstanceOf(Date);
    expect(record.submitIntentAt).toBeInstanceOf(Date);
    expect(record.encryptedAnswers).not.toContain('0012345678');
  } finally {
    await fresh.$disconnect();
  }
  expect(events.length).toBeGreaterThan(1);
  expect(fixture.submitted).toHaveLength(1);
  const report = await request
    .get(`/api/submissions/${jobId}/report`)
    .set('Cookie', `session=${token}`);
  expect(report.status).toBe(200);
  await processBatch(jobId, async () => {}, submitLocalFixture);
  expect(fixture.submitted).toHaveLength(1);
});
it('never replays an interrupted in-flight row', async () => {
  const original = await db.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const copy = await db.upload.create({
    data: {
      userId,
      templateId: original.templateId,
      checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      total: 1,
      valid: 1,
      invalid: 0,
      encryptedData: original.encryptedData,
    },
  });
  const { encrypt } = await import('../../packages/database/src/index.js');
  const job = await db.submissionJob.create({
    data: {
      userId,
      uploadId: copy.id,
      title: 'Interrupted',
      authorizedAt: new Date(),
      status: 'RUNNING',
      records: {
        create: {
          rowNumber: 2,
          encryptedAnswers: encrypt(sampleAnswers),
          status: 'RUNNING',
          submitIntentAt: new Date(),
        },
      },
    },
  });
  const { processBatch } = await import('../../packages/submission-engine/src/process.js');
  const before = fixture.submitted.length;
  await processBatch(job.id, async () => {}, submitLocalFixture);
  expect((await db.submissionRecord.findFirstOrThrow({ where: { jobId: job.id } })).status).toBe(
    'UNKNOWN',
  );
  expect(fixture.submitted).toHaveLength(before);
});
it.skipIf(usesMongoQueue())(
  'uses a durable BullMQ queue and emits real progress through Redis',
  async () => {
    const name = `formflow-test-${randomUUID()}`;
    const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const sub = connection.duplicate();
    const queue = new Queue(name, { connection });
    const observed: string[] = [];
    await sub.subscribe(name);
    sub.on('message', (_channel, message) => observed.push(message));
    const worker = new Worker(
      name,
      async (job) => {
        await connection.publish(name, String(job.data.value));
        return { saved: true };
      },
      { connection },
    );
    try {
      const job = await queue.add('test', { value: 'progress' });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Queue timeout')), 10000);
        worker.on('completed', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      expect(await job.getState()).toBe('completed');
      expect(observed).toContain('progress');
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await sub.quit();
      await connection.quit();
    }
  },
);
