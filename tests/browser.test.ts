import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { fixtureServer } from './fixture-server.js';
import { sampleForm, sampleAnswers } from './helpers.js';
import { submitLocalFixture } from '../packages/submission-engine/src/browser.js';
import { emptyForm, finishForm } from '../packages/form-analyzer/src/normalize.js';
import { questionSchema } from '../packages/shared/src/index.js';
let fixture: Awaited<ReturnType<typeof fixtureServer>>;
it('submits a Google-style required-heading layout through stable question mappings', async () => {
  const form = emptyForm(fixture.url.replace('/form', '/google'));
  form.source = 'FIXTURE';
  form.questions = [
    questionSchema.parse({
      id: '1633920210',
      title: 'Name',
      type: 'SHORT_TEXT',
      required: true,
      sectionId: 'section-1',
      entryIds: ['2005620554'],
    }),
    questionSchema.parse({
      id: '227649005',
      title: 'Email',
      type: 'SHORT_TEXT',
      required: true,
      sectionId: 'section-1',
      entryIds: ['1045781291'],
      validation: { kind: 'EMAIL' },
    }),
  ];
  const before = fixture.submitted.length;
  const result = await submitLocalFixture(
    finishForm(form),
    { '1633920210': 'Local fixture', '227649005': 'fixture@example.com' },
    { beforeSubmit: async () => true, isStopped: async () => false },
  );
  expect(result.status).toBe('SUBMITTED');
  expect(fixture.submitted).toHaveLength(before + 1);
  expect(fixture.submitted.at(-1)!.get('name')).toBe('Local fixture');
});
beforeAll(async () => {
  fixture = await fixtureServer();
});
afterAll(async () => fixture.close());
it('fills real browser controls and verifies a visible confirmation', async () => {
  const before = vi.fn(async () => true);
  const result = await submitLocalFixture(sampleForm(fixture.url), sampleAnswers, {
    beforeSubmit: before,
    isStopped: async () => false,
  });
  expect(result.status).toBe('SUBMITTED');
  expect(result.submittedAt).toBeInstanceOf(Date);
  expect(before).toHaveBeenCalledOnce();
  expect(fixture.submitted.at(-1)!.get('name')).toBe('0012345678');
  expect(fixture.submitted.at(-1)!.getAll('skills')).toEqual(['TypeScript', 'Excel']);
  expect(fixture.submitted.at(-1)!.get('Monday')).toBe('Yes');
});
it('marks a response UNKNOWN if the server receives it but no confirmation is visible', async () => {
  fixture.setUnknown(true);
  const initial = fixture.submitted.length;
  const result = await submitLocalFixture(sampleForm(fixture.url), sampleAnswers, {
    beforeSubmit: async () => true,
    isStopped: async () => false,
  });
  expect(result.status).toBe('UNKNOWN');
  expect(result.submittedAt).toBeUndefined();
  expect(result.error).toContain('WAITING_FOR_CONFIRMATION');
  expect(fixture.submitted).toHaveLength(initial + 1);
  fixture.setUnknown(false);
});
it('honors pause/cancel before the submit intent boundary', async () => {
  const initial = fixture.submitted.length;
  const result = await submitLocalFixture(sampleForm(fixture.url), sampleAnswers, {
    beforeSubmit: async () => false,
    isStopped: async () => false,
  });
  expect(result.status).toBe('QUEUED');
  expect(fixture.submitted).toHaveLength(initial);
});
it.each([false, true])(
  'verifies an analyzed custom confirmation with redirect=%s',
  async (redirect) => {
    const message = 'Thanks for submitting your contact info!';
    fixture.setConfirmation(message);
    fixture.setRedirect(redirect);
    try {
      const form = sampleForm(fixture.url);
      form.confirmationMessage = message;
      const result = await submitLocalFixture(form, sampleAnswers, {
        beforeSubmit: async () => true,
        isStopped: async () => false,
      });
      expect(result.status).toBe('SUBMITTED');
      expect(result.submittedAt).toBeInstanceOf(Date);
    } finally {
      fixture.setConfirmation('Your response has been recorded');
      fixture.setRedirect(false);
    }
  },
);
it('does not count a matching confirmation phrase as success when the Submit form remains', async () => {
  fixture.setKeepForm(true);
  try {
    const result = await submitLocalFixture(sampleForm(fixture.url), sampleAnswers, {
      beforeSubmit: async () => true,
      isStopped: async () => false,
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.submittedAt).toBeUndefined();
  } finally {
    fixture.setKeepForm(false);
  }
});
it('does not count an error HTTP response as saved even if it displays confirmation text', async () => {
  fixture.setResponseStatus(400);
  try {
    const result = await submitLocalFixture(sampleForm(fixture.url), sampleAnswers, {
      beforeSubmit: async () => true,
      isStopped: async () => false,
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.error).toContain('HTTP 400');
    expect(result.submittedAt).toBeUndefined();
  } finally {
    fixture.setResponseStatus(200);
  }
});
it.each(['Engineering', 'Operations'])(
  'navigates real conditional sections for %s',
  async (path) => {
    const form = emptyForm(fixture.url.replace('/form', '/sections'));
    form.source = 'FIXTURE';
    form.sections.push(
      { id: 'engineering', title: 'Engineering' },
      { id: 'operations', title: 'Operations' },
    );
    form.questions = [
      questionSchema.parse({
        id: 'path',
        title: 'Department',
        type: 'MULTIPLE_CHOICE',
        required: true,
        sectionId: 'section-1',
        options: ['Engineering', 'Operations'],
        branches: { Engineering: 'engineering', Operations: 'operations' },
      }),
      questionSchema.parse({
        id: 'engineer',
        title: 'Engineering ID',
        type: 'SHORT_TEXT',
        required: true,
        sectionId: 'engineering',
      }),
      questionSchema.parse({
        id: 'operator',
        title: 'Operations ID',
        type: 'SHORT_TEXT',
        required: true,
        sectionId: 'operations',
      }),
    ];
    form.sections[1].next = 'SUBMIT';
    const answers: Record<string, string> =
      path === 'Engineering' ? { path, engineer: 'E001' } : { path, operator: 'O001' };
    const result = await submitLocalFixture(finishForm(form), answers, {
      beforeSubmit: async () => true,
      isStopped: async () => false,
    });
    expect(result.status).toBe('SUBMITTED');
    const received = fixture.submitted.at(-1)!;
    expect(received.get('path')).toBe(path);
    expect(received.get(path === 'Engineering' ? 'engineer' : 'operator')).toBe(
      path === 'Engineering' ? 'E001' : 'O001',
    );
    expect(received.has(path === 'Engineering' ? 'operator' : 'engineer')).toBe(false);
  },
);
