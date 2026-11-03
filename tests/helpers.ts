import { finishForm, emptyForm } from '../packages/form-analyzer/src/normalize.js';
import { questionSchema } from '../packages/shared/src/index.js';
export function sampleForm(url = 'https://docs.google.com/forms/d/e/test/viewform') {
  const form = emptyForm(url);
  form.title = 'Employee registration';
  form.source = 'FIXTURE';
  form.questions = [
    { id: 'name', title: 'Full name', type: 'SHORT_TEXT', required: true },
    { id: 'notes', title: 'Notes', type: 'PARAGRAPH', required: false },
    {
      id: 'team',
      title: 'Team',
      type: 'DROPDOWN',
      required: true,
      options: ['Engineering', 'Operations'],
    },
    {
      id: 'choice',
      title: 'Work style',
      type: 'MULTIPLE_CHOICE',
      required: true,
      options: ['Remote', 'Office'],
    },
    {
      id: 'skills',
      title: 'Skills',
      type: 'CHECKBOXES',
      required: true,
      options: ['TypeScript', 'Excel'],
    },
    {
      id: 'rating',
      title: 'Rating',
      type: 'LINEAR_SCALE',
      required: true,
      options: ['1', '2', '3', '4', '5'],
      min: 1,
      max: 5,
    },
    { id: 'date', title: 'Start date', type: 'DATE', required: true },
    { id: 'time', title: 'Start time', type: 'TIME', required: true },
    {
      id: 'grid',
      title: 'Availability',
      type: 'MULTIPLE_CHOICE_GRID',
      required: true,
      options: ['Yes', 'No'],
      rows: ['Monday', 'Tuesday'],
    },
    {
      id: 'checks',
      title: 'Preferences',
      type: 'CHECKBOX_GRID',
      required: false,
      options: ['A', 'B'],
      rows: ['First'],
    },
  ].map((q) => questionSchema.parse({ ...q, sectionId: 'section-1' }));
  return finishForm(form);
}
export const sampleAnswers = {
  name: '0012345678',
  notes: 'Local integration test',
  team: 'Engineering',
  choice: 'Remote',
  skills: 'TypeScript; Excel',
  rating: '4',
  date: '2026-11-03',
  time: '14:30',
  'grid::Monday': 'Yes',
  'grid::Tuesday': 'No',
  'checks::First': 'A; B',
};
