import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleForm, sampleAnswers } from './helpers.js';
import {
  generateTemplate,
  parseUpload,
  validateAnswers,
  inspectZip,
  verifyZipExpansion,
} from '../packages/excel-engine/src/index.js';
import { columns, questionSchema } from '../packages/shared/src/index.js';
const templateId = '7926ad27-2a8b-487a-adf1-010723b037a3';
it('generates all four sheets and parses a filled workbook preserving identifiers', async () => {
  const form = sampleForm();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 10)) as any);
  expect(book.worksheets.map((s) => s.name)).toEqual([
    'Responses',
    'Validation Reference',
    'Instructions',
    'Field Mapping',
  ]);
  const sheet = book.getWorksheet('Responses')!;
  sheet.addRow(columns(form).map((c) => sampleAnswers[c.key as keyof typeof sampleAnswers]));
  expect(sheet.getCell('A2').numFmt).toBe('@');
  const result = await parseUpload(
    Buffer.from(await book.xlsx.writeBuffer()),
    form,
    templateId,
    10,
  );
  expect(result.valid).toBe(1);
  expect(result.rows[0].answers.name).toBe('0012345678');
});
it('rejects mismatched versions, formulas and duplicate rows', async () => {
  const form = sampleForm();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 10)) as any);
  const sheet = book.getWorksheet('Responses')!;
  const row = columns(form).map((c) => sampleAnswers[c.key as keyof typeof sampleAnswers]);
  sheet.addRow(row);
  sheet.addRow(row);
  sheet.addRow(row);
  sheet.getCell('A4').value = { formula: '1+1', result: 2 };
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const result = await parseUpload(buffer, form, templateId, 10);
  expect(result.valid).toBe(1);
  expect(result.invalid).toBe(2);
  expect(result.rows[1].duplicate).toBe(true);
  expect(result.rows[2].errors.join()).toContain('formulas');
  await expect(parseUpload(buffer, form, 'wrong', 10)).rejects.toThrow('version mismatch');
  await expect(parseUpload(buffer, form, templateId, 1)).rejects.toThrow('Row limit');
});
it('validates required, choice, checkbox, grid, scale and calendar values', () => {
  const form = sampleForm();
  expect(validateAnswers(form, sampleAnswers)).toEqual([]);
  const errors = validateAnswers(form, {
    ...sampleAnswers,
    name: '',
    team: 'Unknown',
    skills: 'TypeScript; Hack',
    'grid::Monday': 'Maybe',
    date: '2026-02-30',
    time: '24:00',
    rating: '9',
  });
  expect(errors).toHaveLength(7);
});
it('checks declared email validation without guessing from a question title', () => {
  const form = sampleForm();
  form.questions = [
    questionSchema.parse({
      id: 'email',
      title: 'Contact',
      type: 'SHORT_TEXT',
      sectionId: 'section-1',
      required: true,
      validation: { kind: 'EMAIL' },
    }),
  ];
  expect(validateAnswers(form, { email: 'person+tag@example.com' })).toEqual([]);
  expect(validateAnswers(form, { email: 'not-an-email' })).toEqual([
    'Contact: enter a valid email address',
  ]);
  expect(validateAnswers(form, { email: '' })).toEqual(['Contact: required']);
  form.questions[0].required = false;
  expect(validateAnswers(form, { email: '' })).toEqual([]);
  delete form.questions[0].validation;
  form.questions[0].title = 'Email';
  expect(validateAnswers(form, { email: 'plain text permitted by this question' })).toEqual([]);
});
it('requires conditional fields only on the selected path', () => {
  const form = sampleForm();
  form.questions = [
    questionSchema.parse({
      id: 'choice',
      title: 'Continue',
      type: 'MULTIPLE_CHOICE',
      required: true,
      sectionId: 'section-1',
      options: ['Yes', 'No'],
      branches: { Yes: 'details', No: 'SUBMIT' },
    }),
    questionSchema.parse({
      id: 'detail',
      title: 'Details',
      type: 'SHORT_TEXT',
      required: true,
      sectionId: 'details',
    }),
  ];
  form.sections.push({ id: 'details', title: 'Details' });
  expect(validateAnswers(form, { choice: 'No' })).toEqual([]);
  expect(validateAnswers(form, { choice: 'Yes' })).toEqual(['Details: required']);
});
it('rejects non-zip files and expanded ZIP bombs before parsing', async () => {
  expect(() => inspectZip(Buffer.from('bad'))).toThrow();
  const buffer = await generateTemplate(sampleForm(), templateId, 5);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(60 * 1024 * 1024, central + 24);
  expect(() => inspectZip(buffer)).toThrow('Unsafe');
});
it('does not trust forged ZIP size claims', async () => {
  const buffer = await generateTemplate(sampleForm(), templateId, 5);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(1, central + 24);
  inspectZip(buffer);
  await expect(verifyZipExpansion(buffer)).rejects.toThrow('expansion');
});
