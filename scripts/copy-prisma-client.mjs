import { cp } from 'node:fs/promises';

await cp(
  new URL('../packages/database/generated/client/', import.meta.url),
  new URL('../dist/packages/database/generated/client/', import.meta.url),
  { recursive: true },
);
await cp(
  new URL('../packages/excel-engine/assets/', import.meta.url),
  new URL('../dist/packages/excel-engine/assets/', import.meta.url),
  { recursive: true },
);
