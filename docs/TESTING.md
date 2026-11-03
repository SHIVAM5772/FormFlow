# Testing

## Core suite

```powershell
npm run db:generate
npx playwright install chromium
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
```

`npm test` runs URL/SSRF boundaries, metadata normalization, section paths, authenticated encryption, Excel generation/parsing, required/options/grid/date/conditional rules, duplicate/formula/version rejection, retry rules, API ownership/Origin/auth checks, React status presentation, and real Playwright submission against `tests/fixtures/sample-form.html`. The fixture server records received HTTP POSTs; tests assert actual submitted fields and checkbox arrays. A second mode accepts the POST but withholds confirmation, proving the record becomes UNKNOWN.

Supertest and Chromium need permission to listen/connect on loopback. Restricted execution environments may require a sandbox exception. Browsers installed under another user require a compatible `PLAYWRIGHT_BROWSERS_PATH`. Do not replace browser assertions with success mocks to make an unavailable environment appear verified.

The UI E2E suite launches a local Next.js server. Without the API, the sign-in shell is still rendered after the `/auth/me` request fails. It checks the real responsive sign-in form. A separate isolated API-contract test supplies a test account and zero counts only inside Playwright routing, then checks the dashboard, theme switch and mobile navigation. No mock mode or seeded statistics are included in the shipped application. Service tests exercise real API/database persistence separately.

## Service integration

Create a separate MySQL database named `formflow_test` using your database admin client. Grant the existing development account rights only to that database in addition to its own app DB. Use Redis database `/15` only for these tests; do not run a production worker on it.

In a **separate PowerShell terminal**, from the repository root:

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='mysql://formflow:formflow_local@127.0.0.1:3306/formflow_test'
$env:REDIS_URL='redis://127.0.0.1:6379/15'
# DATA_KEY and SESSION_SECRET can be inherited from your local .env.
npm run db:deploy
npm run test:services
```

The suite refuses a database without the `_test` suffix or a Redis URL without `/15`. It inserts a uniquely named test user and schema, downloads the real API workbook, fills/uploads it through Supertest, authorizes a batch, checks idempotent starts and pause/resume, and invokes the real batch processor against the local fixture. It verifies encrypted records and timestamps through a second Prisma connection, checks progress callbacks, interrupted-row UNKNOWN recovery and a real BullMQ/Redis publish cycle. Its own records/queue are removed afterward. No application database is dropped and Redis is not globally flushed.

The GitHub Actions workflow provisions isolated MySQL and Redis services, applies migrations, installs Chromium, and runs these commands. A checked-in workflow is not proof that a remote CI run succeeded; check your GitHub Actions result after pushing.

For this local Compose installation, `npm run test:services:local` creates only `formflow_next_test`, grants the existing development account access, applies migrations and uses Redis `/15`. It never drops the application database or globally flushes Redis. Set `PLAYWRIGHT_BROWSERS_PATH` to a compatible existing Chromium installation if needed. This helper refuses remote hosts and production mode.

`npm run verify:proxy` starts temporary API/web servers on 4100/3300 and checks real Next.js rewrites, MySQL/Redis readiness, Origin/auth protection and Socket.IO polling in an actual browser. It starts no worker and sends no Google responses. It uses ignored `.next-proxy-check` output to avoid the normal development lock, then restores generated TypeScript configuration and stops its own servers.
