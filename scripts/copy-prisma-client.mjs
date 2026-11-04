import { cp } from 'node:fs/promises';

await cp(
  new URL('../packages/database/generated/client/', import.meta.url),
  new URL('../dist/packages/database/generated/client/', import.meta.url),
  { recursive: true },
);
