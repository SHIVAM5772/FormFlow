import type { Locator, Page } from 'playwright';
import { openBrowser, secureContext, validateFormUrl } from '../../form-analyzer/src/security.js';
import { readPublic, restrictions } from '../../form-analyzer/src/index.js';
import {
  activeSections,
  fieldKey,
  type Answers,
  type FormDefinition,
  type Question,
  type RecordState,
} from '../../shared/src/index.js';
import { validateAnswers } from '../../excel-engine/src/index.js';
import { locateQuestion, ManualAction } from './locators.js';
export { ManualAction } from './locators.js';

export type SubmissionResult = { status: RecordState; error?: string; submittedAt?: Date };
export type SubmissionHooks = {
  beforeSubmit: () => Promise<boolean>;
  isStopped: () => Promise<boolean>;
};
async function select(root: Locator, role: 'radio' | 'checkbox', value: string) {
  const item = root.getByRole(role, { name: value, exact: true });
  if ((await item.count()) !== 1)
    throw new ManualAction('Answer option could not be mapped reliably');
  await item.click();
}
async function fillQuestion(page: Page, q: Question, answers: Answers, fixture = false) {
  const values = q.rows.length
    ? q.rows.map((row) => answers[fieldKey(q, row)] ?? '')
    : [answers[q.id] ?? ''];
  if (!values.some(Boolean)) return;
  const root = await locateQuestion(page, q, fixture);
  const value = values[0];
  if (q.type === 'SHORT_TEXT' || q.type === 'PARAGRAPH') {
    await root.getByRole('textbox').fill(value);
    return;
  }
  if (q.type === 'DROPDOWN') {
    if (await root.locator('select').count()) {
      await root.locator('select').selectOption({ label: value });
      return;
    }
    await root.getByRole('listbox').click();
    await root.getByRole('option', { name: value, exact: true }).click();
    return;
  }
  if (['MULTIPLE_CHOICE', 'LINEAR_SCALE', 'CHECKBOXES'].includes(q.type)) {
    const role = q.type === 'CHECKBOXES' ? 'checkbox' : 'radio';
    for (const choice of q.type === 'CHECKBOXES'
      ? value.split(';').map((s) => s.trim())
      : [value]) {
      if (q.other && choice.startsWith('Other: ')) {
        await root.getByRole(role, { name: /^other(?::|\s|$)/i }).click();
        await root.getByRole('textbox').fill(choice.slice(7));
      } else await select(root, role, choice);
    }
    return;
  }
  if (q.type.includes('GRID')) {
    for (let i = 0; i < q.rows.length; i++) {
      if (!values[i]) continue;
      const row = root
        .getByRole('radiogroup', { name: q.rows[i], exact: true })
        .or(root.getByRole('row').filter({ hasText: q.rows[i] }));
      if ((await row.count()) !== 1)
        throw new ManualAction(`Cannot reliably map grid row: ${q.rows[i]}`);
      for (const option of q.type === 'CHECKBOX_GRID'
        ? values[i].split(';').map((s) => s.trim())
        : [values[i]])
        await select(row, q.type === 'CHECKBOX_GRID' ? 'checkbox' : 'radio', option);
    }
    return;
  }
  if (q.type === 'DATE') {
    const native = root.locator('input[type="date"]');
    if (await native.count()) {
      await native.fill(value);
      return;
    }
    const [year, month, day] = value.split('-');
    await root.getByRole('spinbutton', { name: 'Month', exact: true }).fill(String(Number(month)));
    await root.getByRole('spinbutton', { name: 'Day', exact: true }).fill(String(Number(day)));
    await root.getByRole('spinbutton', { name: 'Year', exact: true }).fill(year);
    return;
  }
  if (q.type === 'TIME') {
    const native = root.locator('input[type="time"]');
    if (await native.count()) {
      await native.fill(value);
      return;
    }
    const [hour, minute] = value.split(':');
    const period = root.getByRole('listbox');
    const hasPeriod = (await period.count()) > 0;
    await root
      .getByRole('spinbutton', { name: 'Hour', exact: true })
      .fill(String(hasPeriod ? Number(hour) % 12 || 12 : Number(hour)));
    await root
      .getByRole('spinbutton', { name: 'Minute', exact: true })
      .fill(String(Number(minute)));
    if (hasPeriod) {
      await period.click();
      await root
        .getByRole('option', { name: Number(hour) >= 12 ? 'PM' : 'AM', exact: true })
        .click();
    }
    return;
  }
  throw new ManualAction(`Unsupported question: ${q.title}`);
}
async function run(
  form: FormDefinition,
  answers: Answers,
  hooks: SubmissionHooks,
  fixtureOrigin?: string,
): Promise<SubmissionResult> {
  let intent = false;
  let verificationStage = 'BEFORE_SUBMIT';
  let responseStatus: number | undefined;
  let expectedConfirmation = form.confirmationMessage;
  let browser;
  try {
    if (!fixtureOrigin) validateFormUrl(form.sourceUrl);
    if (form.blockers.length) throw new ManualAction(form.blockers.join('; '));
    const errors = validateAnswers(form, answers);
    if (errors.length) return { status: 'FAILED', error: errors.join('; ') };
    browser = await openBrowser();
    const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
    await secureContext(context, fixtureOrigin);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(form.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!fixtureOrigin && form.source === 'PUBLIC') {
      const live = await readPublic(page, form.sourceUrl);
      if (live.fingerprint !== form.fingerprint)
        throw new ManualAction('Form schema changed. Analyze again and download a new template.');
      if (live.blockers.length) throw new ManualAction(live.blockers.join('; '));
      expectedConfirmation = live.confirmationMessage;
    } else if (!fixtureOrigin && !expectedConfirmation) {
      // Owner API schemas may not expose confirmation settings. Read only metadata
      // already delivered to the anonymous page, before typing any answers.
      expectedConfirmation = await page.evaluate(() => {
        const value = (window as any).FB_PUBLIC_LOAD_DATA_?.[1]?.[2]?.[0];
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
      });
    }
    const active = activeSections(form, answers);
    const filled = new Set<string>();
    for (let step = 0; step < Math.max(1, form.sections.length) + 1; step++) {
      const restricted = await restrictions(page);
      if (Object.values(restricted).some(Boolean))
        throw new ManualAction(
          `Respondent restriction: ${Object.entries(restricted)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(', ')}`,
        );
      if (await hooks.isStopped()) return { status: 'QUEUED' };
      let visibleSection: string | undefined;
      for (const section of form.sections) {
        const candidates = form.questions.filter((q) => q.sectionId === section.id);
        for (const q of candidates) {
          try {
            const root = await locateQuestion(page, q, !!fixtureOrigin);
            if (await root.isVisible()) {
              visibleSection = section.id;
              break;
            }
          } catch {
            /* Sections not on this page are expected. */
          }
        }
        if (visibleSection) break;
      }
      if (!visibleSection || !active.has(visibleSection) || filled.has(visibleSection))
        throw new ManualAction('Unexpected or unrecognized section navigation');
      for (const q of form.questions.filter((q) => q.sectionId === visibleSection))
        await fillQuestion(page, q, answers, !!fixtureOrigin);
      filled.add(visibleSection);
      const submit = page.getByRole('button', { name: 'Submit', exact: true });
      if (await submit.isVisible().catch(() => false)) {
        if (
          [...active].some(
            (id) => !filled.has(id) && form.questions.some((q) => q.sectionId === id),
          )
        )
          throw new ManualAction('Form ended before all expected sections');
        if (await hooks.isStopped()) return { status: 'QUEUED' };
        if (!(await hooks.beforeSubmit())) return { status: 'QUEUED' };
        intent = true; // A crash or timeout after this point must never trigger an automatic retry.
        verificationStage = 'WAITING_FOR_FORM_REPLY';
        const accepted = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            (fixtureOrigin
              ? new URL(response.url()).pathname === '/submit'
              : new URL(response.url()).hostname === 'docs.google.com' &&
                new URL(response.url()).pathname.endsWith('/formResponse')),
          { timeout: 15000 },
        );
        const [reply] = await Promise.all([accepted, submit.click()]);
        responseStatus = reply.status();
        if (responseStatus < 200 || responseStatus >= 400)
          throw new Error('Form reply was not successful');
        verificationStage = 'WAITING_FOR_CONFIRMATION';
        const confirmation = expectedConfirmation
          ? page.getByText(expectedConfirmation, { exact: true })
          : page.getByText(
              /^(?:your response has been recorded\.?|response submitted successfully\.?)$/i,
            );
        await confirmation.waitFor({ state: 'visible', timeout: 15000 });
        verificationStage = 'CHECKING_FINISHED_PAGE';
        if (
          await page
            .getByRole('button', { name: 'Submit', exact: true })
            .isVisible()
            .catch(() => false)
        )
          return {
            status: 'UNKNOWN',
            error: 'Submit remained visible; a saved response could not be verified.',
          };
        return { status: 'SUBMITTED', submittedAt: new Date() };
      }
      if (
        form.questions.some(
          (q) => q.sectionId === visibleSection && q.branches?.[answers[q.id]] === 'SUBMIT',
        )
      )
        throw new ManualAction(
          'This branch submits through section navigation; an explicit Submit button is required for safe automation.',
        );
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForTimeout(300);
    }
    throw new ManualAction('Section navigation exceeded the analyzed form');
  } catch (error) {
    return {
      status: intent ? 'UNKNOWN' : error instanceof ManualAction ? 'NEEDS_MANUAL_ACTION' : 'FAILED',
      error: intent
        ? `Submission confirmation was not verified (${verificationStage}${responseStatus === undefined ? '' : `; HTTP ${responseStatus}`}). Check the form owner’s responses before taking further action.`
        : error instanceof ManualAction
          ? error.message
          : 'Browser could not complete this row before Submit. Check form availability and supported controls.',
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
export function submitResponse(form: FormDefinition, answers: Answers, hooks: SubmissionHooks) {
  return run(form, answers, hooks);
}
// This adapter is imported only by tests, never exposed by the API. Exact loopback origin is required.
export function submitLocalFixture(form: FormDefinition, answers: Answers, hooks: SubmissionHooks) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Fixture adapter only available in test mode');
  const url = new URL(form.sourceUrl);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
    throw new Error('Fixture must use loopback HTTP');
  return run(form, answers, hooks, url.origin);
}
