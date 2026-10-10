import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { AnswerSheet, StudentProfile, SubjectDetail } from '@/src/domain/models';
import type { ScoreProvider } from '@/src/providers/types';
import { withAccount } from './accounts';
import { throwIfAborted } from './http';

export const accountQueryKeys = {
  profiles: (accountId?: string, revision?: string) => ['account', accountId, revision, 'profiles'] as const,
  exams: (accountId?: string, revision?: string) => ['account', accountId, revision, 'exams'] as const,
  result: (accountId: string, revision: string | undefined, examId: string) => ['account', accountId, revision, 'result', examId] as const,
  subject: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'subject', examId, subjectId] as const,
  sheets: (accountId: string, revision: string | undefined, examId: string, subjectId?: string) => ['account', accountId, revision, 'sheets', examId, subjectId] as const,
  watermarkedSheets: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'watermarked-sheets', examId, subjectId] as const,
  unclaimedExams: (accountId?: string, revision?: string) => ['account', accountId, revision, 'unclaimed-exams'] as const,
};

export function profilesQueryOptions(accountId: string, revision: string | undefined) {
  return queryOptions({
    queryKey: accountQueryKeys.profiles(accountId, revision),
    enabled: !!revision,
    queryFn: ({ signal }): Promise<StudentProfile[]> => withAccount(accountId, (provider, session, requestSignal) =>
      provider.getProfiles ? provider.getProfiles(session, { signal: requestSignal }) : provider.getProfile(session, { signal: requestSignal }).then((profile) => [profile]), signal),
  });
}

export function examResultQueryOptions(accountId: string, revision: string | undefined, examId: string) {
  return queryOptions({
    queryKey: accountQueryKeys.result(accountId, revision, examId),
    enabled: !!revision,
    queryFn: ({ signal }) => withAccount(accountId, (provider, session, requestSignal) =>
      provider.getExamResult(session, examId, { signal: requestSignal }), signal),
  });
}

export function subjectQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId: string, subject?: string) {
  return queryOptions({
    queryKey: accountQueryKeys.subject(accountId, revision, examId, subjectId),
    enabled: !!revision,
    queryFn: async ({ signal }): Promise<SubjectDetail> => {
      // The result query owns its signal so one consumer cannot cancel a shared request.
      const result = await queryClient.fetchQuery(examResultQueryOptions(accountId, revision, examId));
      throwIfAborted(signal);
      return withAccount(accountId, async (provider, session, requestSignal) => {
        if (!provider.getSubjectDetail) {
          const cached = result.subjects.find((item) => item.id === subjectId || item.subject === subjectId);
          return { subjectId, subject: cached?.subject ?? subject ?? '未命名科目', score: cached?.score, maxScore: cached?.maxScore, grade: cached?.grade, providerContext: cached?.providerContext };
        }
        const detail = await provider.getSubjectDetail(session, examId, subjectId, result, { signal: requestSignal });
        throwIfAborted(requestSignal);
        // 未随详情返回答题卡不代表平台没有图片，保留独立答题卡查询。
        if (detail.answerSheets !== undefined) queryClient.setQueryData(accountQueryKeys.sheets(accountId, revision, examId, subjectId), detail.answerSheets);
        return detail;
      }, signal);
    },
  });
}

type SheetFetcher = NonNullable<ScoreProvider['getAnswerSheets']> | NonNullable<ScoreProvider['getWatermarkedAnswerSheets']>;

/** 无水印/带水印答题卡查询的公共骨架：仅当 Provider 支持对应方法时才连带拉取成绩。 */
function sheetQueryOptions(
  queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string,
  queryKey: readonly unknown[], enabled: boolean,
  pick: (provider: ScoreProvider) => SheetFetcher | undefined,
  subjectId: string,
) {
  return queryOptions({
    queryKey,
    enabled: enabled && !!revision,
    queryFn: ({ signal }) => withAccount(accountId, async (provider, session, requestSignal) => {
      const fetchSheets = pick(provider);
      if (!fetchSheets) return [] as AnswerSheet[];
      const result = await queryClient.fetchQuery(examResultQueryOptions(accountId, revision, examId));
      throwIfAborted(requestSignal);
      return fetchSheets(session, examId, subjectId, result, { signal: requestSignal });
    }, signal),
  });
}

export function answerSheetsQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId?: string) {
  return sheetQueryOptions(queryClient, accountId, revision, examId, accountQueryKeys.sheets(accountId, revision, examId, subjectId), !!subjectId,
    (provider) => subjectId ? provider.getAnswerSheets : undefined,
    subjectId ?? '');
}

/** 带分数水印的答题卡（各题得分标注在图片上）；与无水印版使用独立的查询键，互不覆盖。 */
export function watermarkedAnswerSheetsQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId: string) {
  return sheetQueryOptions(queryClient, accountId, revision, examId, accountQueryKeys.watermarkedSheets(accountId, revision, examId, subjectId), true,
    (provider) => provider.getWatermarkedAnswerSheets,
    subjectId);
}

/** 待认领考试列表；首页与认领页共用同一份缓存。 */
export function unclaimedExamsQueryOptions(accountId: string, revision: string | undefined) {
  return queryOptions({
    queryKey: accountQueryKeys.unclaimedExams(accountId, revision),
    enabled: !!revision,
    queryFn: ({ signal }) => withAccount(accountId, (provider, session, requestSignal) =>
      provider.getUnclaimedExams ? provider.getUnclaimedExams(session, { signal: requestSignal }) : Promise.resolve([]), signal),
  });
}
