# Windows — Next.js version

Use Node 22 LTS, npm, Docker Desktop with Linux Engine, and PowerShell. First stop the original development terminal with Ctrl+C. Both versions use API port 4000 and the same queue/database; run one version at a time.

```powershell
cd D:\Shivam_Excel_Project\NextJs
npm.cmd install
npm.cmd run setup:env
docker compose up -d --wait
npm.cmd run db:generate
npm.cmd run db:deploy
npx.cmd playwright install chromium
npm.cmd run dev
```

Visit [http://localhost:3000](http://localhost:3000) and use the existing workspace email/password. The environment helper never overwrites an existing `.env`. For a fresh database only, create an account with `npm.cmd run user:create -- you@example.com`.

The migrated `.env` retains the original encryption key, session secret, database credentials, MySQL port and OAuth settings. `WEB_ORIGIN` now points to localhost:3000; `API_PROXY_URL` points to http://127.0.0.1:4000. `COMPOSE_PROJECT_NAME=shivam_excel_project` preserves the original containers/volumes. Do not delete volumes or regenerate the encryption key when keeping existing data.

If Docker is missing from this terminal:

```powershell
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"
```

If another MySQL service uses 3306, set `MYSQL_PORT=3307` and the same host port in `DATABASE_URL`; the migrated environment already retains this setting. Docker still uses 3306 internally.

Google owner OAuth continues to use `http://localhost:4000/api/google/callback`. Keep that exact callback in Google Cloud and `.env`, then use `http://localhost:3000` in the browser so cookies and callback share the hostname. No Google password is collected by FormFlow.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

For database model development use `db:migrate` with a separate shadow database. Ordinary setup uses `db:deploy`. See [testing](docs/TESTING.md) for the guarded `_test` suite. Ctrl+C stops development processes; `docker compose stop` preserves data.
