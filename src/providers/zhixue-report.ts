import { z } from 'zod';
import { ProviderError, type ReportSection } from '../domain/models';
import { throwIfAborted } from '../services/http';
import { parseValidated } from './codec';
import { formatRanking } from '../services/ranking';

const text = z.string().max(4000);
const count = z.number().int().nonnegative();
const tag = z.object({ code: text.optional(), name: text.optional() });
const improvement = z.object({ tag: tag.optional() }).nullish();
const level = z.object({ name: text, lowBound: z.number().finite(), upperBound: z.number().finite() });
const numberRuleSchema = z.object({ ruleObtainType: z.literal(2), leveType: z.literal('NUMBER'), levelList: z.array(level).min(1).max(100) });
const trendScopes = [
  { code: 'clazz', label: '班级', prefix: '班级', countLabel: '班级人数' },
  { code: 'grade', label: '学校', prefix: '年级', countLabel: '学校人数' },
  { code: 'union', label: '联考', prefix: '联考', countLabel: '联考人数' },
] as const;
type TrendRules = Partial<Record<typeof trendScopes[number]['code'], unknown>>;
const trendSchema = z.object({
  chartName: text.optional(), levelList: z.array(level).max(100).optional(), scoreLevelType: z.unknown().optional(),
  list: z.array(z.object({
    tag, title: text.optional(), statTotalNum: count.optional(), totalNum: count.optional(),
    reference: z.object({ content: text.optional() }).nullish(),
    dataList: z.array(z.object({
      id: text.optional(), name: text.optional(), dateDisp: text.optional(),
      dateTime: z.number().finite().min(0).max(8640000000000000 - 8 * 3600000).optional(),
      level: text.optional(), improveBar: improvement,
      statTotalNum: count.optional(), totalNum: count.optional(),
    })).max(100),
  })).max(20),
});
const position = z.number().finite().min(0).max(100).nullish();
const diagnosisSchema = z.object({
  chartName: text.optional(), title: text.optional(), subtitle: text.optional(), tips: text.optional(), subTips: text.optional(),
  tScoreTitle: text.optional(), tScoreDesc: text.optional(),
  list: z.array(z.object({ subjectName: text, myRank: position, rationalRank: position, avgRank: position, showGradeSecondary: z.boolean().optional(), tag: tag.optional() })).max(100),
});
const metric = z.union([z.number().finite(), text]).nullish();
const knowledgeSchema = z.object({
  title: text.optional(), subtitle: text.optional(), tip: text.optional(),
  columnNames: z.object({ secondColumnName: text.optional(), thirdColumnName: text.optional() }).optional(),
  // Field names verified against the official table renderer, not inferred from labels.
  dataList: z.array(z.object({ name: text, score: metric, myScoreAbility: metric })).max(1000),
});
const base = '/zxbReport/report';
const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => parseValidated(schema, raw, '智学网附加报告格式已变化');
const notes = (values: (string | undefined | null)[]) => values.filter((value): value is string => !!value?.trim());

function estimateRank(rawRule: unknown, grade: string | undefined, participants: number | undefined): string | undefined {
  if (!grade || !participants) return undefined;
  const rule = numberRuleSchema.safeParse(rawRule);
  if (!rule.success) return undefined;
  const bands = [...rule.data.levelList].sort((first, second) => first.lowBound - second.lowBound);
  if (bands.some((band, index) => band.lowBound < 0 || band.upperBound > 100 || band.lowBound >= band.upperBound || (index > 0 && band.lowBound < bands[index - 1].upperBound))) return undefined;
  const matches = bands.filter((item) => item.name === grade.trim());
  if (matches.length !== 1) return undefined;
  const band = matches[0];
  if (band.lowBound < 0 || band.upperBound > 100 || band.lowBound >= band.upperBound) return undefined;
  const rank = Math.max(1, Math.floor(participants * band.lowBound / 100 + 1e-9) + 1);
  const rankMax = Math.min(participants, Math.floor(participants * band.upperBound / 100 + 1e-9));
  if (rankMax < rank) return undefined;
  return formatRanking({ rank, rankMax });
}

export function zhixueTrendSections(raw: unknown, rules: TrendRules = {}, currentId?: string): ReportSection[] {
  const data = parse(trendSchema, raw);
  const exams = new Map<string, { timestamp: number; item: NonNullable<ReportSection['items']>[number] }>();
  const groups = data.list.flatMap((group) => {
    const scope = trendScopes.find((scope) => scope.code === group.tag.code);
    if (!scope || !group.dataList.length) return [];
    const points = [...group.dataList].sort((a, b) => (a.dateTime ?? 0) - (b.dateTime ?? 0));
    const current = currentId ? points.find((point) => point.id === currentId) : points[points.length - 1];
    const participantsFor = (point: typeof points[number]): number | undefined => {
      if (scope.code !== 'union') return point.statTotalNum;
      if (!currentId || point.id !== currentId) return undefined;
      if (point.statTotalNum !== undefined && group.statTotalNum === point.statTotalNum) return point.statTotalNum;
      if (point.totalNum !== undefined && group.totalNum === point.totalNum && (point.statTotalNum === undefined || point.statTotalNum === point.totalNum)) return point.totalNum;
      return undefined;
    };
    const highlights: NonNullable<ReportSection['highlights']> = [];
    const participants = current ? participantsFor(current) : undefined;
    if (current) {
      highlights.push({ label: `${scope.label}等第`, value: current.level || '—' });
      highlights.push({ label: scope.countLabel, value: participants === undefined ? '—' : String(participants) });
      const canEstimate = data.scoreLevelType === undefined || data.scoreLevelType === 'number';
      const estimatedRank = canEstimate && currentId && current.id === currentId ? estimateRank(rules[scope.code], current.level, participants) : undefined;
      if (estimatedRank) highlights.push({ label: `${scope.label}排名（预估）`, value: estimatedRank });
    }
    for (const point of points) {
      const date = point.dateTime === undefined ? point.dateDisp : new Date(point.dateTime + 8 * 3600000).toISOString().slice(0, 10);
      const key = JSON.stringify([point.dateTime ?? point.dateDisp ?? null, point.name ?? null,
        point.dateTime === undefined && !point.dateDisp && !point.name ? `${scope.code}-${exams.size}` : null]);
      const record = exams.get(key) ?? { timestamp: point.dateTime ?? 0, item: { label: notes([date, point.name]).join(' · ') || '考试记录', values: {} } };
      if (point.level) record.item.values[`${scope.prefix}等级`] = point.level;
      if (point.improveBar?.tag?.name) record.item.values[`${scope.prefix}变化`] = point.improveBar.tag.name;
      const pointParticipants = participantsFor(point);
      if (pointParticipants !== undefined) record.item.values[`${scope.prefix}统计人数`] = String(pointParticipants);
      exams.set(key, record);
    }
    const summary = current ? notes([group.title, group.reference?.content,
      scope.code === 'union' && participants === undefined ? '联考人数口径缺失或不一致，人数显示为“—”，暂不预估联考排名。' : undefined,
    ]).filter((note) => !note.includes('参考教育部门等级划分规则')) : [];
    return [{ highlights, notes: summary.length ? [`【${scope.label}】${summary.join('\n')}`.replaceAll('统计人数', '人数').replaceAll('等级', '等第').replaceAll('年级', '学校')] : [] }];
  });
  if (!groups.length) return [];
  return [{
    id: 'zhixue-trend', title: data.chartName || '近五次成绩变化',
    highlights: groups.flatMap((group) => group.highlights),
    highlightColumns: groups.some((group) => group.highlights.length === 3) ? 3 : 2,
    highlightRows: groups.map((group) => group.highlights.length).filter((count) => count > 0),
    itemGroups: trendScopes.map((scope) => ({ label: scope.label,
      columns: ['等级', '变化', '统计人数'].map((label) => ({ key: `${scope.prefix}${label}`, label: label === '等级' ? '等第' : label === '统计人数' ? '人数' : label })),
    })),
    notes: groups.flatMap((group) => group.notes),
    collapseNotes: true, notesPosition: 'before-items',
    items: [...exams.values()].sort((first, second) => first.timestamp - second.timestamp).map((record) => record.item),
  }];
}

export function zhixueDiagnosisSection(raw: unknown): ReportSection {
  const data = parse(diagnosisSchema, raw);
  const display = (value: number | null | undefined) => value == null ? null : Math.round((100 - value) * 10) / 10;
  const subjects = data.list.filter((item) => item.myRank != null || item.avgRank != null || (item.showGradeSecondary === false && item.rationalRank != null));
  const sameBaseline = subjects.every((item) => (item.myRank ?? null) === (item.showGradeSecondary === false ? item.rationalRank ?? null : null));
  const series = [
    { label: '本次水平', values: subjects.map((item) => display(item.myRank)) },
    { label: '平时水平', values: subjects.map((item) => item.showGradeSecondary === false ? display(item.rationalRank) : null) },
    { label: '班级中等水平', values: subjects.map((item) => !item.showGradeSecondary ? display(item.avgRank) : null) },
    { label: '年级中等水平', values: subjects.map((item) => item.showGradeSecondary ? display(item.avgRank) : null) },
  ].filter((item) => item.values.some((value) => value != null) && !(item.label === '平时水平' && sameBaseline));
  return {
    id: 'zhixue-subject-diagnosis', title: data.chartName || '发挥水平学科诊断',
    collapseNotes: true, notesPosition: 'bottom',
    notes: notes([data.title, data.subtitle, data.tips, data.subTips, data.tScoreTitle, data.tScoreDesc,
      data.list.some((item) => item.myRank != null || item.avgRank != null || item.rationalRank != null)
        ? '水平刻度越高，表示官方图示水平越高；不等同于分数、实际名次或击败率。' : undefined]),
    radar: subjects.length ? { axes: subjects.map((item) => item.subjectName), series } : undefined,
  };
}

export function zhixueKnowledgeSection(raw: unknown): ReportSection {
  const data = parse(knowledgeSchema, raw);
  return {
    id: 'zhixue-knowledge', title: data.title || '知识点掌握情况',
    notes: notes([data.subtitle, data.tip]),
    items: data.dataList.map((item) => {
      const values: Record<string, string> = {};
      if (item.score != null) values[data.columnNames?.secondColumnName || '知识点权重'] = String(item.score);
      const ability = item.myScoreAbility == null || (typeof item.myScoreAbility === 'string' && !item.myScoreAbility.trim()) ? undefined : Number(item.myScoreAbility);
      if (ability !== undefined && Number.isFinite(ability) && ability >= 0 && ability <= 100) values[data.columnNames?.thirdColumnName || '我的掌握程度'] = `${ability}%`;
      return { label: item.name, values };
    }),
  };
}

type ReportRequest = (path: string, params: Record<string, string | number>) => Promise<unknown>;
export interface ZhixueReportContext { examId: string; start: string; end: string; paperId?: string; subjectCode?: string; }

/** Independent optional sections: one unavailable report must not erase scores or other sections. */
export async function zhixueReportSections(request: ReportRequest, context: ZhixueReportContext, signal?: AbortSignal): Promise<ReportSection[]> {
  const common = { examId: context.examId, ...(context.paperId ? { paperId: context.paperId } : {}) };
  const fail = (id: string, title: string, error: unknown): ReportSection[] => {
    throwIfAborted(signal);
    if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
    if (id === 'zhixue-diagnosis-unavailable') return [];
    if (error instanceof ProviderError && ['RESTRICTED', 'NOT_FOUND'].includes(error.code)) return [];
    return [{ id, title, notes: ['附加报告暂时加载失败，请下拉刷新重试；成绩与答题详情仍可查看。'] }];
  };
  const work: Promise<ReportSection[]>[] = [];
  const load = (id: string, title: string, path: string, params: Record<string, string | number>, map: (raw: unknown) => ReportSection[] | Promise<ReportSection[]>) =>
    request(path, params).then(async (raw) => raw == null || raw === '' ? [] : (await map(raw)).filter((section) =>
      section.radar?.series.length || section.highlights?.length || section.notes?.length || section.items?.some((item) => Object.keys(item.values).length > 0),
    )).catch((error: unknown) => fail(id, title, error));
  work.push(load('zhixue-trend-unavailable', '近五次成绩变化', `${base}/${context.paperId ? 'paper' : 'exam'}/getLevelTrend`, {
    ...common, pageIndex: 1, pageSize: 5, startSchoolYear: context.start, endSchoolYear: context.end,
    ...(context.paperId && context.subjectCode ? { subjectCode: context.subjectCode } : {}),
  }, async (raw) => {
    const trend = parse(trendSchema, raw);
    const subjectCode = context.paperId ? context.subjectCode : '00';
    const rules: TrendRules = {};
    if (subjectCode && (trend.scoreLevelType === undefined || trend.scoreLevelType === 'number')) {
      await Promise.all(trendScopes.map(async ({ code }) => {
        if (!trend.list.some((group) => group.tag.code === code && group.dataList.length)) return;
        try {
          rules[code] = await request('/zhixuebao/report/common/rulesAndCopywriter', { examId: context.examId, code, subjectCode });
        } catch (error) {
          throwIfAborted(signal);
          if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
        }
      }));
    }
    return zhixueTrendSections(raw, rules, context.paperId ?? context.examId);
  }));
  if (!context.paperId) {
    work.push(load('zhixue-diagnosis-unavailable', '发挥水平学科诊断', `${base}/exam/getSubjectDiagnosis`, common, (raw) => [zhixueDiagnosisSection(raw)]));
  }
  if (context.paperId) {
    work.push(load('zhixue-knowledge-unavailable', '知识点掌握情况', `${base}/paper/getExamPointsAndScoringAbility`, common, (raw) => [zhixueKnowledgeSection(raw)]));
  }
  const results = await Promise.all(work);
  throwIfAborted(signal);
  return results.flat();
}
