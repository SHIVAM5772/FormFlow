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

New users can choose **Sign up** on the sign-in screen or visit `/signup`. Enter your full name, email, phone number, address, date of birth and gender, then set and confirm a password of at least 12 characters. Signup sends a six-digit email OTP; only successful verification creates an account and signs the user into their workspace. The account creation command remains available for administrators.

## Update profile and email

Click your account email in the sidebar and choose **View profile**, or open `/profile`. The profile opens in view mode with personal information, recent workspace activity and email verification status. Choose **Edit profile** to open the prefilled form; **Back to profile** discards unsaved edits. Personal details save separately from the account email. Changing email sends a six-digit OTP to the new address through the existing SMTP configuration; the old address remains active until verification succeeds. Codes expire in 10 minutes, permit at most five attempts, and can be resent after 60 seconds with a limit of five sends per account per 15 minutes. Successful verification refreshes the current browser session and revokes older account sessions.

Email-change challenges use the `EmailChangeVerification` MongoDB collection, separate from signup challenges. Regenerate the Prisma client after pulling schema changes and restart the local API. No additional SMTP variables are required. Retention cleans up expired challenges without immediately resetting send limits.

## Excel checkbox selections

Forms containing checkbox questions or checkbox grids now download as `.xlsm` with the multi-select VBA embedded. Open the downloaded file in desktop Excel and enable its macros if permitted by your policy. Choose dropdown options one by one to add/remove them in the same cell, or double-click for a checkbox menu and apply the selections. Single-choice fields keep replacing their value. Save and upload the `.xlsm` directly; `.xlsx` uploads still work. Excel Web cannot execute this VBA; enter exact labels separated by semicolons there.

No separate add-in is needed for new downloads. The checked-in `packages/excel-engine/assets/vbaProject.bin` contains source-only VBA built from the reviewable code in `excel-addin/src`. Rebuild it after VBA edits with `npm run build:excel-macros`; this needs neither Excel nor access to its VBA project. The build uses the public XlsxWriter example only for project/type-library metadata, replaces all its macro sources, and excludes compiled caches. Its license is included in `excel-addin/VBA-BASE-LICENSE.txt`. The older [optional add-in](excel-addin/README.md) is retained for existing `.xlsx` templates.

## Production

Windows marks website downloads as internet files and may show a red **Security Risk** banner that blocks VBA. The server cannot clear this Windows file flag. Only for a FormFlow workbook you trust: close Excel, right-click the saved file, choose **Properties → Unblock → Apply**, then reopen it and follow the macro prompt if policy permits. Organization policy can still prevent macros. See [Microsoft's explanation](https://learn.microsoft.com/en-us/microsoft-365-apps/security/internet-macros-blocked). While macros are blocked, type exact choices separated by semicolons.

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

## Local signup email setup

Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in your local .env using your email provider's SMTP settings. For port 587 use SMTP_SECURE=false (STARTTLS); for port 465 use SMTP_SECURE=true. Keep credentials out of Git. See [Nodemailer SMTP settings](https://nodemailer.com/smtp). Restart the local API after changing environment values. Missing or failed email configuration prevents signup and displays an error; codes are never exposed through API responses or logs.

Run npm run db:generate after schema changes. Use an isolated development MongoDB database for local signup testing. This change adds no database indexes: pending challenges use the email as MongoDB's native unique document ID. Do not run deployment commands or database updates against production as part of local setup.

Codes expire after 10 minutes and allow five verification attempts. Resends wait 60 seconds, are limited to five emails per address per 15 minutes, and replace earlier codes. Signup details are temporarily encrypted; passwords are hashed before storage. Verification consumes the code and creates the account in one database transaction. The retention command removes expired pending signup records. Existing accounts retain their current sign-in flow.
