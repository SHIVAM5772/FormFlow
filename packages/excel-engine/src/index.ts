import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  activeSections,
  columns,
  type Answers,
  type FormDefinition,
  type ValidationResult,
  type ValidatedRow,
} from '../../shared/src/index.js';

export function validateAnswers(form: FormDefinition, answers: Answers): string[] {
  const errors: string[] = [];
  const active = activeSections(form, answers);
  for (const { key, q, row } of columns(form)) {
    const value = (answers[key] ?? '').trim();
    if (!active.has(q.sectionId)) continue;
    const title = row ? `${q.title} / ${row}` : q.title;
    if (!value) {
      if (q.required) errors.push(`${title}: required`);
      continue;
    }
    if (value.length > 10000) {
      errors.push(`${title}: exceeds 10,000 characters`);
      continue;
    }
    if (['FILE_UPLOAD', 'UNSUPPORTED'].includes(q.type)) errors.push(`${title}: unsupported field`);
    if (q.validation?.kind === 'EMAIL' && !z.email().safeParse(value).success)
      errors.push(`${title}: enter a valid email address`);
    if (
      [
        'MULTIPLE_CHOICE',
        'DROPDOWN',
        'MULTIPLE_CHOICE_GRID',
        'CHECKBOXES',
        'CHECKBOX_GRID',
      ].includes(q.type)
    ) {
      const values = q.type.includes('CHECKBOX') ? value.split(';').map((s) => s.trim()) : [value];
      if (new Set(values).size !== values.length) errors.push(`${title}: repeated checkbox option`);
      for (const v of values)
        if (!q.options.includes(v) && !(q.other && v.startsWith('Other: ') && v.length > 7))
          errors.push(`${title}: invalid option; use an allowed label`);
    }
    if (
      q.type === 'LINEAR_SCALE' &&
      (!/^\d+$/.test(value) || Number(value) < q.min! || Number(value) > q.max!)
    )
      errors.push(`${title}: enter an integer from ${q.min} to ${q.max}`);
    if (
      q.type === 'DATE' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      errors.push(`${title}: use a valid YYYY-MM-DD date`);
    if (q.type === 'TIME' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      errors.push(`${title}: use HH:mm (24-hour)`);
  }
  return errors;
}
export async function generateTemplate(form: FormDefinition, templateId: string, maxRows = 2000) {
  const book = new ExcelJS.Workbook();
  book.creator = 'FormFlow Automation';
  const sheet = book.addWorksheet('Responses', { views: [{ state: 'frozen', ySplit: 1 }] });
  const fields = columns(form);
  sheet.columns = fields.map((c) => ({
    header: c.heading,
    key: c.key,
    width: Math.min(55, Math.max(25, c.heading.length + 3)),
  }));
  const reference = book.addWorksheet('Validation Reference');
  reference.addRow(['Field', 'Allowed value / rule']);
  const ranges = new Map<string, string>();
  for (const c of fields) {
    const start = reference.rowCount + 1;
    const options = c.q.options.length
      ? c.q.options
      : [
          c.q.type === 'DATE'
            ? 'YYYY-MM-DD'
            : c.q.type === 'TIME'
              ? 'HH:mm'
              : c.q.type === 'LINEAR_SCALE'
                ? `${c.q.min} through ${c.q.max}`
                : c.q.validation?.kind === 'EMAIL'
                  ? 'Email address, for example name@example.com'
                  : 'Text',
        ];
    for (const value of options) reference.addRow([c.heading, value]);
    ranges.set(c.key, `'Validation Reference'!$B$${start}:$B$${reference.rowCount}`);
  }
  fields.forEach((c, index) => {
    const col = sheet.getColumn(index + 1);
    col.numFmt = '@';
    const header = sheet.getCell(1, index + 1);
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.q.required ? 'FF9A3412' : 'FF0F766E' },
    };
    header.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    header.note = `${c.q.required ? 'Required' : 'Optional'} · ${c.q.type}${c.q.other ? ' · Other: your answer' : ''}`;
    const multiSelect =
      ['CHECKBOXES', 'CHECKBOX_GRID'].includes(c.q.type) &&
      c.q.options.length > 0 &&
      !c.q.options.some((option) => option.includes(';'));
    if (
      multiSelect ||
      (['DROPDOWN', 'MULTIPLE_CHOICE', 'MULTIPLE_CHOICE_GRID', 'LINEAR_SCALE'].includes(c.q.type) &&
        !c.q.other &&
        c.q.options.length)
    ) {
      // Workbook-scoped names keep lists on another sheet compatible with Excel.
      // A cell range also preserves commas, quotes and long option lists verbatim.
      const listName = `${multiSelect ? 'FormFlowMulti' : 'FormFlowChoices'}_${index + 1}`;
      book.definedNames.add(ranges.get(c.key)!, listName);
      (sheet as any).dataValidations.add(`${col.letter}2:${col.letter}${maxRows + 1}`, {
        type: 'list',
        allowBlank: !c.q.required,
        formulae: [listName],
        showInputMessage: true,
        promptTitle: multiSelect ? 'Choose multiple options' : 'Choose an option',
        prompt: multiSelect
          ? 'With the FormFlow Excel add-in, double-click for a checkbox menu or use the dropdown to toggle choices. Otherwise separate choices with semicolons.'
          : 'Select this response cell, then use its drop-down arrow to choose a value.',
        showErrorMessage: !multiSelect,
        errorTitle: 'Invalid value',
        error: 'Select an allowed value',
        errorStyle: 'stop',
      });
      if (multiSelect)
        header.note +=
          '\nFormFlow add-in: double-click for a checkbox menu. Without the add-in, separate selected labels with semicolons.';
    }
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, fields.length) },
  };
  const instructions = book.addWorksheet('Instructions');
  instructions.columns = [{ width: 32 }, { width: 110 }];
  for (const row of [
    ['Form title', form.title],
    ['Form URL', form.sourceUrl],
    ['Template ID', templateId],
    [
      'Fill responses',
      'Enter one person per row. Preserve headings and the Field Mapping sheet. Do not use formulas.',
    ],
    [
      'Required fields',
      'Orange headings and * indicate required fields on the active section path.',
    ],
    [
      'Identifiers',
      'All response columns use text format, preserving leading zeroes in phone numbers and IDs.',
    ],
    [
      'Dropdowns',
      'On Responses, select a dropdown or single-choice cell in row 2 onward and click its drop-down arrow. Choices match the analyzed form. The arrow appears when the cell is selected.',
    ],
    [
      'Checkboxes',
      'With the FormFlow desktop Excel add-in, double-click a checkbox response cell for a tick menu, or choose dropdown items one by one to toggle them. Without the add-in, enter exact labels separated by semicolons: Option A; Option B. Save and upload this .xlsx file; do not embed macros. Labels containing semicolons require manual handling.',
    ],
    ['Other responses', 'If offered, use Other: your text.'],
    ['Grids', 'Each grid row has its own response column. Checkbox grids use semicolons.'],
    ['Dates and times', 'Use YYYY-MM-DD and HH:mm (24-hour) as text.'],
    [
      'Sections',
      'Leave questions outside your chosen section path blank. Branches and restrictions are checked before submitting.',
    ],
    [
      'Limits',
      `Maximum ${maxRows} rows. Sign-in, uploads, CAPTCHA and unknown validation require manual intervention.`,
    ],
    [
      'Confirmation',
      'Only submit forms you are authorized to use. Review the batch before confirming.',
    ],
    ['Warnings', [...form.warnings, ...form.blockers].join('\n')],
  ])
    instructions.addRow(row);
  const mapping = book.addWorksheet('Field Mapping');
  mapping.addRow(['Template ID', templateId]);
  mapping.addRow(['Schema fingerprint', form.fingerprint]);
  mapping.addRow([
    'Key',
    'Heading',
    'Question ID',
    'Title',
    'Type',
    'Required',
    'Options',
    'Section',
  ]);
  for (const c of fields)
    mapping.addRow([
      c.key,
      c.heading,
      c.q.id,
      c.q.title,
      c.q.type,
      c.q.required,
      c.q.options.join('; '),
      c.q.sectionId,
    ]);
  mapping.columns.forEach((c) => {
    c.width = 32;
  });
  reference.columns = [{ width: 55 }, { width: 65 }];
  for (const ws of book.worksheets) {
    ws.getRow(1).height = 28;
    ws.eachRow((row) => (row.alignment = { vertical: 'top', wrapText: true }));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function parseUpload(
  buffer: Buffer,
  form: FormDefinition,
  templateId: string,
  maxRows = 2000,
): Promise<ValidationResult> {
  // Bound ZIP expansion before ExcelJS materializes XML; reject encrypted/ZIP64 archives.
  inspectZip(buffer);
  await verifyZipExpansion(buffer);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as any);
  const sheet = book.getWorksheet('Responses');
  const mapping = book.getWorksheet('Field Mapping');
  if (
    !sheet ||
    !mapping ||
    mapping.getCell('B1').text !== templateId ||
    mapping.getCell('B2').text !== form.fingerprint
  )
    throw new Error('Template ID or schema version mismatch. Download the current template.');
  const fields = columns(form);
  if (sheet.columnCount !== fields.length) throw new Error('Response columns have changed');
  fields.forEach((c, i) => {
    if (sheet.getCell(1, i + 1).text !== c.heading || mapping.getCell(i + 4, 1).text !== c.key)
      throw new Error('Template headings or field mapping have changed');
  });
  const rows: ValidatedRow[] = [];
  const seen = new Map<string, ValidatedRow>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || !row.values || !row.hasValues) return;
    if (rowNumber > maxRows + 1) throw new Error(`Row limit exceeded (${maxRows})`);
    const answers: Answers = {};
    const parseErrors: string[] = [];
    fields.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const value = cell.value;
      if (value === null || value === undefined) {
        answers[c.key] = '';
        return;
      }
      if (typeof value === 'object') {
        parseErrors.push(
          `${c.heading}: formulas, links, rich text and date objects are not accepted; enter plain text`,
        );
        answers[c.key] = '';
      } else answers[c.key] = String(value).trim();
    });
    if (!Object.values(answers).some(Boolean) && !parseErrors.length) return;
    const current: ValidatedRow = {
      rowNumber,
      answers,
      errors: [...parseErrors, ...validateAnswers(form, answers)],
      duplicate: false,
    };
    const hash = createHash('sha256').update(JSON.stringify(answers)).digest('hex');
    const original = seen.get(hash);
    if (original) {
      current.duplicate = true;
      current.errors.push(`Duplicate of row ${original.rowNumber}`);
    } else seen.set(hash, current);
    rows.push(current);
  });
  if (!rows.length) throw new Error('No response rows found');
  return {
    total: rows.length,
    valid: rows.filter((r) => !r.errors.length).length,
    invalid: rows.filter((r) => r.errors.length).length,
    rows,
  };
}
export function inspectZip(buffer: Buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50)
    throw new Error('Upload must be a valid XLSX ZIP file');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid XLSX archive');
  const count = buffer.readUInt16LE(eocd + 10);
  let position = buffer.readUInt32LE(eocd + 16);
  let expanded = 0;
  if (count > 2000 || count === 65535 || position >= buffer.length)
    throw new Error('Archive is too complex');
  for (let i = 0; i < count; i++) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50)
      throw new Error('Invalid ZIP directory');
    const flags = buffer.readUInt16LE(position + 8);
    const size = buffer.readUInt32LE(position + 24);
    expanded += size;
    const length = buffer.readUInt16LE(position + 28);
    const name = buffer.subarray(position + 46, position + 46 + length).toString();
    if (
      flags & 1 ||
      expanded > 50 * 1024 * 1024 ||
      size === 0xffffffff ||
      name.includes('..') ||
      /vbaProject|externalLinks/i.test(name)
    )
      throw new Error('Unsafe or oversized workbook');
    position +=
      46 + length + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
}
// Verify actual streamed expansion too: forged central-directory size claims are not trusted.
export async function verifyZipExpansion(buffer: Buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP directory');
  const count = buffer.readUInt16LE(eocd + 10);
  let position = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20);
    const expected = buffer.readUInt32LE(position + 24);
    const offset = buffer.readUInt32LE(position + 42);
    if (
      offset + 30 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x04034b50 ||
      compressed === 0xffffffff
    )
      throw new Error('Invalid ZIP entry');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const end = start + compressed;
    if (end > buffer.length || start > end) throw new Error('Invalid ZIP entry bounds');
    const payload = buffer.subarray(start, end);
    let actual = 0;
    if (method === 0) {
      actual = payload.length;
      total += actual;
    } else if (method === 8) {
      const stream = Readable.from([payload]).pipe(createInflateRaw());
      try {
        for await (const chunk of stream) {
          actual += chunk.length;
          total += chunk.length;
          if (total > 50 * 1024 * 1024 || actual > expected)
            throw new Error('Unsafe workbook expansion');
        }
      } finally {
        stream.destroy();
      }
    } else throw new Error('Unsupported ZIP compression');
    if (actual !== expected || total > 50 * 1024 * 1024)
      throw new Error('Invalid or oversized workbook expansion');
    position +=
      46 +
      buffer.readUInt16LE(position + 28) +
      buffer.readUInt16LE(position + 30) +
      buffer.readUInt16LE(position + 32);
  }
}
export async function reportWorkbook(headers: string[], rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Report');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row as any[]);
  sheet.columns.forEach((c) => {
    c.width = 30;
    c.numFmt = '@';
  });
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}
