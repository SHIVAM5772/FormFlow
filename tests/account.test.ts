import { expect, it } from 'vitest';
import { signupProfileSchema } from '../packages/shared/src/account.js';

const profile = {
  name: 'Test Person',
  phoneNumber: '+919876543210',
  address: '12 Test Street',
  dateOfBirth: '2000-02-29',
  gender: 'Other',
};
it.each(['2001-02-29', '2000-02-30', '2000-13-01', '0000-01-01', '2999-01-01'])(
  'rejects impossible or future dates of birth: %s',
  (dateOfBirth) => {
    expect(signupProfileSchema.safeParse({ ...profile, dateOfBirth }).success).toBe(false);
  },
);
it('normalizes profile whitespace and phone formatting while preserving the birth date', () => {
  expect(
    signupProfileSchema.parse({
      ...profile,
      name: '  Test Person  ',
      phoneNumber: '+91 (98765) 43210',
    }),
  ).toEqual(profile);
});
it.each([
  { phoneNumber: 'not-a-phone' },
  { phoneNumber: '123' },
  { gender: 'invalid' },
  { address: ' ' },
  { name: ' ' },
])('rejects invalid required profile details: %j', (invalid) => {
  expect(signupProfileSchema.safeParse({ ...profile, ...invalid }).success).toBe(false);
});
