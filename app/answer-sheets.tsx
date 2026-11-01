import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { answerSheetsQueryOptions } from '@/src/services/queries';
import { useAccounts } from '@/src/accounts-context';
import { SheetGallery } from '@/src/sheet-gallery';

export default function AnswerSheets() {
  const { accountId, examId, subjectId, reportId } = useLocalSearchParams<{
    accountId: string;
    examId: string;
    subjectId?: string;
    reportId?: string;
  }>();
  const { accounts } = useAccounts();
  const revision = accounts.find((account) => account.id === accountId)?.revision;
  const queryClient = useQueryClient();
  const query = useQuery(
    answerSheetsQueryOptions(queryClient, accountId, revision, examId, subjectId, reportId),
  );
  return (
    <SheetGallery
      accountId={accountId}
      subjectId={subjectId}
      title="答题卡"
      missingSubjectText="请从单科详情进入答题卡。"
      loadingText="正在加载答题卡…"
      emptyText="平台未提供本场考试的答题卡。"
      refreshText="重新获取答题卡"
      query={query}
    />
  );
}
