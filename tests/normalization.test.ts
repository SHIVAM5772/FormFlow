import { it, expect } from 'vitest';
import { normalizePublic, normalizeGoogleApi } from '../packages/form-analyzer/src/normalize.js';
import { activeSections } from '../packages/shared/src/index.js';

function emailMetadata(rules: unknown) {
  return [
    null,
    [
      'Description',
      [[123, 'Email', null, 0, [[456, null, 1, null, rules]]]],
      null,
      null,
      null,
      null,
      null,
      null,
      'Contact',
    ],
  ];
}
it('extracts the custom confirmation text from public settings', () => {
  const data = emailMetadata(null) as any;
  data[1][2] = ['Thanks for submitting your contact info!', 0, 0, 1, 0];
  const form = normalizePublic(data, 'https://docs.google.com/forms/d/e/a/viewform');
  expect(form.confirmationMessage).toBe('Thanks for submitting your contact info!');
});
it('recognizes the standard Google Email validation rule instead of blocking it', () => {
  const form = normalizePublic(
    emailMetadata([[2, 102, null, 'Please enter a valid email address']]),
    'https://docs.google.com/forms/d/e/a/viewform',
  );
  expect(form.questions[0].validation).toEqual({ kind: 'EMAIL' });
  expect(form.blockers).toEqual([]);
});
it('keeps unknown or combined validation rules blocked', () => {
  for (const rules of [
    [[2, 100, ['company.example']]],
    [
      [2, 102],
      [4, 301, ['.*']],
    ],
    [[2, 102, ['unexpected argument']]],
  ]) {
    const form = normalizePublic(
      emailMetadata(rules),
      'https://docs.google.com/forms/d/e/a/viewform',
    );
    expect(form.questions[0].validation).toBeUndefined();
    expect(form.blockers.join()).toContain('Custom response validation');
  }
});
it('normalizes stable public question and entry mappings', () => {
  const form = normalizePublic(
    [
      null,
      [
        'Description',
        [[123, 'Name', null, 0, [[456, null, 1]]]],
        null,
        null,
        null,
        null,
        null,
        null,
        'Registration',
      ],
    ],
    'https://docs.google.com/forms/d/e/abc/viewform',
  );
  expect(form.title).toBe('Registration');
  expect(form.questions[0]).toMatchObject({
    id: '123',
    entryIds: ['456'],
    required: true,
    type: 'SHORT_TEXT',
  });
  expect(form.fingerprint).toHaveLength(64);
});
it('flags unrecognized metadata instead of guessing', () => {
  expect(() => normalizePublic({}, 'https://forms.gle/a')).toThrow();
  const form = normalizePublic(
    [
      null,
      ['', [[1, 'Unknown', null, 99, [[5, null, 1]]]], null, null, null, null, null, null, 'Test'],
    ],
    'https://forms.gle/a',
  );
  expect(form.blockers.join()).toContain('Unknown');
});
it('resolves official owner API conditional navigation', () => {
  const form = normalizeGoogleApi(
    {
      info: { title: 'Branching' },
      items: [
        {
          itemId: 'choice',
          title: 'Path',
          questionItem: {
            question: {
              required: true,
              choiceQuestion: {
                type: 'RADIO',
                options: [
                  { value: 'Skip', goToAction: 'SUBMIT_FORM' },
                  { value: 'Continue', goToSectionId: 'detail' },
                ],
              },
            },
          },
        },
        { itemId: 'detail', title: 'Details', pageBreakItem: {} },
        {
          itemId: 'name',
          title: 'Name',
          questionItem: { question: { required: true, textQuestion: {} } },
        },
      ],
    },
    'https://docs.google.com/forms/d/e/a/viewform',
  );
  expect(activeSections(form, { choice: 'Skip' })).toEqual(new Set(['section-1']));
  expect(activeSections(form, { choice: 'Continue' })).toEqual(new Set(['section-1', 'detail']));
});
