import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { paperImagesQueryOptions } from '@/src/services/queries';
import { useAccounts } from '@/src/accounts-context';
import { SheetGallery } from '@/src/sheet-gallery';

export default function ExamPapers() {
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
    paperImagesQueryOptions(queryClient, accountId, revision, examId, subjectId ?? '', reportId),
  );
  return (
    <SheetGallery
      accountId={accountId}
      subjectId={subjectId}
      title="试卷原卷"
      missingSubjectText="请从单科详情进入试卷原卷。"
      loadingText="正在加载试卷原卷…"
      emptyText="平台未提供本科目原卷。"
      refreshText="重新获取原卷"
      imageAccessibilityLabel={(index) => `查看第 ${index + 1} 页原卷`}
      query={query}
    />
  );
}
