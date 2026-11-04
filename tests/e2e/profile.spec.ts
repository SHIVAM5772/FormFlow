import { expect, test } from '@playwright/test';

const initial = {
  id: 'profile-user',
  email: 'old@example.com',
  name: 'Test Person',
  phoneNumber: '+919876543210',
  address: '12 Example Street',
  dateOfBirth: '2000-02-29',
  gender: 'Other',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  pendingEmailChange: null,
};

for (const viewport of [
  { width: 1280, height: 500 },
  { width: 390, height: 600 },
]) {
  test(`scrolls only sidebar links and keeps account access fixed at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {
          data:
            new URL(route.request().url()).pathname === '/api/auth/me'
              ? { id: initial.id, email: initial.email }
              : [],
        },
      }),
    );
    await page.goto('/forms');
    await expect(page.getByRole('heading', { name: 'My Forms', exact: true })).toBeVisible();
    if (viewport.width < 651) await page.getByRole('button', { name: 'Open navigation' }).click();
    const sidebar = page.locator('.sidebar');
    if (viewport.width < 651)
      await expect(sidebar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    const links = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(links.getByRole('link', { name: 'View Profile', exact: true })).toHaveCount(0);
    const fixed = [
      page.locator('.sidebar .brand'),
      page.locator('.workspace-label'),
      page.locator('.sidebar-note'),
      page.locator('.sidebar .profile'),
    ];
    const before = await Promise.all(fixed.map((item) => item.boundingBox()));
    expect((await sidebar.boundingBox())!.width).toBeCloseTo(270, 2);
    await links.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => links.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(links.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport();
    expect(await Promise.all(fixed.map((item) => item.boundingBox()))).toEqual(before);
    expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByRole('button', { name: initial.email, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'View profile', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/sidebar-scroll-${viewport.width}.png` });
  });
}

for (const viewport of [
  { width: 1280, height: 650 },
  { width: 390, height: 844 },
]) {
  test(`opens view profile from the email menu and keeps the top bar visible at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const data =
        path === '/api/auth/me'
          ? { id: initial.id, email: initial.email }
          : path === '/api/profile'
            ? initial
            : path === '/api/audit'
              ? [
                  {
                    id: 'event-one',
                    action: 'PROFILE_UPDATED',
                    createdAt: '2026-11-04T12:00:00.000Z',
                  },
                ]
              : [];
      return route.fulfill({ json: { data } });
    });
    await page.goto('/forms');
    await expect(page.getByRole('heading', { name: 'My Forms', exact: true })).toBeVisible();
    if (viewport.width < 651) await page.getByRole('button', { name: 'Open navigation' }).click();
    const account = page.getByRole('button', { name: initial.email, exact: true });
    await account.click();
    await expect(page.getByRole('menu', { name: 'Account options' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'View profile' }).press('Escape');
    await expect(account).toBeFocused();
    await expect(page.getByRole('menu', { name: 'Account options' })).toHaveCount(0);
    await account.click();
    await page.getByRole('menuitem', { name: 'View profile' }).click();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    await expect(page.getByLabel('Full name')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: initial.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toBeVisible();
    await expect(page.getByText('Profile updated', { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const header = await page.locator('.topbar').boundingBox();
    expect(header?.y).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/profile-overview-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
    await expect(page.getByLabel('Full name')).toHaveValue(initial.name);
    await expect(page.getByLabel('Phone number')).toHaveValue(initial.phoneNumber);
    await expect(page.getByLabel('Date of birth')).toHaveValue(initial.dateOfBirth);
    await expect(page.getByLabel('Address', { exact: true })).toHaveValue(initial.address);
    await expect(page.getByLabel('Gender', { exact: true })).toHaveValue(initial.gender);
    await page.getByLabel('Full name').fill('Unsaved name');
    await page.getByRole('button', { name: 'Back to profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: initial.name, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
  });
}
test('updates personal details and changes email only after OTP, preserving verification across refresh', async ({
  page,
}) => {
  let profile: any = structuredClone(initial);
  let saved: any;
  const verificationId = '550e8400-e29b-41d4-a716-446655440000';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me')
      return route.fulfill({ json: { data: { id: profile.id, email: profile.email } } });
    if (path === '/api/profile' && route.request().method() === 'PATCH') {
      saved = route.request().postDataJSON();
      profile = { ...profile, ...saved };
      return route.fulfill({ json: { data: profile } });
    }
    if (path === '/api/profile') return route.fulfill({ json: { data: profile } });
    if (path === '/api/profile/email-change') {
      profile.pendingEmailChange = {
        email: route.request().postDataJSON().email,
        verificationId,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        resendAfterSeconds: 60,
      };
      return route.fulfill({ status: 202, json: { data: profile.pendingEmailChange } });
    }
    if (path === '/api/profile/email-change/verify') {
      const body = route.request().postDataJSON();
      if (body.code !== '123456')
        return route.fulfill({
          status: 400,
          json: { error: { message: 'Incorrect or expired OTP.' } },
        });
      expect(body.verificationId).toBe(verificationId);
      profile = { ...profile, email: profile.pendingEmailChange.email, pendingEmailChange: null };
      return route.fulfill({ json: { data: profile } });
    }
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  await expect(page.getByLabel('Full name')).toHaveValue(initial.name);
  await page.getByLabel('Full name').fill('Updated Person');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile updated successfully.')).toBeVisible();
  expect(saved).toEqual({
    name: 'Updated Person',
    phoneNumber: initial.phoneNumber,
    address: initial.address,
    dateOfBirth: initial.dateOfBirth,
    gender: initial.gender,
  });
  await page.getByLabel('New email address').fill('new@example.com');
  await page.getByRole('button', { name: 'Send email verification code', exact: true }).click();
  await expect(page.locator('.current-email strong')).toHaveText(initial.email);
  await expect(page.getByRole('button', { name: /Resend code/ })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  await page.getByLabel('Email OTP').fill('000000');
  await page.getByRole('button', { name: 'Verify & update email', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Incorrect or expired OTP' }),
  ).toBeVisible();
  await expect(page.locator('.current-email strong')).toHaveText(initial.email);
  await page.getByLabel('Email OTP').fill('123456');
  await page.getByRole('button', { name: 'Verify & update email', exact: true }).click();
  await expect(page.getByText('Email updated and verified successfully.')).toBeVisible();
  await expect(page.locator('.current-email strong')).toHaveText('new@example.com');
  await expect(page.locator('.profile-email')).toHaveText('new@example.com');
  await expect(page.getByLabel('Full name')).toHaveValue('Updated Person');
  await page.screenshot({ path: 'test-results/profile-desktop.png', fullPage: true });
});

test('handles expired OTP, resend, cancellation and duplicate email on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let pending: any = null;
  let resent = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me')
      return route.fulfill({ json: { data: { id: initial.id, email: initial.email } } });
    if (path === '/api/profile') return route.fulfill({ json: { data: initial } });
    if (path === '/api/profile/email-change' && route.request().method() === 'DELETE') {
      pending = null;
      return route.fulfill({ json: { data: { cancelled: true } } });
    }
    if (
      path === '/api/profile/email-change' &&
      route.request().postDataJSON().email === 'used@example.com'
    )
      return route.fulfill({
        status: 409,
        json: { error: { message: 'This email address is already used by another account.' } },
      });
    if (path === '/api/profile/email-change' || path.endsWith('/resend')) {
      const resend = path.endsWith('/resend');
      if (resend) {
        resent = true;
        expect(route.request().postDataJSON().verificationId).toBe(pending.verificationId);
      }
      pending = {
        email: 'new@example.com',
        verificationId: resend
          ? '550e8400-e29b-41d4-a716-446655440001'
          : '550e8400-e29b-41d4-a716-446655440000',
        expiresAt: new Date(Date.now() + (resend ? 600000 : -1000)).toISOString(),
        resendAfterSeconds: resend ? 60 : 0,
      };
      return route.fulfill({ status: 202, json: { data: pending } });
    }
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  await page.getByLabel('New email address').fill('used@example.com');
  await page.getByRole('button', { name: 'Send email verification code', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already used' })).toBeVisible();
  await page.getByLabel('New email address').fill('new@example.com');
  await page.getByRole('button', { name: 'Send email verification code', exact: true }).click();
  await expect(page.getByText('This code has expired. Request a new code.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Verify & update email', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect.poll(() => resent).toBe(true);
  await page.getByLabel('Email OTP').fill('123456');
  await expect(
    page.getByRole('button', { name: 'Verify & update email', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: 'test-results/profile-email-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
  await page.getByRole('button', { name: 'Cancel email change', exact: true }).click();
  await expect(page.getByLabel('New email address')).toBeVisible();
  await expect(page.locator('.current-email strong')).toHaveText(initial.email);
});
