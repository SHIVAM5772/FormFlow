import type { Page } from 'playwright';
import { validateFormUrl, openBrowser, secureContext } from './security.js';
import { emptyForm, finishForm, normalizeGoogleApi, normalizePublic } from './normalize.js';
import { restrictionMessage, type FormDefinition } from '../../shared/src/index.js';
export async function restrictions(page: Page) {
  const body = await page.locator('body').innerText();
  return {
    loginRequired:
      page.url().includes('accounts.google.com') ||
      /sign in to continue|you need permission|sign in to fill out/i.test(body),
    closed: /no longer accepting responses|not accepting responses|form has been deleted/i.test(
      body,
    ),
    captcha:
      (await page.locator('iframe[src*="recaptcha"], [data-sitekey]').count()) > 0 ||
      /verify (?:that )?you are (?:a )?human/i.test(body),
    organizationRestricted: /only be viewed by users|within (?:the|your) organization/i.test(body),
  };
}
export async function readPublic(page: Page, url: string): Promise<FormDefinition> {
  const blocked = await restrictions(page);
  const data = await page.evaluate(() => (window as any).FB_PUBLIC_LOAD_DATA_);
  const hasRestrictions = Object.values(blocked).some(Boolean);
  let result: Omit<FormDefinition, 'fingerprint'>;
  try {
    // Read only metadata already delivered to the anonymous respondent page.
    // A question preview never removes the restriction on submitting responses.
    result = normalizePublic(data, url);
  } catch (error) {
    if (!hasRestrictions) throw error;
    result = emptyForm(url);
    result.title = (await page.title()) || result.title;
  }
  Object.assign(result.capabilities, blocked);
  result.blockers.push(
    ...Object.entries(blocked)
      .filter(([, value]) => value)
      .map(([key]) => restrictionMessage(key)),
  );
  if (hasRestrictions && result.questions.length) {
    result.warnings.push(
      'Questions can be previewed from public metadata, but respondent restrictions still block automated submission.',
    );
  }
  const text = await page.locator('body').innerText();
  if (/recorded when you|email.*will be recorded|collect.*email/i.test(text)) {
    result.capabilities.emailCollection = true;
    result.blockers.push('Automatic email collection requires manual identity review');
  }
  return finishForm(result);
}
export class FormAnalyzer {
  async analyze(input: string, accessToken?: string): Promise<FormDefinition> {
    const url = validateFormUrl(input);
    if (accessToken && url.hostname === 'docs.google.com' && !url.pathname.includes('/d/e/')) {
      const id = url.pathname.match(/\/d\/([^/]+)/)?.[1];
      const response = await fetch(`https://forms.googleapis.com/v1/forms/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error(
          `Google Forms API denied analysis (${response.status}). Check account ownership and API enablement.`,
        );
      const data: any = await response.json();
      const respondent = validateFormUrl(data.responderUri).href;
      return normalizeGoogleApi(data, respondent);
    }
    const browser = await openBrowser();
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
      await secureContext(context);
      const page = await context.newPage();
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(500);
      if (page.url().includes('accounts.google.com')) {
        const result = emptyForm(url.href);
        result.capabilities.loginRequired = true;
        result.blockers = [restrictionMessage('loginRequired')];
        return finishForm(result);
      }
      const resolved = validateFormUrl(page.url());
      if (resolved.hostname !== 'docs.google.com')
        throw new Error('Short link did not resolve to a Google Form');
      return await readPublic(page, resolved.href);
    } finally {
      await browser.close();
    }
  }
}
