import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import CFB from 'cfb';
import { readFile } from 'node:fs/promises';
import { sampleForm, sampleAnswers } from './helpers.js';
import {
  generateTemplate,
  parseUpload,
  validateAnswers,
  inspectZip,
  verifyZipExpansion,
  templateFileType,
} from '../packages/excel-engine/src/index.js';
import { columns, questionSchema } from '../packages/shared/src/index.js';
import { normalizeGoogleApi, normalizePublic } from '../packages/form-analyzer/src/normalize.js';
const templateId = '7926ad27-2a8b-487a-adf1-010723b037a3';
it('exports and imports an untitled checkbox without a false form blocker', async () => {
  const form = normalizePublic(
    [
      null,
      [
        '',
        [[257571857, null, null, 4, [[987, [['Option 1'], ['Option 2']], 0]]]],
        null,
        null,
        null,
        null,
        null,
        null,
        'Contact',
      ],
    ],
    'https://docs.google.com/forms/d/e/test/viewform',
  );
  expect(form.blockers).toEqual([]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 5)) as any);
  const sheet = book.getWorksheet('Responses')!;
  expect(sheet.getCell('A1').text).toBe('Untitled question (257571857)');
  expect(sheet.getCell('A2').dataValidation.formulae![0]).toMatch(/^FormFlowMulti_/);
  sheet.getCell('A2').value = 'Option 1; Option 2';
  const result = await parseUpload(Buffer.from(await book.xlsx.writeBuffer()), form, templateId, 5);
  expect(result.valid).toBe(1);
  expect(result.rows[0].answers['257571857']).toBe('Option 1; Option 2');
});
it('embeds multi-select VBA into the actual downloaded workbook and imports its answers', async () => {
  const form = sampleForm();
  expect(templateFileType(form).extension).toBe('xlsm');
  const buffer = await generateTemplate(form, templateId, 10);
  const zip = await JSZip.loadAsync(buffer);
  const vba = await zip.file('xl/vbaProject.bin')!.async('nodebuffer');
  expect(vba).toEqual(
    await readFile(new URL('../packages/excel-engine/assets/vbaProject.bin', import.meta.url)),
  );
  const cfb = CFB.read(vba, { type: 'buffer' });
  expect(CFB.find(cfb, 'ThisWorkbook')).not.toBeNull();
  expect(CFB.find(cfb, 'Module1')).not.toBeNull();
  expect(CFB.find(cfb, '__SRP_0')).toBeNull();
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('macroEnabled.main+xml');
  expect(await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).toContain(
    'relationships/vbaProject',
  );
  expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('codeName="ThisWorkbook"');
  expect(() => inspectZip(buffer)).toThrow('Unsafe');
  expect(() => inspectZip(buffer, true)).not.toThrow();

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as any);
  book.getWorksheet('Responses')!.getRow(2).values = columns(form).map(
    (c) => sampleAnswers[c.key as keyof typeof sampleAnswers],
  );
  // ExcelJS drops VBA when saving; restore it to exercise the real XLSM upload path.
  const filled = await JSZip.loadAsync(Buffer.from(await book.xlsx.writeBuffer()));
  filled.file('xl/vbaProject.bin', vba);
  const uploaded = await parseUpload(
    await filled.generateAsync({ type: 'nodebuffer' }),
    form,
    templateId,
    10,
  );
  expect(uploaded.valid).toBe(1);
  expect(uploaded.rows[0].answers.skills).toBe('TypeScript; Excel');
});

it('keeps forms with only single choices macro-free', async () => {
  const form = sampleForm();
  form.questions = form.questions.filter((q) => !q.type.includes('CHECKBOX'));
  expect(templateFileType(form).extension).toBe('xlsx');
  const zip = await JSZip.loadAsync(await generateTemplate(form, templateId, 5));
  expect(zip.file('xl/vbaProject.bin')).toBeNull();
});
it.each([
  ['RADIO', 'MULTIPLE_CHOICE', 'FormFlowChoices_', false],
  ['DROP_DOWN', 'DROPDOWN', 'FormFlowChoices_', false],
  ['CHECKBOX', 'CHECKBOXES', 'FormFlowMulti_', true],
] as const)(
  'preserves %s selection behavior including Other answers',
  async (apiType, type, prefix, multi) => {
    const form = normalizeGoogleApi(
      {
        info: { title: 'Choice types' },
        items: [
          {
            itemId: 'choice',
            title: 'Choice',
            questionItem: {
              question: {
                required: true,
                choiceQuestion: {
                  type: apiType,
                  options: [{ value: 'A' }, { value: 'B' }, { isOther: true }],
                },
              },
            },
          },
        ],
      },
      'https://docs.google.com/forms/d/e/test/viewform',
    );
    expect(form.questions[0]).toMatchObject({ type, other: true, options: ['A', 'B'] });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await generateTemplate(form, templateId, 5)) as any);
    const sheet = book.getWorksheet('Responses')!;
    const validation = sheet.getCell('A2').dataValidation;
    expect(validation.type).toBe('list');
    expect(String(validation.formulae![0]).startsWith(prefix)).toBe(true);
    expect(validation.showErrorMessage).not.toBe(true);
    if (!multi) expect(validation.prompt).toContain('Other:');
    sheet.getCell('A2').value = multi ? 'A; B; Other: custom' : 'Other: custom';
    const result = await parseUpload(
      Buffer.from(await book.xlsx.writeBuffer()),
      form,
      templateId,
      5,
    );
    expect(result.valid).toBe(1);
    expect(validateAnswers(form, { choice: multi ? 'A; Unknown' : 'A; B' })).not.toEqual([]);
  },
);

it.each([2, 4])(
  'keeps public choice type %s options separate from the Other placeholder',
  async (type) => {
    const form = normalizePublic(
      [
        null,
        [
          '',
          [[123, 'Choice', null, type, [[456, [['A'], ['B'], ['', null, null, null, 1]], 1]]]],
          null,
          null,
          null,
          null,
          null,
          null,
          'Choices',
        ],
      ],
      'https://docs.google.com/forms/d/e/test/viewform',
    );
    expect(form.questions[0]).toMatchObject({
      type: type === 4 ? 'CHECKBOXES' : 'MULTIPLE_CHOICE',
      other: true,
      options: ['A', 'B'],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await generateTemplate(form, templateId, 5)) as any);
    const validation = book.getWorksheet('Responses')!.getCell('A2').dataValidation;
    expect(validation.type).toBe('list');
    expect(String(validation.formulae![0])).toContain(
      type === 4 ? 'FormFlowMulti_' : 'FormFlowChoices_',
    );
  },
);

it('marks checkbox and checkbox-grid cells for the add-in while allowing combined answers', async () => {
  const form = sampleForm();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 10)) as any);
  const sheet = book.getWorksheet('Responses')!;
  for (const address of ['E2', 'K2']) {
    const cell = sheet.getCell(address);
    expect(cell.dataValidation.type).toBe('list');
    expect(cell.dataValidation.formulae![0]).toMatch(/^FormFlowMulti_/);
    expect(cell.dataValidation.showErrorMessage).not.toBe(true);
    expect(cell.dataValidation.prompt).toContain('checkbox menu');
    expect(sheet.getCell(11, cell.col).dataValidation).toEqual(cell.dataValidation);
    const ranges = book.definedNames.getRanges(String(cell.dataValidation.formulae![0])).ranges;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toContain('Validation Reference');
  }
  expect(sheet.getCell('C2').dataValidation.showErrorMessage).toBe(true);
  sheet.getRow(2).values = columns(form).map(
    (c) => sampleAnswers[c.key as keyof typeof sampleAnswers],
  );
  const result = await parseUpload(
    Buffer.from(await book.xlsx.writeBuffer()),
    form,
    templateId,
    10,
  );
  expect(result.valid).toBe(1);
  expect(result.rows[0].answers.skills).toBe('TypeScript; Excel');
  expect(result.rows[0].answers['checks::First']).toBe('A; B');
  sheet.getCell('E2').value = 'TypeScript; Unknown';
  const invalid = await parseUpload(
    Buffer.from(await book.xlsx.writeBuffer()),
    form,
    templateId,
    10,
  );
  expect(invalid.invalid).toBe(1);
});
it('does not offer add-in lists when checkbox labels contain the answer separator', async () => {
  const form = sampleForm();
  form.questions.find((q) => q.id === 'skills')!.options = ['A; B', 'C'];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 10)) as any);
  expect(book.getWorksheet('Responses')!.getCell('E2').dataValidation).toBeUndefined();
});
it('preserves analyzed dropdown options as named Excel lists across every allowed response row', async () => {
  const options = [
    'Delhi, NCR',
    'Option "quoted"',
    'मुंबई',
    ...Array.from({ length: 40 }, (_, i) => `Choice ${i + 1} with a longer label`),
  ];
  const form = normalizeGoogleApi(
    {
      info: { title: 'Dropdown compatibility' },
      items: [
        {
          itemId: 'region',
          title: 'Region',
          questionItem: {
            question: {
              questionId: 'q-region',
              required: true,
              choiceQuestion: { type: 'DROP_DOWN', options: options.map((value) => ({ value })) },
            },
          },
        },
        {
          itemId: 'optional',
          title: 'Optional region',
          questionItem: {
            question: {
              questionId: 'q-optional',
              choiceQuestion: {
                type: 'DROP_DOWN',
                options: [{ value: 'North' }, { value: 'South' }],
              },
            },
          },
        },
      ],
    },
    'https://docs.google.com/forms/d/e/test/viewform',
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 2000)) as any);
  const sheet = book.getWorksheet('Responses')!;
  const validation = sheet.getCell('A2').dataValidation;
  expect(validation.type).toBe('list');
  expect(validation.allowBlank).not.toBe(true);
  expect(validation.showInputMessage).toBe(true);
  expect(sheet.getCell('A1000').dataValidation).toEqual(validation);
  expect(sheet.getCell('A2001').dataValidation).toEqual(validation);
  expect(sheet.getCell('A2002').dataValidation).toBeUndefined();
  const name = String(validation.formulae![0]);
  expect(name).toMatch(/^FormFlowChoices_/);
  expect(book.definedNames.getRanges(name).ranges).toEqual([
    `'Validation Reference'!$B$2:$B$${options.length + 1}`,
  ]);
  const reference = book.getWorksheet('Validation Reference')!;
  expect(options.map((_, i) => reference.getCell(`B${i + 2}`).text)).toEqual(options);
  expect(sheet.getCell('B2').dataValidation.allowBlank).toBe(true);
  expect(sheet.getCell('B2').dataValidation.formulae).not.toEqual(validation.formulae);
});
it('carries public Google Form dropdown metadata into the downloaded Excel template', async () => {
  const form = normalizePublic(
    [
      null,
      [
        'Description',
        [[123, 'Department', null, 3, [[456, [['Engineering'], ['Operations']], 1]]]],
        null,
        null,
        null,
        null,
        null,
        null,
        'Registration',
      ],
    ],
    'https://docs.google.com/forms/d/e/test/viewform',
  );
  expect(form.questions[0]).toMatchObject({
    type: 'DROPDOWN',
    options: ['Engineering', 'Operations'],
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await generateTemplate(form, templateId, 5)) as any);
  const validation = book.getWorksheet('Responses')!.getCell('A2').dataValidation;
  expect(validation.type).toBe('list');
  expect(book.definedNames.getRanges(String(validation.formulae![0])).ranges).toEqual([
    "'Validation Reference'!$B$2:$B$3",
  ]);
  expect(book.getWorksheet('Validation Reference')!.getCell('B2').text).toBe('Engineering');
  expect(book.getWorksheet('Validation Reference')!.getCell('B3').text).toBe('Operations');
});
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
  inspectZip(buffer, true);
  await expect(verifyZipExpansion(buffer)).rejects.toThrow('expansion');
});
