import { describe, it, expect } from 'vitest';
import { validateFormUrl, isPublicAddress } from '../packages/form-analyzer/src/security.js';
import { encrypt, decrypt } from '../packages/database/src/index.js';
describe('Google URL boundary', () => {
  it.each([
    'https://docs.google.com/forms/d/e/abc/viewform',
    'https://forms.gle/abc',
    'https://docs.google.com/forms/d/abc/edit?usp=sharing',
  ])('accepts %s', (url) => expect(validateFormUrl(url).protocol).toBe('https:'));
  it.each([
    'http://docs.google.com/forms/d/e/a/viewform',
    'https://docs.google.com.evil.test/forms/d/e/a/viewform',
    'https://user@docs.google.com/forms/d/a/edit',
    'https://127.0.0.1/form',
    'https://docs.google.com:444/forms/d/a/edit',
    'https://forms.gle/a?redirect=http://localhost',
    'file:///etc/passwd',
    'https://docs.google.com/forms/d/a/viewform?entry.12=hello',
    'https://docs.google.com/forms/d/a/viewform?edit2=token',
  ])('rejects %s', (url) => expect(() => validateFormUrl(url)).toThrow());
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.2',
    '172.16.0.2',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])('rejects internal destination %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it('accepts a public IPv4', () => expect(isPublicAddress('8.8.8.8')).toBe(true));
});
describe('data encryption', () => {
  it('round trips with randomized authenticated ciphertext', () => {
    process.env.DATA_KEY = 'a'.repeat(64);
    const a = encrypt({ phone: '00123' });
    expect(a).not.toContain('00123');
    expect(encrypt({ phone: '00123' })).not.toBe(a);
    expect(decrypt(a)).toEqual({ phone: '00123' });
    const parts = a.split('.');
    parts[1] = Buffer.alloc(16).toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});
