/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { QuestionImagePreview, type QuestionImageSelection } from '../question-image-preview';
import type { AnswerSheet, AuthSession, ExamResult } from '../domain/models';
import type { ScoreProvider } from '../providers/types';

let mockOptions: { enabled: boolean; queryFn: (context: { signal: AbortSignal }) => Promise<AnswerSheet[]> };
let mockData: AnswerSheet[] | undefined;
const mockGetQueryData = jest.fn();
const mockPlural = jest.fn();
const mockSingle = jest.fn();
const mockSession = { providerId: 'fictional', accountId: 'fictional-account' } as AuthSession;
const mockProvider: Pick<ScoreProvider, 'getQuestionAnswerSheets' | 'getQuestionAnswerSheet'> = {};
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: typeof mockOptions) => { mockOptions = options; return { data: mockData }; },
  useQueryClient: () => ({ getQueryData: mockGetQueryData }),
}));
jest.mock('../services/accounts', () => ({
  withAccount: (_accountId: string, callback: (provider: typeof mockProvider, session: AuthSession, signal: AbortSignal) => unknown, signal: AbortSignal) => callback(mockProvider, mockSession, signal),
}));
jest.mock('../sheet-image', () => ({ SheetViewerModal: ({ sheets }: { sheets: AnswerSheet[] }) => <div data-regions={sheets.length} /> }));
jest.mock('react-native', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: () => null, StyleSheet: { absoluteFill: {} },
}));
jest.mock('../ui', () => ({ Card: ({ children }: { children: ReactNode }) => <div>{children}</div>, ErrorCard: () => null, LoadingState: () => null }));
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => { render: (element: ReactNode) => void; unmount: () => void } }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const sheet: AnswerSheet = { subject: '虚构科目', url: 'https://fictional.example/answer.jpg', watermarked: false };
const cached: ExamResult = { examId: 'fictional-exam', examName: '虚构考试', subjects: [] };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  mockData = undefined; mockPlural.mockReset(); mockSingle.mockReset(); mockGetQueryData.mockReset().mockReturnValue(cached);
  mockProvider.getQuestionAnswerSheets = mockPlural; mockProvider.getQuestionAnswerSheet = mockSingle;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(selection?: QuestionImageSelection, revision: string | undefined = 'fictional-revision') {
  await act(async () => root.render(<QuestionImagePreview selection={selection} accountId="fictional-account" revision={revision} examId="fictional-exam" subjectId="fictional-paper" headers={{ Referer: 'https://fictional.example' }} onDismiss={jest.fn()} onLongPress={jest.fn()} />));
}
const student: QuestionImageSelection = { question: { id: 'fictional-question', label: '作文' }, kind: 'student' };

it('forwards all regions, cached exam and cancellation to the plural provider method', async () => {
  const regions = [sheet, sheet, sheet]; mockPlural.mockResolvedValue(regions);
  await render(student);
  const signal = new AbortController().signal;
  await expect(mockOptions.queryFn({ signal })).resolves.toBe(regions);
  expect(mockPlural).toHaveBeenCalledWith(mockSession, 'fictional-exam', 'fictional-paper', 'fictional-question', cached, { signal });
  expect(mockGetQueryData).toHaveBeenCalledWith(['account', 'fictional-account', 'fictional-revision', 'result', 'fictional-exam']);
  expect(mockSingle).not.toHaveBeenCalled();
  mockData = regions; await render(student);
  expect(container.querySelector('[data-regions="3"]')).not.toBeNull();
});
it('preserves the legacy single-image method for existing providers', async () => {
  delete mockProvider.getQuestionAnswerSheets; mockSingle.mockResolvedValue(sheet);
  await render(student); const signal = new AbortController().signal;
  await expect(mockOptions.queryFn({ signal })).resolves.toEqual([sheet]);
  expect(mockSingle).toHaveBeenCalledWith(mockSession, 'fictional-exam', 'fictional-paper', 'fictional-question', { signal });
});
it('treats empty region results as unavailable without guessing a legacy fallback', async () => {
  mockPlural.mockResolvedValue([]); await render(student);
  await expect(mockOptions.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(mockSingle).not.toHaveBeenCalled();
});
it.each(['answer', 'stem'] as const)('keeps %s images and their existing headers', async (kind) => {
  await render({ question: { ...student.question, providerContext: { correctAnswer: sheet.url, testImage: sheet.url } }, kind });
  await expect(mockOptions.queryFn({ signal: new AbortController().signal })).resolves.toEqual([{ ...sheet, subject: '作文', subjectId: 'fictional-paper', headers: { Referer: 'https://fictional.example' } }]);
  expect(mockPlural).not.toHaveBeenCalled();
});
it('does not enable a query without a selected question or an account revision', async () => {
  await render(); expect(mockOptions.enabled).toBe(false); expect(container.textContent).toBe('');
  await render(student, ''); expect(mockOptions.enabled).toBe(false);
});
