import { useQuery } from '@tanstack/react-query';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { ProviderError, type AnswerSheet, type QuestionScore } from './domain/models';
import type { QuestionImageKind } from './question-score-groups';
import { withAccount } from './services/accounts';
import { SheetViewerModal } from './sheet-image';
import { Card, ErrorCard, LoadingState } from './ui';

export interface QuestionImageSelection { question: QuestionScore; kind: QuestionImageKind; }
export function QuestionImagePreview({ selection, accountId, revision, examId, subjectId, headers, onDismiss, onLongPress }: {
  selection?: QuestionImageSelection; accountId: string; revision?: string; examId: string; subjectId: string; headers?: Record<string, string>; onDismiss: () => void; onLongPress: (sheet: AnswerSheet) => void;
}) {
  const query = useQuery({
    queryKey: ['account', accountId, revision, 'question-image', examId, subjectId, selection?.question.id, selection?.kind],
    enabled: !!selection && !!revision, staleTime: 0, retry: 1,
    queryFn: async ({ signal }): Promise<AnswerSheet> => {
      if (!selection) throw new ProviderError('NOT_FOUND', '请选择题目');
      const { question, kind } = selection;
      if (kind === 'student') return withAccount(accountId, (provider, session, requestSignal) => {
        if (!provider.getQuestionAnswerSheet) throw new ProviderError('UNSUPPORTED', '平台未提供逐题作答图片');
        return provider.getQuestionAnswerSheet(session, examId, subjectId, question.id, { signal: requestSignal });
      }, signal);
      const url = kind === 'answer' ? question.providerContext?.correctAnswer : question.providerContext?.testImage;
      if (!url || !/^https?:\/\//i.test(url)) throw new ProviderError('NOT_FOUND', '平台未提供此题图片');
      return { subject: question.label, subjectId, url, watermarked: false, headers };
    },
  });
  if (!selection) return null;
  if (query.data) return <SheetViewerModal sheet={query.data} onDismiss={onDismiss} onLongPress={() => onLongPress(query.data)} />;
  return <Modal transparent visible onRequestClose={onDismiss} statusBarTranslucent><View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.6)' }}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="关闭图片预览" />
    <View onStartShouldSetResponder={() => true}>
      {query.error ? <ErrorCard error={query.error} retry={() => void query.refetch()} /> : <Card><LoadingState label="正在获取作答图片…" /></Card>}
    </View>
  </View></Modal>;
}
