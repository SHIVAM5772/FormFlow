import { test, expect } from '@playwright/test';

test('native App Router pages support direct loading and refresh without browser errors', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data =
      pathname === '/api/auth/me'
        ? { id: 'test-user', email: 'tester@example.com' }
        : pathname === '/api/settings'
          ? { maxRows: 2000, maxUploadMB: 10, retentionDays: 30 }
          : pathname === '/api/google/status'
            ? { enabled: false, connected: false }
            : [];
    await route.fulfill({ json: { data } });
  });
  for (const [pathname, title] of [
    ['/forms', 'My Forms'],
    ['/templates', 'Excel Templates'],
    ['/jobs', 'Submission Jobs'],
    ['/history', 'Submission History'],
    ['/reports', 'Reports'],
    ['/settings', 'Settings'],
  ]) {
    expect((await page.goto(pathname))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('shows paused manual-action rows as attention with zero verified progress and explicit row retries', async ({
  page,
}) => {
  const jobId = '9926ad27-2a8b-487a-adf1-010723b037a3';
  const rows = [2, 3, 4, 5, 6].map((rowNumber) => ({
    id: `row-${rowNumber}`,
    rowNumber,
    status: 'NEEDS_MANUAL_ACTION',
    submitIntentAt: null,
    submittedAt: null,
    attemptCount: 1,
    error: 'Cannot reliably locate question: Name',
  }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/auth/me'
        ? { id: 'test-user', email: 'tester@example.com' }
        : path.endsWith('/records')
          ? rows
          : path === `/api/submissions/${jobId}`
            ? {
                id: jobId,
                title: 'Contact information',
                status: 'PAUSED',
                reason: 'Cannot reliably locate question: Name',
                createdAt: new Date().toISOString(),
                counts: { NEEDS_MANUAL_ACTION: 5 },
              }
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0');
  await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
  await expect(page.getByText(/0 of 5 responses verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume remaining rows' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry this unsubmitted row' })).toHaveCount(5);
});

test('shows form access restrictions before batch authorization even when all rows validate', async ({
  page,
}) => {
  const templateId = '7926ad27-2a8b-487a-adf1-010723b037a3';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/auth/me'
        ? { id: 'test-user', email: 'tester@example.com' }
        : path === '/api/templates'
          ? [
              {
                id: templateId,
                schema: { version: 1, form: { id: 'form-id', title: 'Restricted form' } },
              },
            ]
          : path === '/api/uploads/validate'
            ? {
                id: 'upload-id',
                total: 5,
                valid: 5,
                invalid: 0,
                formId: 'form-id',
                formBlockers: ['This Google Form requires respondents to sign in to Google.'],
                rows: [2, 3, 4, 5, 6].map((rowNumber) => ({
                  rowNumber,
                  errors: [],
                  duplicate: false,
                })),
              }
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/upload?template=${templateId}`);
  await page.getByLabel('Excel file', { exact: true }).setInputFiles({
    name: 'responses.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('Isolated upload UI contract fixture'),
  });
  await page.getByRole('button', { name: 'Validate responses', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'submission restrictions' }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /I have permission/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit 5 rows', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Review form access and reanalyze' })).toBeVisible();
});

test('explains restricted forms and refreshes their question preview without allowing submission', async ({
  page,
}) => {
  const id = '7926ad27-2a8b-487a-adf1-010723b037a3';
  let analyzed = false;
  const definition = {
    title: 'Google Form',
    description: '',
    source: 'PUBLIC',
    sourceUrl: 'https://docs.google.com/forms/d/e/test/viewform',
    questions: [] as any[],
    sections: [{ id: 'section-1', title: 'Start' }],
    blockers: ['loginRequired'],
    warnings: [],
    fingerprint: 'test',
    capabilities: {
      loginRequired: true,
      closed: false,
      captcha: false,
      emailCollection: false,
      fileUpload: false,
      organizationRestricted: false,
      responseEditing: null,
    },
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/forms/analyze') analyzed = true;
    const current = analyzed
      ? {
          ...definition,
          title: 'Contact information',
          questions: [
            {
              id: 'name',
              title: 'Full name',
              type: 'SHORT_TEXT',
              required: true,
              sectionId: 'section-1',
              options: [],
              rows: [],
              other: false,
              entryIds: [],
            },
          ],
        }
      : definition;
    const stored = {
      id,
      title: current.title,
      sourceUrl: current.sourceUrl,
      createdAt: new Date().toISOString(),
      schemas: [{ version: analyzed ? 2 : 1, definition: current }],
    };
    await route.fulfill({
      json: {
        data:
          path === '/api/auth/me'
            ? { id: 'test-user', email: 'tester@example.com' }
            : path === `/api/forms/${id}` || path === '/api/forms/analyze'
              ? stored
              : [],
      },
    });
  });
  await page.goto(`/forms/${id}`);
  await expect(
    page.getByText('This Google Form requires respondents to sign in to Google.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('loginRequired', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Excel template' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reanalyze form' }).click();
  await expect(page.getByRole('heading', { name: 'Contact information' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Full name' })).toBeVisible();
  await expect(
    page.getByText('Manual action required — automated submission is blocked.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Excel template' })).toBeEnabled();
});
test('shows the real sign-in shell and responsive accessible controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter your password')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('renders the dashboard, changes theme and navigates on mobile (isolated API contract)', async ({
  page,
}) => {
  // Contract fixtures are confined to this UI test; the shipped application always calls the real API.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/auth/me'
        ? { id: 'test-account', email: 'tester@example.com' }
        : path === '/api/dashboard/stats'
          ? { forms: 0, processed: 0, submitted: 0, failed: 0, unknown: 0, activeJobs: 0 }
          : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep your responses flowing.' })).toBeVisible();
  await expect(page.getByText('A fresh start for your forms')).toBeVisible();
  await page.getByRole('button', { name: 'Use dark mode' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('button', { name: 'Use light mode' }).click();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Analyze Form', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start with a Google Form.' })).toBeVisible();
  await expect(page.getByLabel('Google Form URL')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
