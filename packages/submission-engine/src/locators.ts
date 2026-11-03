import type { Locator, Page } from 'playwright';
import type { Question } from '../../shared/src/index.js';

export class ManualAction extends Error {}

// Google data-params uses a %.@. prefix; some versions omit the outer opening bracket.
// Parse as JSON only, and accept the known question tuple rather than searching raw substrings.
export function questionIdentity(raw: string | null) {
  if (!raw?.startsWith('%.@.')) return undefined;
  for (const serialized of [raw.slice(4), `[${raw.slice(4)}`]) {
    try {
      const decoded = JSON.parse(serialized);
      const question = Array.isArray(decoded?.[0]) ? decoded[0] : decoded;
      if (
        !Array.isArray(question) ||
        !['number', 'string'].includes(typeof question[0]) ||
        typeof question[1] !== 'string' ||
        typeof question[3] !== 'number' ||
        !Array.isArray(question[4])
      )
        continue;
      return {
        id: String(question[0]),
        title: question[1],
        entryIds: question[4].map((entry: unknown[]) => String(entry?.[0])),
      };
    } catch {
      /* Unknown metadata layout: try the other known encoding, then use semantic labels. */
    }
  }
  return undefined;
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function locateQuestion(page: Page, q: Question, fixture = false): Promise<Locator> {
  if (fixture && /^[a-zA-Z0-9_-]+$/.test(q.id)) {
    const native = page.locator(`[data-question-id="${q.id}"]`);
    if ((await native.count()) === 1) return native;
  }
  const items = page.getByRole('listitem');
  const params = await items.evaluateAll((elements) =>
    elements.map(
      (element) =>
        element.getAttribute('data-params') ??
        element.querySelector('[data-params]')?.getAttribute('data-params') ??
        null,
    ),
  );
  const identified = params
    .map((raw, index) => ({ identity: questionIdentity(raw), index }))
    .filter(({ identity }) => identity?.id === q.id);
  const matched = identified.filter(
    ({ identity }) =>
      identity!.title === q.title && q.entryIds.every((id) => identity!.entryIds.includes(id)),
  );
  if (identified.length === 1 && matched.length === 1) return items.nth(matched[0].index);
  if (identified.length) throw new ManualAction(`Cannot reliably locate question: ${q.title}`);
  // Required markers can have aria-label="Required question", changing the accessible name.
  const heading = page.getByRole('heading', {
    name: new RegExp(`^${escape(q.title)}(?:\\s*(?:\\*|Required question))?\\s*$`),
  });
  const semantic = items.filter({ has: heading });
  if ((await semantic.count()) !== 1)
    throw new ManualAction(`Cannot reliably locate question: ${q.title}`);
  return semantic;
}
