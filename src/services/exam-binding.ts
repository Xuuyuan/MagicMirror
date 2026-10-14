import type { AuthSession, ExamBindingCandidate } from '../domain/models';
import { ProviderError } from '../domain/models';
import type { ScoreProvider } from '../providers/types';
import { accountStorage } from '../storage/accounts';
import { withAccount } from './accounts';
import { throwIfAborted } from './http';

export function supportsExamBinding(provider: ScoreProvider | undefined): boolean {
  return !!(provider?.getSearchableExams && provider.previewExamBinding && provider.bindExam);
}

/** 页面携带打开时的 revision；账号编辑、删除后不能继续使用旧核对结果。 */
async function withBindingAccount<T>(accountId: string, revision: string, operation: (provider: ScoreProvider, session: AuthSession, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  return withAccount(accountId, async (provider, session, requestSignal) => {
    const account = await accountStorage.load(accountId);
    throwIfAborted(requestSignal);
    if (!account || account.revision !== revision) throw new ProviderError('RESTRICTED', '账号已变更，请返回考试列表重新进入');
    if (!supportsExamBinding(provider)) throw new ProviderError('UNSUPPORTED', '该平台不支持搜索考试项目');
    return operation(provider, session, requestSignal);
  }, signal);
}

export function searchableExamsQueryOptions(accountId: string, revision: string) {
  return {
    queryKey: ['account', accountId, revision, 'searchable-exams'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => withBindingAccount(accountId, revision, (provider, session, requestSignal) => provider.getSearchableExams!(session, { signal: requestSignal }), signal),
  };
}

export function previewExamBinding(accountId: string, revision: string, examId: string, studentCode: string, signal: AbortSignal) {
  return withBindingAccount(accountId, revision, (provider, session, requestSignal) => provider.previewExamBinding!(session, examId, studentCode, { signal: requestSignal }), signal);
}

export function bindExam(accountId: string, revision: string, candidate: ExamBindingCandidate, signal: AbortSignal) {
  return withBindingAccount(accountId, revision, async (provider, session, requestSignal) => {
    try { return await provider.bindExam!(session, candidate, { signal: requestSignal }); }
    catch (error) {
      // 各平台的写方法都不因账号层恢复会话而隐式重放。
      if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw new ProviderError('RESTRICTED', '登录状态已失效，请重新登录后核对；绑定未自动重试');
      throw error;
    }
  }, signal);
}
