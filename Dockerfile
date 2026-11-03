FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/form-analyzer/package.json packages/form-analyzer/package.json
COPY packages/excel-engine/package.json packages/excel-engine/package.json
COPY packages/submission-engine/package.json packages/submission-engine/package.json
COPY workers/submission-worker/package.json workers/submission-worker/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build:server
ENV NODE_ENV=production
USER pwuser
EXPOSE 4000
CMD ["node", "dist/apps/api/src/server.js"]
