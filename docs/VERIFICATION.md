# Verification record

Performed on **3 November 2026** in the Windows checkout `D:\Shivam_Excel_Project` using Node 25.2.1 and npm 11.16.0. Deployment documentation and CI target Node 22 LTS; that runtime was not locally exercised.

## Executed successfully

| Check                                                                 | Result                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dependency installation and lockfile                                  | Installed successfully; all workspace packages declared                                    |
| `npm run db:generate`                                                 | Prisma Client 6.19.0 generated                                                             |
| `prisma validate --schema packages/database/prisma/schema.prisma`     | Schema valid                                                                               |
| `prisma migrate diff --from-empty --to-schema-datamodel ... --script` | Initial SQL migration generated and checked in                                             |
| `npm run typecheck`                                                   | Server/packages/tests and React TypeScript checks passed                                   |
| `npm run lint`                                                        | ESLint passed                                                                              |
| `npm run build`                                                       | Server compilation and Vite production build passed                                        |
| `npm test`                                                            | 53 tests passed across 8 files                                                             |
| `npm run test:e2e`                                                    | 2 Playwright UI tests passed                                                               |
| Final dependency audit                                                | 19 moderate findings; no reported high or critical findings; `--audit-level=high` exited 0 |

The core tests cover actual Excel workbook creation, dropdown ranges, reading filled rows, preserving leading zeroes, validation of required/options/checkboxes/grids/scales/calendar/conditional data, duplicate detection, template identity, formula rejection, ZIP size limits and forged expansion claims. Public/owner schema normalization, strict URL and private-address rejection, authenticated encryption, API auth/Origin/ownership rules and retry safety are also tested.

Chromium tests use real local HTTP forms, submit actual fields, verify the server received checkbox arrays and identifiers, and require visible confirmation. A test where the server receives the POST but omits confirmation correctly returns UNKNOWN. Both paths of a conditional multi-section fixture are exercised with an inactive required field omitted. These tests do not touch unrelated Google Forms.

Worker state-machine tests use an isolated in-memory persistence adapter to verify sequencing, pause/resume, cancellation before intent, manual intervention, continuing independent rows, interrupted-row recovery (including cancellation), and preventing replays. This verifies processor behavior, not actual MySQL or Redis durability.

UI tests verify sign-in validation, mobile layout, the dashboard with isolated API contract fixtures, theme switching and mobile navigation. The dashboard screenshot was inspected. Shipped frontend data always comes from the API; there is no production mock mode. The missing-API proxy warnings during the unauthenticated UI test are expected in this environment.

Playwright used the machine's existing compatible Chromium revision 1194 via `PLAYWRIGHT_BROWSERS_PATH`. The restricted sandbox initially blocked loopback connections; successful network/browser tests ran with approved local-server access. No browser result was substituted with a passing mock.

## Not executed / not verified

- **MySQL and Redis:** neither port 3306 nor 6379 was listening, and Docker was unavailable. No database migration was applied to a live server. The guarded `test:services` suite was written but not run here, so database persistence, real queue reconciliation, Redis progress messages and container restart recovery remain unverified.
- **Docker/HTTPS:** Dockerfiles, Compose services, health checks and Caddy configuration were prepared, but images were not built and no server was deployed. The worker heartbeat check depends on real services and is unverified locally.
- **Google live behavior:** no supplied form, authorized test target or Google OAuth credentials were available. Owner OAuth, public Google layout compatibility and responses appearing in a real owner's Responses section were not tested. Public respondent metadata is undocumented and may change.
- **Remote CI:** a workflow that provisions MySQL/Redis and runs the service suite is included; no remote GitHub Actions run occurred in this session.
- **Operational assurance:** no load test, penetration test, cross-browser certification, distributed API deployment, or database/key-rotation restore drill was performed.

Vite emitted harmless Rollup annotation warnings from Zod dependency comments; production assets built successfully. Moderate advisory exposure and recommended maintenance are described in [SECURITY.md](SECURITY.md). Functional limits, including unsupported respondent authentication and certain navigation layouts, are listed in [CAPABILITIES.md](CAPABILITIES.md).

Use [SETUP_WINDOWS.md](../SETUP_WINDOWS.md) to start dependencies, then run the isolated service tests in [TESTING.md](TESTING.md) and a small form you own before operational bulk submissions.

## Subsequent local troubleshooting

Docker Desktop and WSL were installed during local setup. The project MySQL container was bound to host port 3307 to avoid an existing listener on 3306. MySQL and Redis became healthy and the initial migration was applied successfully. This establishes local service startup and migration success; the dedicated service integration suite and production deployment remain unverified.

Development Origin aliases were checked against the running app: localhost and 127.0.0.1 on the configured frontend port were accepted, while an external Origin stayed rejected. Restricted-form preview changes passed 20 targeted analyzer/API/browser tests and 3 UI tests, plus TypeScript/lint/build checks. A read-only anonymous analysis of the user's Google Form detected the title and five questions, while preserving mandatory Google sign-in and custom Email-validation blockers. No Google responses were submitted and no respondent access settings were changed.

The subsequent Email-rule and upload-screen fixes passed the full **67-test core suite and 4 UI E2E tests**, plus TypeScript, lint and production builds. A fresh read-only analysis recognized the form's standard Email rule and retained only its mandatory Google sign-in blocker. Unknown/combined validation rules remain blocked. Upload previews now expose form restrictions separately from row validation and disable authorization/submission controls when blocked. Existing schema snapshots/templates are unchanged; reanalysis is required to adopt the new Email-rule mapping. No third-party Google responses were submitted.

A later paused job exposed a Google required-heading locator mismatch. Its five records were inspected without reading answers: all were NEEDS_MANUAL_ACTION, with no Submit intent or submission timestamp. The locator now checks structured question/entry IDs and understands required-question accessibility labels. A read-only check found all five live form fields; browser submission verification remained confined to local fixtures. The job was not resumed or resubmitted. The UI now reports verified-submission progress, shows manual-action counts and offers explicit individual retries only for proven pre-submit mapping failures. UNKNOWN and intent-bearing records remain blocked. The full 74-test core suite and 5 UI tests passed, as did TypeScript, lint and production builds.

The user later ran a new five-record batch, all of which were recorded UNKNOWN after Submit intent. Read-only inspection found a custom confirmation message that the old default-only detector could not recognize. The user reported that the form owner confirmed receiving the five responses. Existing statuses and historical reports were not rewritten and the records were not replayed. The analyzer now records custom confirmation text, the engine verifies it alongside a successful POST reply/redirect and finished page, and missing confirmations retain sanitized stage/HTTP diagnostics. The full 79-test core suite and 5 UI tests passed, along with TypeScript, lint and production builds. New positive and negative tests use local fixtures only, including custom confirmation, 303 redirects, HTTP errors and a still-visible Submit form.
