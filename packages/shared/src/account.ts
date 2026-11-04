import { z } from 'zod';

export const genderOptions = [
  'Male',
  'Female',
  'Other',
] as const;

export const signupProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  phoneNumber: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 ()-]+$/, 'Enter a valid phone number')
    .transform((value) => value.replace(/[ ()-]/g, ''))
    .refine(
      (value) => /^\+?\d{7,15}$/.test(value),
      'Use 7 to 15 digits, including the country code',
    ),
  address: z.string().trim().min(5, 'Enter your address').max(500),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Select your date of birth')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return (
        !value.startsWith('0000') &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value &&
        date <= new Date()
      );
    }, 'Enter a valid date of birth that is not in the future'),
  gender: z.enum(genderOptions, { error: 'Select your gender' }),
});
