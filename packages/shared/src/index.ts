import { z } from 'zod';

const restrictionMessages: Record<string, string> = {
  loginRequired:
    'This Google Form requires respondents to sign in to Google. Anonymous bulk submission is unavailable.',
  closed: 'This Google Form is closed or is no longer accepting responses.',
  captcha:
    'Google requires an interactive CAPTCHA or human verification. Manual action is required.',
  organizationRestricted:
    'This Google Form restricts responses to an organization or approved accounts.',
};
export function restrictionMessage(reason: string): string {
  return restrictionMessages[reason] ?? reason;
}

export const questionTypes = [
  'SHORT_TEXT',
  'PARAGRAPH',
  'MULTIPLE_CHOICE',
  'CHECKBOXES',
  'DROPDOWN',
  'LINEAR_SCALE',
  'MULTIPLE_CHOICE_GRID',
  'CHECKBOX_GRID',
  'DATE',
  'TIME',
  'FILE_UPLOAD',
  'UNSUPPORTED',
] as const;
export const questionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(questionTypes),
  required: z.boolean(),
  sectionId: z.string(),
  options: z.array(z.string()).default([]),
  rows: z.array(z.string()).default([]),
  other: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  branches: z.record(z.string(), z.string()).optional(),
  entryIds: z.array(z.string()).default([]),
  description: z.string().optional(),
  validation: z.object({ kind: z.literal('EMAIL') }).optional(),
});
export const formSchema = z.object({
  title: z.string(),
  description: z.string(),
  confirmationMessage: z.string().min(1).max(10000).optional(),
  sourceUrl: z.string(),
  questions: z.array(questionSchema),
  sections: z.array(z.object({ id: z.string(), title: z.string(), next: z.string().optional() })),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  capabilities: z.object({
    loginRequired: z.boolean(),
    closed: z.boolean(),
    captcha: z.boolean(),
    emailCollection: z.boolean(),
    fileUpload: z.boolean(),
    organizationRestricted: z.boolean(),
    responseEditing: z.boolean().nullable(),
  }),
  source: z.enum(['PUBLIC', 'GOOGLE_API', 'FIXTURE']),
  fingerprint: z.string(),
});
export type Question = z.infer<typeof questionSchema>;
export type FormDefinition = z.infer<typeof formSchema>;
export type Answers = Record<string, string>;
export const recordStates = [
  'PENDING',
  'VALIDATING',
  'QUEUED',
  'RUNNING',
  'SUBMITTED',
  'FAILED',
  'UNKNOWN',
  'NEEDS_MANUAL_ACTION',
  'CANCELLED',
] as const;
export type RecordState = (typeof recordStates)[number];
export type ValidatedRow = {
  rowNumber: number;
  answers: Answers;
  errors: string[];
  duplicate: boolean;
};
export type ValidationResult = {
  total: number;
  valid: number;
  invalid: number;
  rows: ValidatedRow[];
};
export function fieldKey(q: Question, row?: string) {
  return row === undefined ? q.id : `${q.id}::${row}`;
}
type Column = { key: string; heading: string; q: Question; row: string | undefined };
export function columns(form: FormDefinition): Column[] {
  return form.questions.flatMap<Column>((q) =>
    q.rows.length
      ? q.rows.map((r) => ({
          key: fieldKey(q, r),
          heading: `${q.title} — ${r}${q.required ? ' *' : ''}`,
          q,
          row: r,
        }))
      : [{ key: q.id, heading: `${q.title}${q.required ? ' *' : ''}`, q, row: undefined }],
  );
}
export function activeSections(form: FormDefinition, answers: Answers): Set<string> {
  const active = new Set<string>();
  let id = form.sections[0]?.id;
  while (id && id !== 'SUBMIT' && !active.has(id)) {
    active.add(id);
    const index = form.sections.findIndex((s) => s.id === id);
    let next = form.sections[index]?.next ?? form.sections[index + 1]?.id;
    for (const q of form.questions.filter((q) => q.sectionId === id)) {
      if (q.branches?.[answers[q.id]]) next = q.branches[answers[q.id]];
    }
    id = next;
  }
  return active;
}
export function safeToRetry(
  state: RecordState,
  submitIntentAt: Date | null,
  error?: string | null,
) {
  return (
    submitIntentAt === null &&
    (state === 'FAILED' ||
      (state === 'NEEDS_MANUAL_ACTION' &&
        error?.startsWith('Cannot reliably locate question: ') === true))
  );
}
