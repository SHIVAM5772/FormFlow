import { createHash } from 'node:crypto';
import { formSchema, type FormDefinition, type Question } from '../../shared/src/index.js';

export function fingerprint(form: Omit<FormDefinition, 'fingerprint'>) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: form.title,
        description: form.description,
        confirmationMessage: form.confirmationMessage,
        source: form.source,
        questions: form.questions,
        sections: form.sections,
        capabilities: form.capabilities,
        blockers: form.blockers,
        warnings: form.warnings,
      }),
    )
    .digest('hex');
}
export function finishForm(form: Omit<FormDefinition, 'fingerprint'>): FormDefinition {
  for (const q of form.questions) {
    if (q.type.includes('CHECKBOX') && q.options.some((o) => o.includes(';'))) {
      const warning = `Checkbox option labels contain a semicolon: ${q.title}`;
      if (!form.blockers.includes(warning)) form.blockers.push(warning);
    }
  }
  if (
    form.questions.length > 300 ||
    form.questions.reduce((n, q) => n + Math.max(1, q.rows.length), 0) > 1000
  )
    form.blockers.push('Form exceeds the supported question/column limits');
  const sectionIds = new Set(form.sections.map((s) => s.id));
  for (const q of form.questions) {
    for (const target of Object.values(q.branches ?? {})) {
      if (target !== 'SUBMIT' && !sectionIds.has(target))
        form.blockers.push(`Unrecognized section target: ${q.title}`);
      else if (
        target !== 'SUBMIT' &&
        form.sections.findIndex((s) => s.id === target) <=
          form.sections.findIndex((s) => s.id === q.sectionId)
      )
        form.blockers.push(`Backward or cyclic navigation requires manual handling: ${q.title}`);
    }
  }
  return formSchema.parse({ ...form, fingerprint: fingerprint(form) });
}
const caps = {
  loginRequired: false,
  closed: false,
  captcha: false,
  emailCollection: false,
  fileUpload: false,
  organizationRestricted: false,
  responseEditing: null,
};
export function emptyForm(sourceUrl: string): Omit<FormDefinition, 'fingerprint'> {
  return {
    title: 'Google Form',
    description: '',
    sourceUrl,
    questions: [],
    sections: [{ id: 'section-1', title: 'Start' }],
    warnings: [],
    blockers: [],
    capabilities: { ...caps },
    source: 'PUBLIC',
  };
}
const publicTypes: Record<number, Question['type']> = {
  0: 'SHORT_TEXT',
  1: 'PARAGRAPH',
  2: 'MULTIPLE_CHOICE',
  3: 'DROPDOWN',
  4: 'CHECKBOXES',
  5: 'LINEAR_SCALE',
  7: 'MULTIPLE_CHOICE_GRID',
  9: 'DATE',
  10: 'TIME',
  13: 'FILE_UPLOAD',
};
// Google respondent metadata is undocumented. Unknown layouts fail closed instead of guessing.
export function normalizePublic(data: any, sourceUrl: string): FormDefinition {
  const result = emptyForm(sourceUrl);
  const body = data?.[1];
  if (!Array.isArray(body) || !Array.isArray(body[1]))
    throw new Error('Google respondent metadata is unavailable or changed');
  result.title = String(body[8] ?? data[3] ?? 'Google Form');
  result.description = String(body[0] ?? '');
  if (Array.isArray(body[2]) && typeof body[2][0] === 'string' && body[2][0].trim()) {
    result.confirmationMessage = body[2][0].trim();
  }
  let section = 'section-1';
  for (const item of body[1]) {
    if (!Array.isArray(item)) continue;
    if (item[3] === 8) {
      section = String(item[0]);
      result.sections.push({ id: section, title: String(item[1] ?? 'Section') });
      continue;
    }
    if ([6, 11, 12].includes(item[3])) continue;
    const entries = item[4];
    if (!Array.isArray(entries) || !entries.length) {
      result.blockers.push(`Question ${String(item[1])} has no reliable entry mapping`);
      continue;
    }
    let type = publicTypes[item[3]] ?? 'UNSUPPORTED';
    if (item[3] === 7 && entries[0]?.[11]?.[0]) type = 'CHECKBOX_GRID';
    const options = (entries[0]?.[1] ?? [])
      .filter((o: any) => Array.isArray(o) && o[0] !== null)
      .map((o: any) => String(o[0]));
    const q: Question = {
      id: String(item[0]),
      title: String(item[1] ?? ''),
      description: String(item[2] ?? ''),
      type,
      required: entries.some((e: any) => e[2] === 1),
      sectionId: section,
      options,
      rows: type.includes('GRID') ? entries.map((e: any) => String(e[3]?.[0] ?? '')) : [],
      entryIds: entries.map((e: any) => String(e[0])),
      other: (entries[0]?.[1] ?? []).some((o: any) => o?.[4] === 1),
    };
    if (type === 'LINEAR_SCALE') {
      q.min = Number(options[0]);
      q.max = Number(options.at(-1));
      if (!Number.isFinite(q.min) || !Number.isFinite(q.max))
        result.blockers.push(`Scale limits unavailable: ${q.title}`);
    }
    if (type === 'DATE' && entries[0]?.[7]?.[0] === 1)
      result.blockers.push(`Date with time requires manual handling: ${q.title}`);
    if (type === 'TIME' && entries[0]?.[6]?.[0] === 1)
      result.blockers.push(`Duration requires manual handling: ${q.title}`);
    const validation = entries[0]?.[4];
    const emailRule =
      type === 'SHORT_TEXT' &&
      entries.length === 1 &&
      Array.isArray(validation) &&
      validation.length === 1 &&
      Array.isArray(validation[0]) &&
      validation[0].length >= 2 &&
      validation[0].length <= 4 &&
      validation[0][0] === 2 &&
      validation[0][1] === 102 &&
      (validation[0][2] == null ||
        (Array.isArray(validation[0][2]) && validation[0][2].length === 0));
    if (emailRule) q.validation = { kind: 'EMAIL' };
    else if (entries.some((e: any) => e[4]))
      result.blockers.push(`Custom response validation requires manual review: ${q.title}`);
    if ((entries[0]?.[1] ?? []).some((o: any) => o?.[2] != null))
      result.blockers.push(
        `Conditional navigation metadata requires owner API analysis: ${q.title}`,
      );
    if (type === 'UNSUPPORTED' || type === 'FILE_UPLOAD' || !q.title || q.rows.some((r) => !r))
      result.blockers.push(`Unsupported or incomplete question: ${q.title}`);
    result.questions.push(q);
  }
  if (result.sections.length > 1)
    result.warnings.push(
      'Public section navigation is validated in the browser. Branching forms require owner API analysis.',
    );
  result.capabilities.fileUpload = result.questions.some((q) => q.type === 'FILE_UPLOAD');
  result.warnings.push(
    'Public metadata is undocumented. Custom validation and form changes can require manual review.',
  );
  if (!result.questions.length) result.blockers.push('No accessible questions found');
  return finishForm(result);
}
export function normalizeGoogleApi(data: any, sourceUrl: string): FormDefinition {
  const result = emptyForm(sourceUrl);
  result.source = 'GOOGLE_API';
  result.title = data.info?.title ?? 'Google Form';
  result.description = data.info?.description ?? '';
  let section = 'section-1';
  for (const item of data.items ?? []) {
    if (item.pageBreakItem) {
      section = item.itemId;
      result.sections.push({ id: section, title: item.title ?? 'Section' });
      continue;
    }
    const question = item.questionItem?.question;
    const group = item.questionGroupItem;
    if (!question && !group) continue;
    const source = question ?? group.questions?.[0];
    const choice = source?.choiceQuestion;
    const grid = group?.grid?.columns;
    const q: Question = {
      id: item.itemId,
      title: item.title ?? '',
      description: item.description,
      sectionId: section,
      required: !!source?.required,
      options: (choice?.options ?? grid?.options ?? []).map((o: any) => o.value),
      rows: group ? (group.questions ?? []).map((q: any) => q.rowQuestion.title) : [],
      entryIds: [],
      other: !!choice?.options?.some((o: any) => o.isOther),
      type: 'UNSUPPORTED',
    };
    if (source?.textQuestion) q.type = source.textQuestion.paragraph ? 'PARAGRAPH' : 'SHORT_TEXT';
    if (choice)
      q.type =
        ({ RADIO: 'MULTIPLE_CHOICE', CHECKBOX: 'CHECKBOXES', DROP_DOWN: 'DROPDOWN' } as const)[
          choice.type as 'RADIO'
        ] ?? 'UNSUPPORTED';
    if (group) q.type = grid?.type === 'CHECKBOX' ? 'CHECKBOX_GRID' : 'MULTIPLE_CHOICE_GRID';
    if (source?.scaleQuestion) {
      q.type = 'LINEAR_SCALE';
      q.min = source.scaleQuestion.low;
      q.max = source.scaleQuestion.high;
      q.options = Array.from({ length: q.max! - q.min! + 1 }, (_, i) => String(q.min! + i));
    }
    if (source?.dateQuestion) {
      q.type = 'DATE';
      if (source.dateQuestion.includeTime || !source.dateQuestion.includeYear)
        result.blockers.push(`Unsupported date configuration: ${q.title}`);
    }
    if (source?.timeQuestion) {
      q.type = 'TIME';
      if (source.timeQuestion.duration)
        result.blockers.push(`Duration requires manual handling: ${q.title}`);
    }
    if (source?.fileUploadQuestion) {
      q.type = 'FILE_UPLOAD';
      result.capabilities.fileUpload = true;
    }
    for (const option of choice?.options ?? []) {
      if (option.goToSectionId || option.goToAction) {
        q.branches ??= {};
        q.branches[option.value] =
          option.goToSectionId ??
          (option.goToAction === 'SUBMIT_FORM'
            ? 'SUBMIT'
            : option.goToAction === 'NEXT_SECTION'
              ? 'NEXT'
              : 'UNSUPPORTED_NAVIGATION');
      }
    }
    if (q.type === 'UNSUPPORTED' || q.type === 'FILE_UPLOAD')
      result.blockers.push(`Unsupported question: ${q.title}`);
    result.questions.push(q);
  }
  for (const q of result.questions) {
    for (const [value, target] of Object.entries(q.branches ?? {})) {
      if (target === 'NEXT') {
        const i = result.sections.findIndex((s) => s.id === q.sectionId);
        q.branches![value] = result.sections[i + 1]?.id ?? 'SUBMIT';
      }
    }
  }
  result.capabilities.emailCollection =
    !!data.settings?.emailCollectionType && data.settings.emailCollectionType !== 'DO_NOT_COLLECT';
  if (result.capabilities.emailCollection)
    result.blockers.push('Email collection requires respondent identity review');
  result.warnings.push(
    'Owner API analysis does not grant respondent access. Login restrictions are checked before each submission.',
  );
  if (!result.questions.length) result.blockers.push('No accessible questions found');
  return finishForm(result);
}
