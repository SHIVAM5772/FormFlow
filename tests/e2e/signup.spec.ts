import { test, expect, type Page } from '@playwright/test';

const profile = {
  name: 'Test Person',
  phoneNumber: '+919876543210',
  address: '12 Test Street, Delhi',
  dateOfBirth: '2000-02-29',
  gender: 'Other',
};
async function fillProfile(page: Page) {
  await page.getByLabel('Full name').fill(profile.name);
  await page.getByLabel('Phone number').fill('+91 98765 43210');
  await page.getByLabel('Address', { exact: true }).fill(profile.address);
  await page.getByLabel('Date of birth').fill(profile.dateOfBirth);
  await page.getByLabel('Gender', { exact: true }).selectOption(profile.gender);
}

test('opens signup from login, validates confirmation and signs a new user into their workspace', async ({
  page,
}) => {
  let signedIn = false;
  let submitted: unknown;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/signup') {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        json: {
          data: {
            email: 'new@example.com',
            verificationId: '550e8400-e29b-41d4-a716-446655440000',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            resendAfterSeconds: 60,
          },
        },
      });
    } else if (path === '/api/auth/signup/verify') {
      if (route.request().postDataJSON().code !== '123456') {
        await route.fulfill({
          status: 400,
          json: { error: { message: 'Incorrect or expired OTP.' } },
        });
      } else {
        signedIn = true;
        await route.fulfill({
          status: 201,
          json: { data: { id: 'new-user', email: 'new@example.com' } },
        });
      }
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
  await fillProfile(page);
  await page.getByLabel('Email address').fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByText('Passwords do not match', { exact: true })).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resend code/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/signup-otp-desktop.png', fullPage: true });
  await page.getByLabel('Email OTP').fill('000000');
  await page.getByRole('button', { name: 'Verify email & create account' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Incorrect or expired OTP' }),
  ).toBeVisible();
  await page.getByLabel('Email OTP').fill('123456');
  await page.getByRole('button', { name: 'Verify email & create account' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(submitted).toEqual({
    ...profile,
    email: 'new@example.com',
    password: 'new-user-password',
  });
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
  await fillProfile(page);
  await page.getByLabel('Email address').fill('existing@example.com');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await page.screenshot({ path: 'test-results/signup-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('resends an expired OTP on mobile and allows signup details to be corrected', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const oldId = '550e8400-e29b-41d4-a716-446655440000';
  const newId = '550e8400-e29b-41d4-a716-446655440001';
  let resent: unknown;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/signup' || path === '/api/auth/signup/resend') {
      const resend = path.endsWith('/resend');
      if (resend) resent = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        json: {
          data: {
            email: 'new@example.com',
            verificationId: resend ? newId : oldId,
            expiresAt: new Date(Date.now() + (resend ? 600000 : -1000)).toISOString(),
            resendAfterSeconds: resend ? 60 : 0,
          },
        },
      });
    } else
      await route.fulfill({ status: 401, json: { error: { message: 'Sign in to continue' } } });
  });
  await page.goto('/signup');
  await fillProfile(page);
  await page.getByLabel('Email address').fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByText('This code has expired.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify email & create account' })).toBeDisabled();
  await page.getByLabel('Email OTP').fill('000000');
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect(page.getByLabel('Email OTP')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Verify email & create account' })).toBeEnabled();
  expect(resent).toEqual({ email: 'new@example.com', verificationId: oldId });
  await page.screenshot({ path: 'test-results/signup-otp-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Change signup details' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue(profile.name);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});
