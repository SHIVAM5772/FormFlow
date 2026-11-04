import { test, expect } from '@playwright/test';

test('opens signup from login, validates confirmation and signs a new user into their workspace', async ({
  page,
}) => {
  let signedIn = false;
  let submitted: unknown;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/signup') {
      submitted = route.request().postDataJSON();
      signedIn = true;
      await route.fulfill({
        status: 201,
        json: { data: { id: 'new-user', email: 'new@example.com' } },
      });
    } else if (path === '/api/auth/me') {
      await route.fulfill(
        signedIn
          ? { json: { data: { id: 'new-user', email: 'new@example.com' } } }
          : { status: 401, json: { error: { message: 'Sign in to continue' } } },
      );
    } else await route.fulfill({ json: { data: path === '/api/dashboard/stats' ? {} : [] } });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.screenshot({ path: 'test-results/signup-desktop.png', fullPage: true });
  await page.getByLabel('Email address').fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Passwords do not match', { exact: true })).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(submitted).toEqual({ email: 'new@example.com', password: 'new-user-password' });
});

test('shows duplicate email feedback and provides a link back to sign in on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async (route) => {
    await route.fulfill(
      new URL(route.request().url()).pathname === '/api/auth/signup'
        ? {
            status: 409,
            json: {
              error: {
                code: 'EMAIL_EXISTS',
                message: 'An account with this email already exists. Please sign in.',
              },
            },
          }
        : { status: 401, json: { error: { message: 'Sign in to continue' } } },
    );
  });
  await page.goto('/signup');
  await page.getByLabel('Email address').fill('existing@example.com');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await page.screenshot({ path: 'test-results/signup-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
