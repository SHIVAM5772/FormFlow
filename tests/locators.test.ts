import { beforeAll, afterAll, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { openBrowser } from '../packages/form-analyzer/src/security.js';
import { questionSchema } from '../packages/shared/src/index.js';
import { locateQuestion, questionIdentity } from '../packages/submission-engine/src/locators.js';
let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
});
afterAll(async () => {
  await browser?.close();
});
const q = questionSchema.parse({
  id: '123',
  title: 'Name',
  type: 'SHORT_TEXT',
  required: true,
  sectionId: 'section-1',
  entryIds: ['456'],
});
it.each(['', null])(
  'maps an untitled checkbox with metadata title=%s by question and entry IDs',
  async (title) => {
    const page = await browser.newPage();
    try {
      const untitled = { ...q, title: '', type: 'CHECKBOXES' as const, options: ['Option 1'] };
      const tuple = (id: number, entry: number) =>
        `%.@.${JSON.stringify([id, title, null, 4, [[entry]]])}`;
      await page.setContent(
        `<div role="listitem" data-params='${tuple(999, 888)}'><input type="checkbox" aria-label="Wrong"></div><div role="listitem" data-params='${tuple(123, 456)}'><input type="checkbox" aria-label="Option 1"></div>`,
      );
      const root = await locateQuestion(page, untitled);
      await root.getByRole('checkbox', { name: 'Option 1', exact: true }).check();
      expect(await root.getByRole('checkbox').isChecked()).toBe(true);
      expect(await page.getByRole('checkbox', { name: 'Wrong' }).isChecked()).toBe(false);
    } finally {
      await page.close();
    }
  },
);
it('does not map an untitled question from an empty heading without stable metadata', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="listitem"><div role="heading"></div><input></div>');
    await expect(locateQuestion(page, { ...q, title: '' })).rejects.toThrow(
      'Cannot reliably locate question: Untitled question (123)',
    );
  } finally {
    await page.close();
  }
});
it('parses known Google tuple encodings without evaluating expressions', () => {
  for (const raw of [
    '%.@.[123,"Name",null,0,[[456,null,true]]],"heading"]',
    '%.@.[[123,"Name",null,0,[[456,null,true]]],"heading"]',
  ])
    expect(questionIdentity(raw)).toEqual({ id: '123', title: 'Name', entryIds: ['456'] });
  expect(questionIdentity('%.@.alert(1)')).toBeUndefined();
  expect(questionIdentity('%.@.[123]')).toBeUndefined();
});
it('matches required headings whose accessible name includes Required question', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<div role="listitem"><div role="heading">Name<span aria-label="Required question"> *</span></div><input aria-label="Answer"></div>',
    );
    const root = await locateQuestion(page, q);
    await root.getByRole('textbox').fill('Local only');
    expect(await root.getByRole('textbox').inputValue()).toBe('Local only');
  } finally {
    await page.close();
  }
});
it('uses stable IDs to distinguish repeated question titles', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<div role="listitem"><div data-params='%.@.[999,"Name",null,0,[[888]]],"a"]'><div role="heading">Name</div><input aria-label="Wrong"></div></div><div role="listitem"><div data-params='%.@.[123,"Name",null,0,[[456]]],"b"]'><div role="heading">Name</div><input aria-label="Correct"></div></div>`,
    );
    expect(
      await (await locateQuestion(page, q)).getByRole('textbox', { name: 'Correct' }).count(),
    ).toBe(1);
  } finally {
    await page.close();
  }
});
it('refuses conflicting entry mappings rather than falling back to the same title', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<div role="listitem"><div data-params='%.@.[123,"Name",null,0,[[999]]],"a"]'><div role="heading">Name</div><input></div></div>`,
    );
    await expect(locateQuestion(page, q)).rejects.toThrow('Cannot reliably locate');
  } finally {
    await page.close();
  }
});
