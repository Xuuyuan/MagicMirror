import { QueryClient } from '@tanstack/react-query';
import { accountQueryKeys, answerSheetsQueryOptions, subjectQueryOptions } from '@/src/services/queries';
import { withAccount } from '@/src/services/accounts';
import type { AuthSession, ExamResult, SubjectDetail } from '@/src/domain/models';
import type { ScoreProvider } from '@/src/providers/types';

jest.mock('@/src/services/accounts', () => ({ withAccount: jest.fn() }));

const session: AuthSession = { providerId: 'fictional', accountId: 'fictional', accessToken: 'fictional-token' };
const result: ExamResult = { examId: 'exam', examName: '虚构考试', subjects: [{ id: 'chem', subject: '化学' }] };

it('无独立单科接口时把赋分及原始分传递至科目详情', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const subject = { subject: '化学', score: 65, maxScore: 100, grade: 'B4', providerContext: { originalScore: '20', scaledScore: '65', gradePercentile: '36-43%' } };
  const provider = { getExamResult: async () => ({ ...result, subjects: [subject] }) } as unknown as ScoreProvider;
  jest.mocked(withAccount).mockImplementation(async (_id, operation) => operation(provider, session));
  try {
    expect(await client.fetchQuery(subjectQueryOptions(client, 'account', 'r1', 'exam', '化学'))).toEqual({ subjectId: '化学', ...subject });
  } finally { client.clear(); }
});

it.each([false, true])('单科详情未带答题卡时，保留独立查询和已有缓存（已有缓存=%s）', async (cached) => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  const sheets = [{ subject: '化学', subjectId: 'chem', url: 'https://example.invalid/fictional.png' }];
  const getAnswerSheets = jest.fn(async () => sheets);
  const provider = { getExamResult: async () => result, getSubjectDetail: async (): Promise<SubjectDetail> => ({ subjectId: 'chem', subject: '化学' }), getAnswerSheets } as unknown as ScoreProvider;
  jest.mocked(withAccount).mockImplementation(async (_id, operation) => operation(provider, session));
  const key = accountQueryKeys.sheets('account', 'r1', 'exam', 'chem');
  try {
    if (cached) client.setQueryData(key, sheets);
    await client.fetchQuery(subjectQueryOptions(client, 'account', 'r1', 'exam', 'chem'));
    expect(client.getQueryData(key)).toEqual(cached ? sheets : undefined);
    expect(await client.fetchQuery(answerSheetsQueryOptions(client, 'account', 'r1', 'exam', 'chem'))).toEqual(sheets);
    expect(getAnswerSheets).toHaveBeenCalledTimes(cached ? 0 : 1);
  } finally { client.clear(); }
});
