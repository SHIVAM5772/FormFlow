# Vercel production deployment

The complete app runs in one Vercel project: Next.js frontend, a container API with Chromium, and a background submission daemon. MongoDB Atlas remains the database you supply. No Render, Railway, VPS, or Redis host is needed in default MongoDB mode.

## Configure and deploy

1. From the repository root, run `npx vercel login`, then `npx vercel link`. Keep the project's Root Directory at the repository root (`.`), not `apps/web`: Daemons require it.
2. Add production environment variables in Vercel Settings. Copy the existing secret values securely from local `.env`; never commit them:

| Variable                     | Value                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `NODE_ENV`                   | `production`                                               |
| `DATABASE_URL`               | Existing MongoDB Atlas URL, with database name `/formflow` |
| `QUEUE_BACKEND`              | `mongodb`                                                  |
| `SESSION_SECRET`             | Existing value, at least 32 characters                     |
| `DATA_KEY`                   | Existing 64-character hex encryption key                   |
| `WEB_ORIGIN`                 | Stable public HTTPS project hostname                       |
| `PORT`                       | `4000` (API container port)                                |
| `WORKER_HEALTH_PORT`         | `4001`                                                     |
| `MAX_UPLOAD_MB` / `MAX_ROWS` | `10` / `2000`                                              |
| `RECORD_DELAY_MS`            | `3000`                                                     |

3. Ensure Atlas network access and database-user permissions allow connections from the deployed Vercel services. Atlas must support replica-set transactions.
4. Locally, run `npm run db:generate` then `npm run db:push` against the intended database. This applies collections/indexes without resetting data or accepting destructive changes. Do this before releases that change the schema.
5. Create the initial account using `npm run user:create -- you@example.com`. Password input is hidden. Existing MySQL accounts/data are not automatically transferred.
6. Run `npx vercel --prod`. The checked-in `vercel.json` configures all three workloads together. The API and daemon use the root `Dockerfile`, which includes Chromium and generates Prisma. Daemons start only for production deployments.
7. Verify `/api/health`, `/api/health/ready`, sign-in, template download/upload, then an explicitly authorized test batch on a Google Form you own. Check the submission daemon's logs and health in the Vercel dashboard.

Set WEB_ORIGIN to the public alias users visit, rather than a random deployment hostname. Preview deployments must use isolated database/environment credentials; the production daemon does not process preview queues.

Optional Google integration also needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI=`https://your-host/api/google/callback`. Register that callback in Google Cloud.

## Worker behavior

The default queue is persisted SubmissionJob documents. The daemon polls MongoDB every two seconds and processes batches sequentially. A renewable lease prevents overlapping releases from simultaneously consuming work. Expired ownership prevents further submit intent. Uncertain interrupted records become UNKNOWN and are never automatically resubmitted. Job detail screens poll database state every four seconds.

Daemons and container services use Vercel's current beta features. Hobby daemon quotas can stop continuously running workers when exhausted; check your plan's limits before relying on unattended processing. No paid plan is automatically selected by this repository.

References: [Services](https://vercel.com/docs/services), [Container runtime](https://vercel.com/docs/functions/runtimes/container), [Daemons](https://vercel.com/docs/daemons), [Daemon limits](https://vercel.com/docs/daemons/limits).

## Optional Docker hosting

`docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build` remains available. Set an accessible MongoDB DATABASE_URL in `.env` (Atlas, or `mongodb://mongo:27017/formflow?replicaSet=rs0` for the bundled local replica set), stable keys, DOMAIN and HTTPS WEB_ORIGIN. The optional Redis service is behind the `redis` profile; default MongoDB mode does not require it.
