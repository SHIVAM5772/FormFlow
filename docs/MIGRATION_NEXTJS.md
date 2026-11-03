# Next.js migration

`NextJs` is the complete application: Next.js 16.4.4 frontend, API, worker, database migrations, engines, tests and deployment files. Native App Router routes, layouts, `next/link`, navigation hooks and Suspense replace Vite/React Router. Interactive screens remain client components; Next.js itself is React-based.

The Express API and BullMQ/Playwright worker remain separate persistent Node processes. This preserves browser jobs, real-time events, Excel handling, authentication and queue recovery independently of a web request. API and Socket.IO HTTP traffic use same-origin rewrites locally and Caddy in production.

The copied local environment retains database/OAuth credentials, encryption/session keys and MySQL port. Frontend origin changes to localhost:3000. The Compose project name preserves original local volumes and accounts. No response records are replayed by migration. The original source remains in the parent folder as a backup.

Git history/remotes remain in the parent `.git`. A `NextJs/.git` pointer and `core.worktree` link make this folder the active working tree. Run Git commands from `NextJs`. Migration changes are left uncommitted; nothing is pushed automatically.

## Verification

The inherited [verification record](VERIFICATION.md) describes the old app. Migration checks on 3 November 2026 include:

- Next.js 16.4.4 installation, generated Prisma client, route type generation, TypeScript and lint.
- A production build covering every original route, including dynamic form/job pages; standalone server and static chunk artifacts are present.
- Core regression tests, six UI tests on native Next.js pages, and three MySQL/Redis integration tests in an isolated `_test` database. Final counts are recorded below.
- Real Next.js-to-Express health/readiness and Origin/auth checks, plus actual browser Socket.IO polling GET/POST. This check starts no worker.
- Preserved database/Redis URLs, encryption/session keys, MySQL port and OAuth configuration, compared without printing values. Existing Docker services remain healthy.
- Thirty-five browser JavaScript bundles scanned without exposing values: no configured encryption key, session secret or OAuth client secret was found.
- Git working tree resolves to `D:/Shivam_Excel_Project/NextJs`. Both commits and the remote-configuration hash are unchanged; `.env` remains ignored. No commit or push was performed.

The first prerender was blocked by Windows sandbox permissions; the successful build used approved filesystem access. A UI assertion was narrowed because Next.js adds an accessibility route announcer. Real proxy testing caught a Socket.IO trailing-slash mismatch and missing-Origin same-origin polling; both were corrected and verified without relaxing REST mutation protection.

Production Compose configuration was validated, but container images and online deployment were not performed. Installation still reports 19 moderate transitive advisories, with no high/critical findings. No Google responses or existing jobs were replayed. The original source remains in the parent folder as a backup.

Final executed results: **80 core tests, 6 Next.js UI tests and 3 isolated MySQL/Redis integration tests passed**. TypeScript, lint and the final server/Next.js production build passed. The real proxy check passed for API readiness, Origin/auth enforcement and actual browser Socket.IO GET/POST polling. Temporary verification servers on 3300/4100 were stopped. The normal development server, if already running, is not terminated by the verification helper.
