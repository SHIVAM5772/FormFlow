# FormFlow Automation

Next.js frontend, Express API, Prisma + MongoDB Atlas, and Playwright submission processing. Local development and production use Vercel Services with native Node.js functions.

## Local setup

Use Node.js 22 and run from the repository root:

```powershell
npm.cmd ci
npm.cmd run setup:env
# Set DATABASE_URL in .env to your MongoDB Atlas URL, including /formflow.
npm.cmd run db:generate
npm.cmd run db:push
npx.cmd playwright install chromium
npm.cmd run user:create -- you@example.com
npm.cmd run dev:vercel
```

Open the URL printed by Vercel. The local API service starts the API and MongoDB submission worker together. Local cron execution is unnecessary because the worker polls continuously. `npm run dev` also remains available for direct local development at http://localhost:3000.

Keep SESSION_SECRET and DATA_KEY stable. MongoDB must support replica-set transactions; Atlas supplies this. Database credentials stay on the server. MongoDB uses db push rather than SQL migrations.

New users can choose **Sign up** on the sign-in screen or visit `/signup`. Enter an email and a password of at least 12 characters, then confirm the password. A successful signup signs the user into their own workspace. The account creation command remains available for administrators.

## Production

See [SETUP_PRODUCTION.md](SETUP_PRODUCTION.md). Keep the Vercel project root at the repository root. The frontend and native Express function share one hostname; /api/* routes to Express. Chromium is bundled through @sparticuz/chromium for Linux functions; local development uses Playwright's installed browser. Job pages poll persisted state every four seconds.

Submission processing uses an authenticated Vercel Cron endpoint and a renewable MongoDB lease. Each invocation starts new rows for up to three minutes, leaving time inside its five-minute function limit to finish. Remaining queued rows wait for the next invocation. Interrupted rows with uncertain browser results become UNKNOWN and are never automatically replayed.

The checked-in schedule runs daily at 00:00 UTC (05:30 IST, subject to Hobby timing precision). On Pro/Enterprise, change the cron schedule to `* * * * *` for processing every minute. Daily processing can leave a large batch queued for multiple days. Use the Vercel Cron dashboard's Run action for an additional authenticated invocation.

## Commands

- `npm run dev:vercel`: frontend, API and local worker through Vercel.
- `npm run dev`: direct local frontend, API and worker.
- `npm run db:generate` / `npm run db:push`: generate Prisma and apply MongoDB indexes.
- `npm run user:create -- you@example.com`: create an account with hidden password input.
- `npm run typecheck`, `npm run lint`, `npm run build`: static and build checks.
- `npm test`: core, API and local-browser tests.
- `npm run test:mongodb`: isolated database integration tests.
- `npm run test:e2e`: UI tests.
- `npm run retention`: remove expired records.

Google OAuth is optional. CAPTCHA, login restrictions and unsupported form rules require manual action. Responses are submitted only after explicit batch authorization. Tests use included local fixtures.
