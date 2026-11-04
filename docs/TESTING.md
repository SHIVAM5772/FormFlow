# Testing

Run `npm run db:generate` after installing dependencies. Install Chromium with `npx playwright install chromium`.

- `npm test`: core tests, mocked API tests, local-browser fixtures, and worker lease/ownership regression tests. No Google responses are sent.
- `npm run typecheck`, `npm run lint`, `npm run build`: static and production-build checks.
- `npm run test:e2e`: real Next.js pages using mocked API responses.
- `npm run test:mongodb`: derives a separate `formflow_codex_test` database from DATABASE_URL, applies indexes without destructive flags, verifies API template/upload persistence, real local-browser processing, deduplication, UNKNOWN handling and competing worker leases. It deletes its own fixtures afterwards; it never drops the application database. Ensure the MongoDB user can access this test database.

`npm run test:services` requires DATABASE_URL ending in `_test`. MongoDB must run as a replica set. With QUEUE_BACKEND=redis, REDIS_URL must also target isolated database `/15`; this enables the optional real BullMQ/Redis test. MongoDB mode skips only that Redis-specific test.

The GitHub workflow starts a disposable MongoDB replica set and runs the MongoDB-mode suite. A checked-in workflow is not proof of a successful remote CI run.

`npm run verify:proxy` is a separate local smoke test for Next.js API/Socket.IO rewrites; it requires normal local API configuration. Vercel uses the top-level Services route table instead of the local Next.js rewrites.
