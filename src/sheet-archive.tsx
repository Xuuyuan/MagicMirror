import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Text } from 'react-native-paper';
import type { SheetArchiveState } from './domain/models';
import {
  accountQueryKeys,
  restoreSheetArchive,
  sheetArchiveQueryOptions,
} from './services/queries';
import {
  archivedSheetColdMessage,
  archivedSheetDeepMessage,
  archivedSheetMessage,
  archivedSheetRestoringText,
  archivedSheetStateUnavailableMessage,
} from './services/sheet-messages';

/**
 * 已确认图片是平台归档对象后显示的通知与恢复入口。
 * 只有用户点击“恢复”才发起平台写请求；恢复中状态仍以平台查询为准。
 */
export function SheetArchiveNotice({
  accountId,
  revision,
  examId,
  subjectId,
  retry,
  retryText,
}: {
  accountId: string;
  revision?: string;
  examId: string;
  subjectId: string;
  retry?: () => void;
  retryText?: string;
}) {
  const queryClient = useQueryClient();
  const archive = useQuery(sheetArchiveQueryOptions(accountId, revision, examId, subjectId, true));
  const restore = useMutation({
    mutationFn: () => restoreSheetArchive(accountId, examId, subjectId),
    onSuccess: () => {
      // 立即显示“恢复中”，避免用户刚提交就退出再进入时读回旧状态而重复提交。
      // 重新进入后是否仍在恢复，仍由平台状态接口确认。
      queryClient.setQueryData<SheetArchiveState | undefined>(
        accountQueryKeys.sheetArchive(accountId, revision, examId, subjectId),
        (previous) => ({ tier: previous?.tier ?? 'cold', restoring: true }),
      );
    },
  });
  if (archive.isPending) return <Text>正在检查图片归档状态…</Text>;
  if (archive.isError)
    return (
      <>
        <Text>{archivedSheetStateUnavailableMessage}</Text>
        {retry ? <Button onPress={retry}>{retryText ?? '重新获取'}</Button> : null}
      </>
    );
  if (!archive.data) return <Text>{archivedSheetMessage}</Text>;
  if (archive.data.tier === 'deep') return <Text>{archivedSheetDeepMessage}</Text>;
  if (restore.isPending) return <Text>正在提交恢复申请…</Text>;
  if (archive.data.restoring)
    return <Text>{archivedSheetRestoringText(archive.data.remainingSeconds)}</Text>;
  return (
    <>
      <Text>{archivedSheetColdMessage}</Text>
      <Button
        onPress={() => restore.mutate()}
        loading={restore.isPending}
        disabled={restore.isPending}
      >
        恢复
      </Button>
      {restore.error ? <Text>恢复申请未完成，请稍后重试。</Text> : null}
    </>
  );
}
