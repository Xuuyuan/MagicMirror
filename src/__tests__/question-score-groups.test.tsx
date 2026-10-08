import type { ReactElement } from 'react';
import { QuestionScoreGroups } from '../question-score-groups';
import type { QuestionScore, QuestionScoreSummary } from '../domain/models';
import { isWrongQuestion } from '../services/subjects';

const { renderToStaticMarkup } = jest.requireActual<{ renderToStaticMarkup: (element: ReactElement) => string }>('react-dom/server');

// 检查实际展示组件的内容；原生布局及触摸操作仍需设备验收。
jest.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useTheme: () => ({ colors: { error: 'red' } }),
}));

const summaries: QuestionScoreSummary[] = [
  { kind: 'objective', score: 4, maxScore: 4 }, { kind: 'subjective', score: 0, maxScore: 6 },
];
const questions: QuestionScore[] = [
  { id: 'q1', label: '客观小题', kind: 'objective', score: 4, maxScore: 4 },
  { id: 'q2', label: '主观小题', kind: 'subjective', score: 0, maxScore: 6 },
];
it('keeps both whole-subject summaries when wrong-only removes a group or all questions', () => {
  const filtered = renderToStaticMarkup(<QuestionScoreGroups questions={questions.filter(isWrongQuestion)} summaries={summaries} />);
  expect(filtered).toContain('客观题（4/4）');
  expect(filtered).toContain('主观题（0/6）');
  expect(filtered).not.toContain('客观小题');
  expect(filtered).toContain('主观小题');
  const empty = renderToStaticMarkup(<QuestionScoreGroups questions={[]} summaries={summaries} />);
  expect(empty).toContain('客观题（4/4）');
  expect(empty).toContain('主观题（0/6）');
});
it('preserves unclassified questions alongside classified ones', () => {
  const html = renderToStaticMarkup(<QuestionScoreGroups questions={[...questions, { id: 'q3', label: '未知题型小题' }]} />);
  expect(html).toContain('其它题目');
  expect(html).toContain('未知题型小题');
  expect(html).toContain('客观小题');
  expect(html).toContain('主观小题');
});
it('does not add group headings for providers without classification or summaries', () => {
  const html = renderToStaticMarkup(<QuestionScoreGroups questions={[{ id: 'q1', label: '原有小题' }]} />);
  expect(html).toContain('原有小题');
  expect(html).not.toContain('客观题');
  expect(html).not.toContain('主观题');
});
