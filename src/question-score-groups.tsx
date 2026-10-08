import { View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import type { QuestionScore, QuestionScoreSummary } from './domain/models';

export type QuestionImageKind = 'student' | 'answer' | 'stem';
type ImageHandler = (question: QuestionScore, kind: QuestionImageKind) => void;
function QuestionRow({ question, onViewImage }: { question: QuestionScore; onViewImage?: ImageHandler }) {
  const theme = useTheme();
  const result = [question.score, question.maxScore !== undefined ? `/ ${question.maxScore}` : undefined].filter((value): value is string | number => value !== undefined).join(' ');
  const wrong = question.myAnswer !== undefined && question.answer !== undefined && question.myAnswer !== question.answer;
  const correct = question.myAnswer !== undefined && question.answer !== undefined && question.myAnswer === question.answer;
  const answers = question.kind === 'objective' && (question.myAnswer !== undefined || question.answer !== undefined)
    ? <Text variant="bodySmall" style={{ color: wrong ? theme.colors.error : correct ? (theme.dark ? '#81C784' : '#2E7D32') : theme.colors.onSurface }}>
      {question.myAnswer !== undefined ? `我的答案 ${question.myAnswer}` : '未作答'}{question.answer !== undefined ? ` · 正确答案 ${question.answer}` : ''}
    </Text>
    : null;
  const context = question.providerContext;
  const details = [['实测难度', context?.difference], ['校均', context?.schoolAverage], ['班均', context?.classAverage]].filter(([, value]) => value !== undefined && value !== '');
  const resource = (value?: string) => !!value && /^https?:\/\//i.test(value);
  return <View style={{ minHeight: 40, paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ flex: 1 }}>{question.label}</Text>{result ? <Text>{result}</Text> : null}</View>
    {answers}
    {context?.knowledgePoint && <Text variant="bodySmall">知识点：{context.knowledgePoint}</Text>}
    {details.length > 0 && <Text variant="bodySmall">{details.map(([label, value]) => `${label} ${value}`).join(' · ')}</Text>}
    {onViewImage && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {context?.answerImageAvailable === 'true' && <Button compact onPress={() => onViewImage(question, 'student')} accessibilityLabel={`查看${question.label}作答`}>查看作答</Button>}
      {question.kind === 'subjective' && resource(context?.correctAnswer) && <Button compact onPress={() => onViewImage(question, 'answer')}>参考答案</Button>}
      {resource(context?.testImage) && <Button compact onPress={() => onViewImage(question, 'stem')}>查看题干</Button>}
    </View>}
  </View>;
}

/** 汇总来自整科数据；questions 可以是筛选后的小题，不能据此重算或隐藏汇总。 */
export function QuestionScoreGroups({ questions, summaries, onViewImage }: { questions: QuestionScore[]; summaries?: QuestionScoreSummary[]; onViewImage?: ImageHandler }) {
  const grouped = questions.some((question) => question.kind !== undefined) || !!summaries?.length;
  if (!grouped) return <View>{questions.map((question) => <QuestionRow key={question.id} question={question} onViewImage={onViewImage} />)}</View>;
  const other = questions.filter((question) => question.kind === undefined);
  return <View>
    {(['objective', 'subjective'] as const).map((kind) => {
      const items = questions.filter((question) => question.kind === kind);
      const summary = summaries?.find((item) => item.kind === kind);
      if (!items.length && !summary) return null;
      return <View key={kind}>
        <Text variant="titleSmall" style={{ paddingHorizontal: 16, paddingTop: 8 }}>{kind === 'objective' ? '客观题' : '主观题'}{summary ? `（${summary.score}/${summary.maxScore}）` : ''}</Text>
        {items.map((question) => <QuestionRow key={question.id} question={question} onViewImage={onViewImage} />)}
      </View>;
    })}
    {other.length > 0 && <Text variant="titleSmall" style={{ paddingHorizontal: 16, paddingTop: 8 }}>其它题目</Text>}
    {other.map((question) => <QuestionRow key={question.id} question={question} onViewImage={onViewImage} />)}
  </View>;
}
