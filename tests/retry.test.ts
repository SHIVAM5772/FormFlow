import { it, expect } from 'vitest';
import { safeToRetry, recordStates } from '../packages/shared/src/index.js';
it('never retries unknown, submitted or intent-bearing records', () => {
  for (const state of recordStates) {
    expect(safeToRetry(state, new Date())).toBe(false);
    if (state !== 'FAILED') expect(safeToRetry(state, null)).toBe(false);
  }
  expect(safeToRetry('FAILED', null)).toBe(true);
});
it('permits explicit retry of known pre-submit question-mapping failures only', () => {
  const error = 'Cannot reliably locate question: Name';
  expect(safeToRetry('NEEDS_MANUAL_ACTION', null, error)).toBe(true);
  expect(safeToRetry('NEEDS_MANUAL_ACTION', new Date(), error)).toBe(false);
  expect(safeToRetry('UNKNOWN', null, error)).toBe(false);
  expect(safeToRetry('SUBMITTED', null, error)).toBe(false);
  expect(safeToRetry('NEEDS_MANUAL_ACTION', null, 'CAPTCHA')).toBe(false);
});
