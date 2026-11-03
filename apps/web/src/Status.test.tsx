// @vitest-environment jsdom
import React from 'react';
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Status } from './App';
it('renders unverified states distinctly from successful submission', () => {
  render(
    <>
      <Status value="UNKNOWN" />
      <Status value="SUBMITTED" />
      <Status value="NEEDS_MANUAL_ACTION" />
    </>,
  );
  expect(screen.getByText('UNKNOWN')).toHaveClass('unknown');
  expect(screen.getByText('SUBMITTED')).toHaveClass('submitted');
  expect(screen.getByText('NEEDS MANUAL ACTION')).toBeVisible();
});
