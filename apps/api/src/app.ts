import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { Prisma } from '../../../packages/database/generated/client/index.js';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { db, encrypt, decrypt } from '../../../packages/database/src/index.js';
import { FormAnalyzer } from '../../../packages/form-analyzer/src/index.js';
import {
  generateTemplate,
  parseUpload,
  reportWorkbook,
} from '../../../packages/excel-engine/src/index.js';
import {
  formSchema,
  safeToRetry,
  type ValidationResult,
  type RecordState,
} from '../../../packages/shared/src/index.js';
import {
  dispatch,
  redisConnection,
  usesMongoQueue,
} from '../../../packages/submission-engine/src/queue.js';
import { config, webOrigins } from './config.js';
import { cookieOptions, requireAuth, sameOrigin, signSession } from './auth.js';
import { google, googleAccess } from './google.js';
import { requestSignup, resendSignup, verifySignup, SignupError } from './signup.js';

export const logger = pino({
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'res.headers.set-cookie',
    'password',
    'answers',
    'googleRefresh',
  ],
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
});
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}
const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const id = z.string().uuid();
function uid(res: Response): string {
  return res.locals.user.id;
}
function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
async function audit(userId: string, action: string, entityId?: string) {
  await db.auditLog.create({ data: { userId, action, entityId } });
}
async function ownedForm(formId: string, userId: string) {
  const form = await db.form.findFirst({
    where: { id: id.parse(formId), userId },
    include: { schemas: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!form || !form.schemas[0]) throw new HttpError(404, 'Form not found');
  return form;
}
async function ownedJob(jobId: string, userId: string) {
  const job = await db.submissionJob.findFirst({ where: { id: id.parse(jobId), userId } });
  if (!job) throw new HttpError(404, 'Job not found');
  return job;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.xlsx'))
      cb(new HttpError(400, 'Only XLSX files are accepted'));
    else cb(null, true);
  },
});
let analyzing = 0;
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(
    helmet(),
    cors({ origin: [...webOrigins], credentials: true }),
    cookieParser(),
    express.json({ limit: '32kb' }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== 'test',
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }),
  );
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.get(
    '/api/health/ready',
    asyncRoute(async (_req, res) => {
      const redis = usesMongoQueue() ? undefined : redisConnection();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([db.$runCommandRaw({ ping: 1 }), redis?.ping()]),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new HttpError(503, 'Database or queue is unavailable', 'NOT_READY')),
              5000,
            );
          }),
        ]);
        res.json({ data: { status: 'ready' } });
      } catch {
        throw new HttpError(503, 'Database or queue is unavailable', 'NOT_READY');
      } finally {
        if (timer) clearTimeout(timer);
        redis?.disconnect();
      }
    }),
  );
  app.use('/api', sameOrigin);
  const signupLimit = rateLimit({
    windowMs: 900000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.post(
    '/api/auth/signup',
    signupLimit,
    asyncRoute(async (req, res) => {
      res.status(202).json({ data: await requestSignup(req.body) });
    }),
  );
  app.post(
    '/api/auth/signup/resend',
    signupLimit,
    asyncRoute(async (req, res) => {
      res.status(202).json({ data: await resendSignup(req.body) });
    }),
  );
  app.post(
    '/api/auth/signup/verify',
    signupLimit,
    asyncRoute(async (req, res) => {
      const user = await verifySignup(req.body);
      const token = await signSession(user.id, user.sessionVersion);
      res.cookie('session', token, { ...cookieOptions, maxAge: 8 * 3600000 });
      res.status(201).json({ data: { id: user.id, email: user.email } });
    }),
  );
  app.post(
    '/api/auth/login',
    rateLimit({ windowMs: 900000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
    asyncRoute(async (req, res) => {
      const body = z
        .object({ email: z.string().email().max(191), password: z.string().min(1).max(72) })
        .parse(req.body);
      const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
      // Constant-cost password check for unknown accounts as well.
      const valid = await bcrypt.compare(
        body.password,
        user?.passwordHash ?? '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxwU5HQglCjSLkWsXVzOMUZMaky',
      );
      if (!user || !valid) throw new HttpError(401, 'Email or password is incorrect');
      const token = await signSession(user.id, user.sessionVersion);
      res.cookie('session', token, { ...cookieOptions, maxAge: 8 * 3600000 });
      await audit(user.id, 'LOGIN');
      res.json({ data: { id: user.id, email: user.email } });
    }),
  );
  app.use('/api', requireAuth);
  app.get('/api/auth/me', (_req, res) =>
    res.json({ data: { id: uid(res), email: res.locals.user.email } }),
  );
  app.post(
    '/api/auth/logout',
    asyncRoute(async (_req, res) => {
      await db.user.update({ where: { id: uid(res) }, data: { sessionVersion: { increment: 1 } } });
      res.clearCookie('session', cookieOptions);
      res.json({ data: { loggedOut: true } });
    }),
  );
  app.use('/api/google', google);
  app.post(
    '/api/forms/analyze',
    rateLimit({ windowMs: 60000, limit: 5 }),
    asyncRoute(async (req, res) => {
      const body = z
        .object({ url: z.string().max(2048), useGoogleApi: z.boolean().default(false) })
        .parse(req.body);
      if (analyzing >= 2) throw new HttpError(429, 'Analyzer is busy. Try again shortly.');
      analyzing++;
      let definition;
      try {
        const token = body.useGoogleApi
          ? res.locals.user.googleRefresh
            ? await googleAccess(res.locals.user.googleRefresh)
            : undefined
          : undefined;
        if (body.useGoogleApi && !token)
          throw new HttpError(409, 'Connect Google in Settings first');
        definition = await new FormAnalyzer().analyze(body.url, token);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(422, error instanceof Error ? error.message : 'Form analysis failed');
      } finally {
        analyzing--;
      }
      const saved = await db.$transaction(async (tx) => {
        let form = await tx.form.findFirst({
          where: { userId: uid(res), sourceUrl: definition.sourceUrl },
          include: { schemas: { orderBy: { version: 'desc' }, take: 1 } },
        });
        if (form?.schemas[0]?.fingerprint === definition.fingerprint) return form;
        if (!form) {
          const created = await tx.form.create({
            data: { userId: uid(res), title: definition.title, sourceUrl: definition.sourceUrl },
          });
          form = { ...created, schemas: [] };
        }
        await tx.form.update({ where: { id: form.id }, data: { title: definition.title } });
        await tx.formSchema.create({
          data: {
            formId: form.id,
            version: (form.schemas[0]?.version ?? 0) + 1,
            definition: json(definition),
            fingerprint: definition.fingerprint,
            questions: {
              create: definition.questions.map((q) => ({
                externalId: q.id,
                title: q.title,
                type: q.type,
                required: q.required,
                metadata: json(q),
              })),
            },
          },
        });
        return form;
      });
      await audit(uid(res), 'FORM_ANALYZED', saved.id);
      res.json({ data: await ownedForm(saved.id, uid(res)) });
    }),
  );
  app.get(
    '/api/forms',
    asyncRoute(async (_req, res) => {
      const forms = await db.form.findMany({
        where: { userId: uid(res) },
        orderBy: { createdAt: 'desc' },
        include: { schemas: { orderBy: { version: 'desc' }, take: 1 } },
        take: 200,
      });
      res.json({ data: forms });
    }),
  );
  app.get(
    '/api/templates',
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db.excelTemplate.findMany({
          where: { schema: { form: { userId: uid(res) } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            schema: { select: { version: true, form: { select: { id: true, title: true } } } },
          },
        }),
      }),
    ),
  );
  app.get(
    '/api/forms/:id',
    asyncRoute(async (req, res) => {
      res.json({ data: await ownedForm(req.params.id, uid(res)) });
    }),
  );
  app.get(
    '/api/forms/:id/questions',
    asyncRoute(async (req, res) => {
      const form = await ownedForm(req.params.id, uid(res));
      res.json({ data: formSchema.parse(form.schemas[0].definition).questions });
    }),
  );
  app.get(
    '/api/forms/:id/template',
    asyncRoute(async (req, res) => {
      const form = await ownedForm(req.params.id, uid(res));
      const schema = form.schemas[0];
      const definition = formSchema.parse(schema.definition);
      if (!definition.questions.length)
        throw new HttpError(
          409,
          'No questions are available for an Excel template. Resolve form access and reanalyze the form first.',
        );
      const template = await db.excelTemplate.create({ data: { schemaId: schema.id } });
      const buffer = await generateTemplate(definition, template.id, config.MAX_ROWS);
      await audit(uid(res), 'TEMPLATE_GENERATED', template.id);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="formflow-${template.id}.xlsx"`,
          'X-Template-Id': template.id,
        })
        .send(buffer);
    }),
  );
  app.post(
    '/api/uploads/validate',
    upload.single('file'),
    asyncRoute(async (req, res) => {
      const templateId = id.parse(req.body.templateId);
      if (!req.file) throw new HttpError(400, 'Select an XLSX file');
      const template = await db.excelTemplate.findFirst({
        where: { id: templateId, schema: { form: { userId: uid(res) } } },
        include: {
          schema: {
            include: {
              form: {
                include: {
                  schemas: { orderBy: { version: 'desc' }, take: 1, select: { id: true } },
                },
              },
            },
          },
        },
      });
      if (!template) throw new HttpError(404, 'Template not found');
      if (template.schema.form.schemas[0].id !== template.schemaId)
        throw new HttpError(409, 'A newer schema exists. Download its template.');
      const definition = formSchema.parse(template.schema.definition);
      let result: ValidationResult;
      try {
        result = await parseUpload(req.file.buffer, definition, templateId, config.MAX_ROWS);
      } catch (error) {
        throw new HttpError(422, error instanceof Error ? error.message : 'Invalid workbook');
      }
      const checksum = createHash('sha256')
        .update(JSON.stringify(result.rows.map((r) => r.answers)))
        .digest('hex');
      const saved = await db.upload.upsert({
        where: { userId_checksum_templateId: { userId: uid(res), checksum, templateId } },
        update: {},
        create: {
          userId: uid(res),
          templateId,
          checksum,
          total: result.total,
          valid: result.valid,
          invalid: result.invalid,
          encryptedData: encrypt(result),
        },
      });
      await audit(uid(res), 'UPLOAD_VALIDATED', saved.id);
      // Deliberately do not send answers back to the table: row numbers identify records.
      res.json({
        data: {
          id: saved.id,
          total: result.total,
          valid: result.valid,
          invalid: result.invalid,
          formId: template.schema.form.id,
          formBlockers: definition.blockers,
          rows: result.rows.map(({ answers: _answers, ...row }) => row),
        },
      });
    }),
  );
  app.get(
    '/api/uploads/:id/report',
    asyncRoute(async (req, res) => {
      const found = await db.upload.findFirst({
        where: { id: id.parse(req.params.id), userId: uid(res) },
      });
      if (!found) throw new HttpError(404, 'Upload not found');
      const result = decrypt<ValidationResult>(found.encryptedData);
      const buffer = await reportWorkbook(
        ['Excel row', 'Valid', 'Errors'],
        result.rows.map((r) => [r.rowNumber, !r.errors.length, r.errors.join('; ')]),
      );
      res.attachment('validation-report.xlsx').send(buffer);
    }),
  );
  app.post(
    '/api/submissions/start',
    asyncRoute(async (req, res) => {
      const body = z
        .object({
          uploadId: id,
          authorized: z.literal(true),
          confirmedValidRows: z.number().int().positive(),
        })
        .parse(req.body);
      const found = await db.upload.findFirst({
        where: { id: body.uploadId, userId: uid(res) },
        include: {
          template: {
            include: {
              schema: {
                include: {
                  form: {
                    include: {
                      schemas: { orderBy: { version: 'desc' }, take: 1, select: { id: true } },
                    },
                  },
                },
              },
            },
          },
          job: true,
        },
      });
      if (!found) throw new HttpError(404, 'Upload not found');
      if (found.job) {
        res.json({ data: found.job });
        return;
      }
      const definition = formSchema.parse(found.template.schema.definition);
      if (definition.blockers.length)
        throw new HttpError(
          409,
          `This form requires manual action: ${definition.blockers.join('; ')}`,
        );
      if (found.template.schema.form.schemas[0].id !== found.template.schemaId)
        throw new HttpError(409, 'Form schema has changed. Create a new upload.');
      if (found.valid !== body.confirmedValidRows)
        throw new HttpError(409, 'Confirmed row count does not match validation');
      const rows = decrypt<ValidationResult>(found.encryptedData).rows.filter(
        (r) => !r.errors.length,
      );
      const job = await db.$transaction(async (tx) => {
        const created = await tx.submissionJob.create({
          data: {
            userId: uid(res),
            uploadId: found.id,
            title: found.template.schema.form.title,
            authorizedAt: new Date(),
            records: {
              create: rows.map((r) => ({
                rowNumber: r.rowNumber,
                encryptedAnswers: encrypt(r.answers),
                submitIntentAt: null,
              })),
            },
          },
        });
        await tx.auditLog.create({
          data: { userId: uid(res), action: 'BATCH_AUTHORIZED', entityId: created.id },
        });
        return created;
      });
      // Committed DB state is recoverable even if Redis is temporarily unavailable.
      void dispatch(job.id).catch(() =>
        logger.warn({ jobId: job.id }, 'Dispatch deferred to reconciler'),
      );
      res.status(201).json({ data: job });
    }),
  );
  app.get(
    '/api/submissions',
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db.submissionJob.findMany({
          where: { userId: uid(res) },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: { _count: { select: { records: true } } },
        }),
      }),
    ),
  );
  for (const action of ['pause', 'resume', 'cancel'] as const)
    app.post(
      `/api/submissions/:id/${action}`,
      asyncRoute(async (req, res) => {
        const job = await ownedJob(req.params.id, uid(res));
        if (action === 'pause') {
          const changed = await db.submissionJob.updateMany({
            where: { id: job.id, status: { in: ['RUNNING', 'QUEUED'] } },
            data: { status: 'PAUSED', reason: 'Paused by user' },
          });
          if (!changed.count) throw new HttpError(409, 'Only queued or running jobs can be paused');
        }
        if (action === 'cancel') {
          if (!['QUEUED', 'RUNNING', 'PAUSED'].includes(job.status))
            throw new HttpError(409, 'Only active jobs can be cancelled');
          await db.$transaction([
            db.submissionJob.updateMany({
              where: { id: job.id, status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } },
              data: { status: 'CANCELLED', reason: 'Cancelled by user' },
            }),
            db.submissionRecord.updateMany({
              where: { jobId: job.id, status: 'QUEUED' },
              data: { status: 'CANCELLED' },
            }),
          ]);
        }
        if (action === 'resume') {
          if (job.status !== 'PAUSED') throw new HttpError(409, 'Only paused jobs can be resumed');
          if (!(await db.submissionRecord.count({ where: { jobId: job.id, status: 'QUEUED' } })))
            throw new HttpError(
              409,
              'No queued rows remain. Review the affected records; use an eligible row’s explicit Retry action after resolving its error.',
            );
          // Resume never silently retries manual-action or unknown records.
          await db.submissionJob.updateMany({
            where: { id: job.id, status: 'PAUSED' },
            data: { status: 'QUEUED', reason: null },
          });
          void dispatch(job.id).catch(() => {});
        }
        await audit(uid(res), `JOB_${action.toUpperCase()}`, job.id);
        res.json({ data: await ownedJob(job.id, uid(res)) });
      }),
    );
  app.post(
    '/api/submissions/:id/retry',
    asyncRoute(async (req, res) => {
      const job = await ownedJob(req.params.id, uid(res));
      const recordId = id.parse(req.body.recordId);
      if (!['COMPLETED', 'PAUSED'].includes(job.status))
        throw new HttpError(409, 'Pause or finish the batch before retrying');
      const record = await db.submissionRecord.findFirst({
        where: { id: recordId, jobId: job.id },
      });
      if (
        !record ||
        !safeToRetry(record.status as RecordState, record.submitIntentAt, record.error)
      )
        throw new HttpError(
          409,
          'Only failures known to precede Submit can be retried. UNKNOWN records cannot be retried.',
        );
      await db.$transaction(async (tx) => {
        const changed = await tx.submissionRecord.updateMany({
          where: {
            id: record.id,
            status: record.status,
            OR: [{ submitIntentAt: null }, { submitIntentAt: { isSet: false } }],
            error: record.error,
            job: { status: { in: ['COMPLETED', 'PAUSED'] } },
          },
          data: { status: 'QUEUED', error: null },
        });
        if (!changed.count)
          throw new HttpError(409, 'Record state changed. Refresh before retrying.');
        const queued = await tx.submissionJob.updateMany({
          where: { id: job.id, status: { in: ['COMPLETED', 'PAUSED'] } },
          data: { status: 'QUEUED', reason: null },
        });
        if (!queued.count) throw new HttpError(409, 'Job state changed. Refresh before retrying.');
      });
      await audit(uid(res), 'RECORD_RETRY', record.id);
      void dispatch(job.id).catch(() => {});
      res.json({ data: { queued: true } });
    }),
  );
  app.get(
    '/api/submissions/:id',
    asyncRoute(async (req, res) => {
      const job = await ownedJob(req.params.id, uid(res));
      const groups = await db.submissionRecord.groupBy({
        by: ['status'],
        where: { jobId: job.id },
        _count: true,
      });
      res.json({
        data: { ...job, counts: Object.fromEntries(groups.map((g) => [g.status, g._count])) },
      });
    }),
  );
  app.get(
    '/api/submissions/:id/records',
    asyncRoute(async (req, res) => {
      const job = await ownedJob(req.params.id, uid(res));
      const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
      const records = await db.submissionRecord.findMany({
        where: { jobId: job.id },
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * 100,
        take: 100,
        select: {
          id: true,
          rowNumber: true,
          status: true,
          attemptCount: true,
          submitIntentAt: true,
          submittedAt: true,
          error: true,
        },
      });
      res.json({ data: records, meta: { page, pageSize: 100 } });
    }),
  );
  app.get(
    '/api/submissions/:id/report',
    asyncRoute(async (req, res) => {
      const job = await ownedJob(req.params.id, uid(res));
      const records = await db.submissionRecord.findMany({
        where: { jobId: job.id },
        orderBy: { rowNumber: 'asc' },
      });
      const buffer = await reportWorkbook(
        [
          'Excel row',
          'Status',
          'Attempts',
          'Submit intent UTC',
          'Verified submission UTC',
          'Error',
        ],
        records.map((r) => [
          r.rowNumber,
          r.status,
          r.attemptCount,
          r.submitIntentAt?.toISOString() ?? '',
          r.submittedAt?.toISOString() ?? '',
          r.error ?? '',
        ]),
      );
      await audit(uid(res), 'REPORT_DOWNLOADED', job.id);
      res.attachment(`submission-${job.id}.xlsx`).send(buffer);
    }),
  );
  app.get(
    '/api/dashboard/stats',
    asyncRoute(async (_req, res) => {
      const userId = uid(res);
      const [forms, records, activeJobs] = await Promise.all([
        db.form.count({ where: { userId } }),
        db.submissionRecord.groupBy({ by: ['status'], where: { job: { userId } }, _count: true }),
        db.submissionJob.count({
          where: { userId, status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } },
        }),
      ]);
      const counts = Object.fromEntries(records.map((g) => [g.status, g._count]));
      res.json({
        data: {
          forms,
          processed: Object.entries(counts)
            .filter(([state]) => !['QUEUED', 'RUNNING', 'PENDING'].includes(state))
            .reduce((n, [, v]) => n + v, 0),
          submitted: counts.SUBMITTED ?? 0,
          failed: counts.FAILED ?? 0,
          unknown: counts.UNKNOWN ?? 0,
          activeJobs,
        },
      });
    }),
  );
  app.get('/api/settings', (_req, res) =>
    res.json({
      data: {
        maxRows: config.MAX_ROWS,
        maxUploadMB: config.MAX_UPLOAD_MB,
        retentionDays: Number(process.env.RETENTION_DAYS ?? 30),
      },
    }),
  );
  app.get(
    '/api/audit',
    asyncRoute(async (_req, res) =>
      res.json({
        data: await db.auditLog.findMany({
          where: { userId: uid(res) },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      }),
    ),
  );
  app.delete(
    '/api/data',
    asyncRoute(async (req, res) => {
      z.object({ confirm: z.literal('DELETE MY DATA') }).parse(req.body);
      if (
        await db.submissionJob.count({
          where: { userId: uid(res), status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } },
        })
      )
        throw new HttpError(
          409,
          'Cancel active jobs and wait for running records to settle before deleting data',
        );
      if (
        await db.submissionRecord.count({ where: { job: { userId: uid(res) }, status: 'RUNNING' } })
      )
        throw new HttpError(409, 'A browser is still finishing a record');
      await db.$transaction([
        db.form.deleteMany({ where: { userId: uid(res) } }),
        db.auditLog.deleteMany({ where: { userId: uid(res) } }),
      ]);
      res.json({ data: { deleted: true } });
    }),
  );
  app.use((_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        error: {
          code: 'UPLOAD_ERROR',
          message:
            error.code === 'LIMIT_FILE_SIZE'
              ? `File exceeds ${config.MAX_UPLOAD_MB} MB`
              : 'Upload exceeds the supported limits',
        },
      });
      return;
    }
    if (error instanceof HttpError || error instanceof SignupError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'This operation already exists. Refresh to see its state.',
        },
      });
      return;
    }
    logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Request failed');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The operation failed. Check service availability and try again.',
      },
    });
  });
  return app;
}
