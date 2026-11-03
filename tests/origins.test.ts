import { expect, it } from 'vitest';
import { allowedOrigins, socketOriginAllowed } from '../apps/api/src/origins.js';

it('accepts both local frontend addresses in development', () => {
  for (const configured of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    expect(allowedOrigins(configured, 'development')).toEqual(
      new Set(['http://localhost:5173', 'http://127.0.0.1:5173']),
    );
  }
});
it('keeps other ports, schemes and hosts rejected', () => {
  const origins = allowedOrigins('http://localhost:5173', 'development');
  for (const origin of [
    'http://localhost:5174',
    'http://127.0.0.1:4000',
    'https://localhost:5173',
    'http://localhost.evil.test:5173',
    'null',
    '',
  ]) {
    expect(origins.has(origin)).toBe(false);
  }
});
it.each(['production', 'test'])('keeps %s restricted to the configured origin', (mode) => {
  expect(allowedOrigins('https://localhost:5173', mode)).toEqual(
    new Set(['https://localhost:5173']),
  );
});
it('does not add local aliases to a remote development origin', () => {
  expect(allowedOrigins('https://forms.example.com', 'development')).toEqual(
    new Set(['https://forms.example.com']),
  );
});
it('allows same-origin browser polling without relaxing cross-origin socket checks', () => {
  const origins = new Set(['http://localhost:3000']);
  expect(socketOriginAllowed(undefined, 'same-origin', origins)).toBe(true);
  expect(socketOriginAllowed(undefined, 'cross-site', origins)).toBe(false);
  expect(socketOriginAllowed(undefined, undefined, origins)).toBe(false);
  expect(socketOriginAllowed('https://evil.test', 'same-origin', origins)).toBe(false);
  expect(socketOriginAllowed('http://localhost:3000', undefined, origins)).toBe(true);
});
