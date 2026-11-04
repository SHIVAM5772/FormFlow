import 'dotenv/config';
const url = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error(
    'This local helper requires a local MongoDB URL. For Atlas use npm run test:mongodb.',
  );
}
await import('./test-mongodb.mjs');
