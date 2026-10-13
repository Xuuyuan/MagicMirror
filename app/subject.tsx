import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Button, Checkbox, IconButton, List, Text, useTheme } from 'react-native-paper';
import { examResultQueryOptions, subjectQueryOptions, watermarkedAnswerSheetsQueryOptions, essayQueryOptions, debugSubjectFieldsQueryOptions } from '@/src/services/queries';
import { useAccounts } from '@/src/accounts-context';
import { providerRegistry } from '@/src/providers/registry';
import { useAppStore } from '@/src/state/app';
import type { AnswerSheet, SubjectDetail } from '@/src/domain/models';
import { QuestionScoreGroups } from '@/src/question-score-groups';
import { QuestionImagePreview, type QuestionImageSelection } from '@/src/question-image-preview';
import { ReportSections } from '@/src/report-sections';
import { EssaySection } from '@/src/essay-section';
import { GradeBadge } from '@/src/grade-badge';
import { ChapterAnalysis } from '@/src/chapter-analysis';
import { flattenQuestions, isWrongQuestion } from '@/src/services/subjects';
import { AdaptiveSheetImage, SheetViewerModal } from '@/src/sheet-image';
import { SheetActionsSheet } from '@/src/sheet-actions';
import { Screen, Header, Body, Card, ErrorCard, LoadingState, useDoubleTap } from '@/src/ui';
function AnalysisCard({ title, items }: { title: string; items?: { label: string; values: Record<string, string> }[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items?.length) return null;
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="titleMedium">{title}</Text>
      <IconButton style={{ marginVertical: 0 }} icon={expanded ? 'chevron-up' : 'chevron-down'} accessibilityLabel={`${expanded ? '收起' : '展开'}${title}`} onPress={() => setExpanded((value) => !value)} />
    </View>
    {expanded ? items.map((item) => <List.Item key={item.label} title={item.label} titleNumberOfLines={0} description={Object.entries(item.values).map(([key, value]) => `${key} ${value}`).join(' · ')} descriptionNumberOfLines={0} />) : null}
  </Card>;
}
function AnswerDetailsCard({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="titleMedium">答题详情</Text>
      <IconButton style={{ marginVertical: 0 }} icon={expanded ? 'chevron-up' : 'chevron-down'} accessibilityLabel={`${expanded ? '收起' : '展开'}答题详情`} onPress={() => setExpanded(value => !value)} />
    </View>
    {expanded && children}
  </Card>;
}
function SubjectStatistics({ statistics, defeatRates }: { statistics?: SubjectDetail['statistics']; defeatRates?: SubjectDetail['defeatRates'] }) { const theme = useTheme(); const items = statistics?.filter((stat) => stat.scope !== '标准分' && (stat.averageScore !== undefined || stat.participantCount !== undefined || stat.rank !== undefined)) ?? []; const scopeName = (scope: string) => scope === '总排名' ? '联考' : scope === '年级' ? '学校' : scope; const averages = items.filter((stat) => stat.averageScore !== undefined); const rankings = items.filter((stat) => stat.rank !== undefined || stat.participantCount !== undefined); if (!items.length) return null; return <View style={{ gap: 8 }}>{averages.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{averages.map((stat) => <View key={`${stat.scope}-average`} style={{ flex: 1, minWidth: 92, borderRadius: 8, padding: 8, backgroundColor: theme.colors.surface }}><Text variant="labelSmall">{scopeName(stat.scope)}均分</Text><Text variant="bodyLarge">{stat.averageScore}</Text></View>)}</View>}{rankings.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{rankings.map((stat) => { const rate = defeatRates?.find((item) => item.scope === (stat.scope === '班级' ? 'class' : stat.scope === '年级' ? 'grade' : undefined))?.value; return <View key={`${stat.scope}-rank`} style={{ flex: 1, minWidth: 92, minHeight: 72, borderRadius: 8, padding: 8, backgroundColor: theme.colors.surface }}><Text variant="labelSmall">{scopeName(stat.scope)}{stat.rank !== undefined ? '排名' : '人数'}</Text>{stat.rank !== undefined && <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 }}><Text variant="headlineSmall" numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>{stat.rank}</Text>{stat.participantCount !== undefined && <Text variant="bodySmall">/ {stat.participantCount}</Text>}</View>}{stat.rank === undefined && stat.participantCount !== undefined && <Text variant="bodyLarge">{stat.participantCount} 人</Text>}{rate !== undefined && <Text variant="bodySmall">击败率 {rate}%</Text>}</View>; })}</View>}</View>; }
function MarkedSheetSection({ sheets, pending, onPress, onLongPress }: { sheets?: AnswerSheet[]; pending: boolean; onPress: (sheet: AnswerSheet) => void; onLongPress: (sheet: AnswerSheet) => void }) {  // 没有水印版答题卡时不占位：逐题区域已经说明了平台未提供逐题得分，无需再重复一次。
  if (pending || !sheets?.length) return null;
  return <View style={{ gap: 8 }}>
    <Text>平台未提供逐题得分，可查看带分数标注的答题卡（双击放大）：</Text>
    {sheets.map((sheet) => <Pressable key={`${sheet.subject}-${sheet.url}`} onPress={() => onPress(sheet)} onLongPress={() => onLongPress(sheet)}><AdaptiveSheetImage sheet={sheet} /></Pressable>)}
  </View>;
}
/** 仅调试模式显示：平台未与官方界面核对语义的原始字段，不代表正式数据。 */
function DebugFieldsCard({ fields }: { fields?: { label: string; value: string }[] }) {
  if (!fields?.length) return null;
  return <Card>
    <Text variant="titleMedium">调试字段</Text>
    <Text variant="bodySmall">以下平台字段的语义尚未与官方界面核对，仅供排查参考。</Text>
    {fields.map((field) => <View key={field.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text variant="bodySmall" style={{ flexShrink: 1 }}>{field.label}</Text>
      <Text variant="bodySmall">{field.value}</Text>
    </View>)}
  </Card>;
}
export default function Subject() {
  const { accountId, examId, subjectId, subject } = useLocalSearchParams<{ accountId: string; examId: string; subjectId: string; subject: string }>();
  const { accounts } = useAccounts();
  const account = accounts.find((item) => item.id === accountId);
  const revision = account?.revision;
  const queryClient = useQueryClient();
  const [wrongOnly, setWrongOnly] = useState(false);
  const [zoom, setZoom] = useState<AnswerSheet>();
  const [actions, setActions] = useState<AnswerSheet>();
  const [questionImage, setQuestionImage] = useState<QuestionImageSelection>();
  const query = useQuery(subjectQueryOptions(queryClient, accountId, revision, examId, subjectId, subject));
  // 科目查询已获取考试成绩；这里只订阅同一缓存，不另发考试请求。
  const examQuery = useQuery({ ...examResultQueryOptions(accountId, revision, examId), enabled: false });
  const examName = examQuery.data?.examName;
  const noQuestions = !!query.data && !query.data.questions?.length;
  const markedQuery = useQuery({ ...watermarkedAnswerSheetsQueryOptions(queryClient, accountId, revision, examId, subjectId), enabled: !!revision && noQuestions });
  const debugMode = useAppStore((state) => state.debugMode);
  const provider = account ? providerRegistry.get(account.providerId) : undefined;
  const hasEssay = query.data?.providerContext?.hasEssayInfo === 'true';
  const essaySupported = provider?.getEssayDetail !== undefined;
  const essayQuery = useQuery(essayQueryOptions(queryClient, accountId, revision, examId, subjectId, hasEssay && essaySupported));
  const debugQuery = useQuery(debugSubjectFieldsQueryOptions(queryClient, accountId, revision, examId, subjectId, debugMode && provider?.getDebugSubjectFields !== undefined));
  const questions = useMemo(() => { const all = flattenQuestions(query.data?.questions ?? []); return wrongOnly ? all.filter(isWrongQuestion) : all; }, [query.data?.questions, wrongOnly]);
  const handleSheetPress = useDoubleTap<AnswerSheet>((sheet) => setZoom(sheet));
  if (query.isPending) return <Screen><Header title={subject ?? '科目详情'} subtitle={examName} back /><LoadingState label="正在加载科目详情…" /></Screen>;
  if (query.error) return <Screen><Header title={subject ?? '科目详情'} subtitle={examName} back /><Body><ErrorCard error={query.error} retry={() => void query.refetch()} accountId={accountId} /></Body></Screen>;
  const detail = query.data!;
  // 声明了分区的报告卡片（当前只有作文）并入对应功能卡片，其余按普通报告卡片渲染。
  const essaySections = detail.reportSections?.filter((section) => section.placement === 'essay');
  const reportSections = detail.reportSections?.filter((section) => section.placement !== 'essay');
  const originalScore = detail.providerContext?.originalScore && detail.providerContext.scaledScore ? detail.providerContext.originalScore : undefined;
  const gradePercentile = detail.providerContext?.gradePercentile;
  const essayAvg = detail.providerContext?.essayAvg;
  const essayMax = detail.providerContext?.essayMax;
  return <Screen><Header title={detail.subject} subtitle={examName} back /><Body><Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>{detail.score !== undefined && <Text variant="headlineMedium">{detail.score}{detail.maxScore !== undefined && <Text variant="bodyMedium"> / {detail.maxScore}</Text>}</Text>}<GradeBadge providerId={account?.providerId} grade={detail.grade} percentile={gradePercentile} style={{ paddingBottom: 6 }} />{originalScore !== undefined ? <Text variant="bodySmall" style={{ paddingBottom: 4 }}>原始 {originalScore}</Text> : null}</View>{essayAvg !== undefined && <Text>作文：学校均分 {essayAvg}{essayMax !== undefined ? ` · 最高分 ${essayMax}` : ''}</Text>}<SubjectStatistics statistics={detail.statistics} defeatRates={detail.defeatRates} /></Card><ChapterAnalysis items={detail.chapterAnalysis} /><AnalysisCard title="学习能力" items={detail.abilityAnalysis} /><AnalysisCard title="能力分数" items={detail.abilityScoreAnalysis} /><ReportSections sections={reportSections} /><EssaySection essay={essayQuery.data} sections={essaySections} pending={hasEssay && essaySupported && essayQuery.isPending} onView={setZoom} /><AnswerDetailsCard>
    {!!detail.questions?.length && <Checkbox.Item label="只看错题" status={wrongOnly ? 'checked' : 'unchecked'} onPress={() => setWrongOnly((value) => !value)} />}
    {detail.questionNotice && <Text>{detail.questionNotice}</Text>}
    <QuestionScoreGroups questions={questions} summaries={detail.questionScoreSummaries} onViewImage={(question, kind) => setQuestionImage({ question, kind })} />
    {!detail.questions?.length ? <MarkedSheetSection sheets={markedQuery.data} pending={markedQuery.isPending} onPress={handleSheetPress} onLongPress={setActions} /> : !questions.length ? <Text>没有符合条件的题目。</Text> : null}
  </AnswerDetailsCard><View style={{ flexDirection: 'row', gap: 8 }}><Button mode="contained-tonal" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/answer-sheets', params: { accountId, examId, subjectId } })}>查看答题卡</Button>{provider?.getPaperImages !== undefined ? <Button mode="contained-tonal" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/exam-papers', params: { accountId, examId, subjectId } })}>查看原卷</Button> : null}</View>{debugMode ? <DebugFieldsCard fields={debugQuery.data} /> : null}</Body><QuestionImagePreview selection={questionImage} accountId={accountId} revision={revision} examId={examId} subjectId={detail.subjectId} headers={detail.answerSheets?.[0]?.headers} onDismiss={() => setQuestionImage(undefined)} onLongPress={setActions} /><SheetViewerModal sheet={zoom} onDismiss={() => setZoom(undefined)} onLongPress={setActions} /><SheetActionsSheet sheet={actions} onDismiss={() => setActions(undefined)} /></Screen>;
}
