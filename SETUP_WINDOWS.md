# Windows setup

Use Node.js 22 or a supported newer version and PowerShell from this repository's root.

```powershell
npm.cmd ci
npm.cmd run setup:env
```

Set DATABASE_URL in `.env` to your MongoDB Atlas connection string, including the database path, for example `/formflow` before `?`. Preserve the existing DATA_KEY and SESSION_SECRET. Do not paste credentials into frontend variables.

For local MongoDB, install Docker Desktop and run `docker compose up -d mongo mongo-init`. Use `mongodb://localhost:27017/formflow?replicaSet=rs0&directConnection=true`. Replica sets are required for Prisma transactions. Atlas already supplies one.

```powershell
npm.cmd run db:generate
npm.cmd run db:push
npx.cmd playwright install chromium
npm.cmd run user:create -- you@example.com
npm.cmd run dev
```

Open http://localhost:3000. Default QUEUE_BACKEND=mongodb requires no Redis service. The API is on 4000; the worker health endpoint is on 4001. Stop an old worker before switching queue mode.

Run `npm.cmd run test:mongodb` to verify actual persistence and browser processing in a separate `formflow_codex_test` database. It does not submit to Google or write test records into the app database. Existing MySQL records are not copied automatically.

For the full Vercel deployment, see [SETUP_PRODUCTION.md](SETUP_PRODUCTION.md).
