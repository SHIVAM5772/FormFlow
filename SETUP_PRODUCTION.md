# Production — Next.js

Use a persistent Linux server with Docker/Compose and a public domain. Next.js runs as a standalone Node server, Express handles API/Socket.IO, and the separate Playwright worker processes durable queues. A serverless frontend alone cannot host this complete stack.

Create `.env` from `.env.example` or `npm run setup:env`. Set `NODE_ENV=production`, `DOMAIN`, `WEB_ORIGIN=https://your-domain`, strong MySQL passwords and independent random session/encryption keys. Preserve an existing `DATA_KEY` for existing records and use a stable `COMPOSE_PROJECT_NAME` for existing volumes. Configure Google OAuth callback as `https://your-domain/api/google/callback` if used.

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
```

For a new database only:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml exec api npm run user:create -- admin@example.com
```

The migration service applies checked-in migrations before API/worker startup. Caddy terminates HTTPS, proxies `/api/*` and `/socket.io/*` to `api:4000`, and other requests to `frontend:3000`. The web image runs the traced standalone Next.js server as an unprivileged user and includes static chunks and a health check. There is no Nginx SPA fallback.

The web image builds rewrites using `API_PROXY_URL=http://api:4000`. For a different topology, change that build argument and rebuild; standalone rewrites are resolved at build time. Never expose OAuth/database secrets as public browser variables. Backend `WEB_ORIGIN` must match the public frontend origin.

MySQL/Redis retain volumes and host-loopback bindings. Redis uses AOF/noeviction. Browser workers retain CPU/memory/shared-memory limits, graceful shutdown, restart policy and Redis heartbeat health check. Begin with one worker. Do not run the original and migrated worker simultaneously against the same queue during the switch.

Schedule daily retention:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T api npm run retention
```

Back up and test restoration of database data and encryption keys. Do not delete volumes to deploy updates. Interrupted in-flight rows remain UNKNOWN and cannot be replayed automatically. Cancellation cannot undo responses already submitted.

Monitor `/api/health`, `/api/health/ready`, worker heartbeat, queue age, unknown/manual outcomes and database/disk health. Docker restarts exited processes, not merely unhealthy ones. Scaling API replicas requires distributed rate limits and a Socket.IO adapter.

See [capabilities](docs/CAPABILITIES.md), [security](docs/SECURITY.md) and [migration verification](docs/MIGRATION_NEXTJS.md). Prepared deployment configuration is not evidence of an online deployment.
