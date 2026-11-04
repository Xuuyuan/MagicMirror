import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  ProviderError,
  type AnswerSheet,
  type ExamResult,
  type QuestionScore,
} from './domain/models';
import type { QuestionImageKind } from './question-score-groups';
import { withAccount } from './services/accounts';
import { accountQueryKeys } from './services/queries';
import { archivedSheetMessage } from './services/sheet-messages';
import { SheetArchiveNotice } from './sheet-archive';
import { SheetViewerModal } from './sheet-image';
import { Card, ErrorCard, LoadingState } from './ui';

export interface QuestionImageSelection {
  question: QuestionScore;
  kind: QuestionImageKind;
}
export function QuestionImagePreview({
  selection,
  accountId,
  revision,
  examId,
  subjectId,
  reportId,
  headers,
  onDismiss,
  onLongPress,
}: {
  selection?: QuestionImageSelection;
  accountId: string;
  revision?: string;
  examId: string;
  subjectId: string;
  reportId?: string;
  headers?: Record<string, string>;
  onDismiss: () => void;
  onLongPress: (sheet: AnswerSheet) => void;
}) {
  const queryClient = useQueryClient();
  const selectionKey = selection ? `${selection.question.id}:${selection.kind}` : '';
  const [archivedKey, setArchivedKey] = useState('');
  const archived = !!selectionKey && archivedKey === selectionKey;
  const query = useQuery({
    queryKey: [
      'account',
      accountId,
      revision,
      'question-images',
      examId,
      subjectId,
      reportId,
      selection?.question.id,
      selection?.kind,
    ],
    enabled: !!selection && !!revision,
    staleTime: 0,
    retry: 1,
    queryFn: async ({ signal }): Promise<AnswerSheet[]> => {
      if (!selection) throw new ProviderError('NOT_FOUND', '请选择题目');
      const { question, kind } = selection;
      if (kind === 'student')
        return withAccount(
          accountId,
          async (provider, session, requestSignal) => {
            if (provider.getQuestionAnswerSheets) {
              const cached = queryClient.getQueryData<ExamResult>(
                accountQueryKeys.result(accountId, revision, examId, reportId),
              );
              const sheets = await provider.getQuestionAnswerSheets(
                session,
                examId,
                subjectId,
                question.id,
                cached,
                { signal: requestSignal, reportId },
              );
              if (!sheets.length) throw new ProviderError('NOT_FOUND', '平台未提供此题作答区域');
              return sheets;
            }
            if (!provider.getQuestionAnswerSheet)
              throw new ProviderError('UNSUPPORTED', '平台未提供逐题作答图片');
            return [
              await provider.getQuestionAnswerSheet(session, examId, subjectId, question.id, {
                signal: requestSignal,
                reportId,
              }),
            ];
          },
          signal,
        );
      const url =
        kind === 'answer'
          ? question.providerContext?.correctAnswer
          : question.providerContext?.testImage;
      if (!url || !/^https?:\/\//i.test(url))
        throw new ProviderError('NOT_FOUND', '平台未提供此题图片');
      return [{ subject: question.label, subjectId, url, watermarked: false, headers }];
    },
  });
  if (!selection) return null;
  // 小题作答图被平台归档时不再打开空白的全屏图片区域，直接显示归档说明与恢复入口。
  if (query.data?.length && archived && selection.kind === 'student')
    return (
      <Modal transparent visible onRequestClose={onDismiss} statusBarTranslucent>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: 24,
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="关闭归档提示"
          />
          <View onStartShouldSetResponder={() => true}>
            <Card>
              <SheetArchiveNotice
                accountId={accountId}
                revision={revision}
                examId={examId}
                subjectId={subjectId}
                retry={onDismiss}
                retryText="关闭"
              />
            </Card>
          </View>
        </View>
      </Modal>
    );
  if (query.data?.length)
    return (
      <SheetViewerModal
        sheets={query.data}
        onDismiss={onDismiss}
        onLongPress={onLongPress}
        onImageError={(message) => {
          if (selection.kind === 'student' && message === archivedSheetMessage)
            setArchivedKey(selectionKey);
        }}
      />
    );
  return (
    <Modal transparent visible onRequestClose={onDismiss} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: 'rgba(0,0,0,0.6)',
        }}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="关闭图片预览"
        />
        <View onStartShouldSetResponder={() => true}>
          {query.error ? (
            <ErrorCard error={query.error} retry={() => void query.refetch()} />
          ) : (
            <Card>
              <LoadingState label="正在获取作答图片…" />
            </Card>
          )}
        </View>
      </View>
    </Modal>
  );
}
