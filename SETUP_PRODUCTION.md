# Vercel deployment

The frontend and Express API deploy as native Vercel Services. Authorized submissions start in a Vercel `waitUntil` background task immediately; MongoDB Atlas supplies durable storage. Cron remains a recovery mechanism.

1. Run `npx vercel login` and `npx vercel link` from the repository root. Keep Root Directory at `.`.
2. Configure production environment variables:

| Variable        | Value                                               |
| --------------- | --------------------------------------------------- |
| NODE_ENV        | production                                          |
| DATABASE_URL    | MongoDB Atlas URL with /formflow database path      |
| QUEUE_BACKEND   | mongodb                                             |
| SESSION_SECRET  | Existing stable secret, at least 32 characters      |
| DATA_KEY        | Existing stable 64-character hex encryption key     |
| CRON_SECRET     | Separate random secret, at least 32 characters      |
| WEB_ORIGIN      | Stable public HTTPS hostname                        |
| MAX_UPLOAD_MB   | 4, to leave room under the function request limit   |
| MAX_ROWS        | 2000                                                |
| RECORD_DELAY_MS | 3000                                                |
| SMTP_HOST       | smtp-relay.brevo.com                                |
| SMTP_PORT       | 587                                                 |
| SMTP_SECURE     | false (STARTTLS on port 587)                        |
| SMTP_USER       | SMTP login from your provider                       |
| SMTP_PASSWORD   | SMTP key; store as a sensitive variable             |
| MAIL_FROM       | Verified sender email, optionally with display name |

Generate CRON_SECRET with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Existing .env files are preserved by setup:env, so add this new value manually if needed. Never commit secrets. PORT and WORKER_HEALTH_PORT are local settings and are not needed in production.

3. Allow Vercel connections in Atlas network access and database-user permissions. Use isolated credentials/databases for previews.
4. Run `npm run db:generate` and `npm run db:push` against the intended database. Create the initial account with `npm run user:create -- you@example.com`.
5. Run `npx vercel --prod`, then verify /api/health, /api/health/ready, sign-in, template upload/download, and an explicitly authorized batch on a form you own.

## OTP email configuration

Signup and profile email changes use the same server-side SMTP configuration. Set all six mail variables above in the Vercel project **Production** environment, available to the API service at runtime. For preview deployments, configure the Preview environment separately. Do not use `NEXT_PUBLIC_` prefixes for SMTP credentials and do not commit `.env` files.

After changing variables, redeploy: existing deployments keep their previous environment. An `Email delivery is not configured` response means configuration validation failed before the SMTP connection; verify variable names, values and environment scope. An `SMTP_IP_BLOCKED` response instead means the provider rejected the sending server's IP and requires provider-side authorization.

The helper `scripts/vercel-env.mjs` now includes mail settings and marks `SMTP_PASSWORD` as sensitive. Review its variable names without contacting Vercel or changing production:

```powershell
node scripts/vercel-env.mjs https://your-project.vercel.app --dry-run
```

Running the helper without `--dry-run` changes production environment variables on the linked project; use it only when those production changes are authorized. It requires `VERCEL_CLI_ENTRY` pointing to your installed Vercel CLI JavaScript entrypoint and passes values via stdin.

Reference: [Vercel environment variable management](https://vercel.com/docs/environment-variables/managing-environment-variables).

## Scheduled submissions

Creating, resuming or explicitly retrying an authorized batch immediately wakes the worker in production. The API returns promptly and registers the processing promise with Vercel `waitUntil` so it can continue after the HTTP response. Authenticated polling of an owned queued/running job also wakes processing, recovering older queued batches and continuing large batches between bounded invocations. Keep the jobs page open for continuous progress across those invocations. This never retries UNKNOWN rows or submits paused/cancelled jobs. The same global MongoDB lease prevents local, cron and request-triggered workers from processing concurrently.

The daily schedule is compatible with Hobby. It calls /api/internal/process with Authorization: Bearer CRON_SECRET. Missing or incorrect authentication receives 401. Cron runs only on production; previews do not automatically consume jobs.

Each invocation holds a renewable MongoDB lease shared with local workers and processes queued jobs for a bounded period. New rows stop starting after three minutes; the function limit is five minutes. Unfinished batches resume on later invocations. Hard timeouts can leave uncertain rows, which are marked UNKNOWN on recovery and never replayed automatically.

The daily cron is a recovery fallback when no job page or request triggers further work. If a batch spans multiple invocation budgets and its page is closed, remaining rows wait for another request or cron. On Pro/Enterprise, set `crons[0].schedule` in vercel.json to `* * * * *` for a minute-level recovery cadence. The Cron Jobs dashboard also offers Run for manual invocations. This repository does not select or upgrade your plan.

Local development starts a continuous worker through `npm run dev:vercel`; Vercel does not invoke crons locally. Keep local and production databases separate unless you intentionally want local processing to consume production jobs.

For optional Google OAuth, set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI=https://your-host/api/google/callback. Register that callback in Google Cloud.

References: [Services](https://vercel.com/docs/services), [Express](https://vercel.com/docs/frameworks/backend/express), [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
