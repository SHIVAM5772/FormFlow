# Windows setup

Use Node.js 22 and PowerShell from the repository root.

```powershell
npm.cmd ci
npm.cmd run setup:env
```

Set DATABASE_URL in .env to your MongoDB Atlas connection string with the /formflow database path. Preserve DATA_KEY and SESSION_SECRET.

```powershell
npm.cmd run db:generate
npm.cmd run db:push
npx.cmd playwright install chromium
npm.cmd run user:create -- you@example.com
npm.cmd run dev:vercel
```

Open the local URL printed by Vercel. It starts the frontend, API and submission worker. For direct local development, use `npm.cmd run dev` and open http://localhost:3000. Default QUEUE_BACKEND=mongodb needs no Redis service. Use a separate local-development Atlas database to keep production jobs isolated.

For deployment and CRON_SECRET configuration, see [SETUP_PRODUCTION.md](SETUP_PRODUCTION.md). For database and browser checks, see [docs/TESTING.md](docs/TESTING.md).
