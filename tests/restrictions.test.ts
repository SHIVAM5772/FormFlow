import { beforeAll, afterAll, it, expect } from 'vitest';
import type { Browser } from 'playwright';
import { openBrowser } from '../packages/form-analyzer/src/security.js';
import { readPublic, restrictions } from '../packages/form-analyzer/src/index.js';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
});
afterAll(async () => {
  await browser?.close();
});
const url = 'https://docs.google.com/forms/d/e/test/viewform';
const metadata = [
  null,
  [
    'Description',
    [[123, 'Name', null, 0, [[456, null, 1]]]],
    null,
    null,
    null,
    null,
    null,
    null,
    'Contact information',
  ],
];

it('previews delivered metadata while preserving a real sign-in blocker', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<title>Contact information</title><h1>Contact information</h1><dialog open>Sign in to continue. To fill out this form, you must be signed in.</dialog><script>window.FB_PUBLIC_LOAD_DATA_=${JSON.stringify(metadata)}</script>`,
    );
    const form = await readPublic(page, url);
    expect(form.title).toBe('Contact information');
    expect(form.questions).toHaveLength(1);
    expect(form.capabilities.loginRequired).toBe(true);
    expect(form.blockers.some((reason) => reason.includes('requires respondents to sign in'))).toBe(
      true,
    );
    expect(form.blockers).not.toContain('loginRequired');
  } finally {
    await page.close();
  }
});
it('does not treat an optional save-progress notice as mandatory sign-in', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<p>Sign in to Google to save your progress.</p><input aria-label="Name"><script>window.FB_PUBLIC_LOAD_DATA_=${JSON.stringify(metadata)}</script>`,
    );
    const form = await readPublic(page, url);
    expect(form.capabilities.loginRequired).toBe(false);
    expect(form.questions).toHaveLength(1);
    expect(form.blockers).toEqual([]);
  } finally {
    await page.close();
  }
});
it('keeps restricted forms blocked when no metadata is accessible', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<title>Restricted form</title><p>Sign in to continue</p>');
    const form = await readPublic(page, url);
    expect(form.title).toBe('Restricted form');
    expect(form.questions).toEqual([]);
    expect(form.capabilities.loginRequired).toBe(true);
    expect(form.blockers.length).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});
it('still fails unknown unrestricted layouts instead of inventing questions', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<h1>Unknown form layout</h1>');
    expect((await restrictions(page)).loginRequired).toBe(false);
    await expect(readPublic(page, url)).rejects.toThrow('metadata');
  } finally {
    await page.close();
  }
});
