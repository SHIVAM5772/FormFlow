import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { generateTemplate, parseUpload } from '../packages/excel-engine/src/index.js';
import { sampleForm } from '../tests/helpers.js';

const out = new URL('./.verification/', import.meta.url);
if (process.argv.includes('--check-saved')) {
  const result = await parseUpload(
    await readFile(new URL('multi-select.xlsm', out)),
    sampleForm(),
    '7926ad27-2a8b-487a-adf1-010723b037a3',
    10,
  );
  assert.equal(result.rows[0].answers.skills, 'Excel');
  assert.equal(result.rows[0].answers.team, 'Operations');
  console.log('Native Excel-saved XLSM uploaded and its answers verified.');
  process.exit(0);
}
await mkdir(out, { recursive: true });
await writeFile(
  new URL('multi-select.xlsm', out),
  await generateTemplate(sampleForm(), '7926ad27-2a8b-487a-adf1-010723b037a3', 10),
);
console.log('Created local macro workbook for Excel verification.');
