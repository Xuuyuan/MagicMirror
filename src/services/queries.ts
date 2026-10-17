import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { AnswerSheet, AuthSession, EssayDetail, ExamResult, StudentProfile, SubjectDetail, SubjectStatistic } from '@/src/domain/models';
import type { ProviderRequestOptions, ScoreProvider } from '@/src/providers/types';
import { withAccount } from './accounts';
import { throwIfAborted } from './http';

export const accountQueryKeys = {
  profiles: (accountId?: string, revision?: string) => ['account', accountId, revision, 'profiles'] as const,
  exams: (accountId?: string, revision?: string) => ['account', accountId, revision, 'exams'] as const,
  result: (accountId: string, revision: string | undefined, examId: string) => ['account', accountId, revision, 'result', examId] as const,
  subject: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'subject', examId, subjectId] as const,
  sheets: (accountId: string, revision: string | undefined, examId: string, subjectId?: string) => ['account', accountId, revision, 'sheets', examId, subjectId] as const,
  watermarkedSheets: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'watermarked-sheets', examId, subjectId] as const,
  papers: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'papers', examId, subjectId] as const,
  essay: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'essay', examId, subjectId] as const,
  subjectStatistics: (accountId: string, revision: string | undefined, examId: string, subjectId: string) => ['account', accountId, revision, 'subject-statistics', examId, subjectId] as const,
  unclaimedExams: (accountId?: string, revision?: string) => ['account', accountId, revision, 'unclaimed-exams'] as const,
};

export function academicYearsQueryOptions(accountId: string, revision: string | undefined, supported: boolean) {
  return queryOptions({
    queryKey: ['account', accountId, revision, 'academic-years'] as const,
    enabled: !!revision && supported,
    queryFn: ({ signal }) => withAccount(accountId, (provider, session, requestSignal) =>
      provider.getAcademicYears ? provider.getAcademicYears(session, { signal: requestSignal }) : Promise.resolve([]), signal),
  });
}

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

type SubjectResourceFetcher<T> = (session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions) => Promise<T>;

/**
 * 科目级附加资源的公共骨架：仅当 Provider 支持对应方法时才连带拉取成绩缓存；
 * 方法缺失时返回 fallback（能力探测在 queryFn 内，界面不感知平台差异）。
 */
function subjectResourceQueryOptions<T>(
  queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string,
  queryKey: readonly unknown[], enabled: boolean,
  pick: (provider: ScoreProvider) => SubjectResourceFetcher<T> | undefined,
  subjectId: string, fallback: T,
) {
  return queryOptions({
    queryKey,
    enabled: enabled && !!revision,
    queryFn: ({ signal }): Promise<T> => withAccount(accountId, async (provider, session, requestSignal) => {
      const fetchResource = pick(provider);
      if (!fetchResource) return fallback;
      const result = await queryClient.fetchQuery(examResultQueryOptions(accountId, revision, examId));
      throwIfAborted(requestSignal);
      return fetchResource(session, examId, subjectId, result, { signal: requestSignal });
    }, signal),
  });
}

/** 无水印/带水印答题卡查询的公共骨架：仅当 Provider 支持对应方法时才连带拉取成绩。 */
function sheetQueryOptions(
  queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string,
  queryKey: readonly unknown[], enabled: boolean,
  pick: (provider: ScoreProvider) => SubjectResourceFetcher<AnswerSheet[]> | undefined,
  subjectId: string,
) {
  return subjectResourceQueryOptions<AnswerSheet[]>(queryClient, accountId, revision, examId, queryKey, enabled, pick, subjectId, []);
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

/** 试卷原卷扫描图；与答题卡、水印答题卡都是独立图片集，各自使用独立查询键。地址是短期签名直链，过期由界面重新获取。 */
export function paperImagesQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId: string) {
  return sheetQueryOptions(queryClient, accountId, revision, examId, accountQueryKeys.papers(accountId, revision, examId, subjectId), !!subjectId,
    (provider) => provider.getPaperImages,
    subjectId);
}

/** 作文题干与本人作答扫描图；仅在科目确有作文数据时启用（enabled 由界面按 providerContext 判断）。 */
export function essayQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId: string, enabled: boolean) {
  return subjectResourceQueryOptions<EssayDetail>(queryClient, accountId, revision, examId,
    accountQueryKeys.essay(accountId, revision, examId, subjectId), enabled,
    (provider) => provider.getEssayDetail, subjectId, { answerSheets: [] });
}

/** 科目级统计（如参考人数）；懒加载，与科目详情相互独立。 */
export function subjectStatisticsQueryOptions(queryClient: QueryClient, accountId: string, revision: string | undefined, examId: string, subjectId: string, enabled: boolean) {
  return subjectResourceQueryOptions<SubjectStatistic[]>(queryClient, accountId, revision, examId,
    accountQueryKeys.subjectStatistics(accountId, revision, examId, subjectId), enabled,
    (provider) => provider.getSubjectStatistics, subjectId, []);
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
