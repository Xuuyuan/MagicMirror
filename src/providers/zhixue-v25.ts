import { z } from 'zod';
import { ProviderError, type ReportSection, type QuestionScore } from '../domain/models';
import { parseValidated } from './codec';
import { throwIfAborted } from '../services/http';

export type ReportRequest = (
  path: string,
  params: Record<string, string | number>,
) => Promise<unknown>;
const modulesSchema = z.array(z.object({ code: z.string().min(1) })).max(100);
const permissionSchema = z.object({
  showScoreFlag: z.boolean(),
  showLevelFlag: z.boolean(),
  showScoreRateTrendFlag: z.boolean().default(false),
  myScoringRate: z.boolean().default(false),
  classScoreRate: z.boolean().default(false),
  gradeScoreRate: z.boolean().default(false),
});
const planSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal('legacy'), modules: z.array(z.string()) }),
  z.object({
    version: z.literal('v25'),
    modules: z.array(z.string()),
    permissions: permissionSchema,
  }),
]);
export type ZhixueReportPlan = z.infer<typeof planSchema>;
const parse = <T>(schema: z.ZodType<T>, raw: unknown): T =>
  parseValidated(schema, raw, '智学网报告格式已变化，请重试');
export const parseReportPlan = (raw: unknown) => parse(planSchema, raw);

export async function resolveReportPlan(
  modern: ReportRequest,
  legacy: ReportRequest,
  examId: string,
): Promise<ZhixueReportPlan> {
  let modules: string[];
  try {
    modules = parse(
      modulesSchema,
      await modern('common/getModules', {
        examId,
        tag: 'ZXB_REPORT_EXAM_V25',
        reportTag: 'ZXB_NEW_REPORT',
      }),
    ).map((m) => m.code);
  } catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'UNSUPPORTED') throw error;
    modules = [];
  }
  if (modules.some((code) => code.endsWith('_v2025'))) {
    const permissions = parse(
      permissionSchema,
      await modern('common/queryModuleIndicatorPermission', { examId }),
    );
    return { version: 'v25', modules, permissions };
  }
  if (!modules.includes('completeReportMain'))
    modules = parse(
      modulesSchema,
      await legacy('/zxbReport/report/common/getModules', {
        examId,
        tag: 'ZXB_REPORT_EXAM',
        reportTag: 'ZXB_NEW_REPORT',
      }),
    ).map((m) => m.code);
  if (!modules.includes('completeReportMain'))
    throw new ProviderError('UNSUPPORTED', '本场考试暂未提供支持的报告');
  return { version: 'legacy', modules };
}

export async function paperReportPlan(
  request: ReportRequest,
  plan: Extract<ZhixueReportPlan, { version: 'v25' }>,
  examId: string,
) {
  const permissions = parse(
    permissionSchema,
    await request('common/queryModuleIndicatorPermission', { examId }),
  );
  const modules = parse(
    modulesSchema,
    await request('common/getModules', {
      examId,
      tag: 'ZXB_REPORT_PAPER_V25',
      reportTag: 'ZXB_NEW_REPORT',
    }),
  ).map((m) => m.code);
  return { ...plan, modules, permissions };
}
export const v25Controls = z.object({
  setLevel: z.boolean(),
  showDownloadOriginalPaper: z.boolean(),
  showKnowledge: z.boolean(),
});
export function readControls(context?: Record<string, string>) {
  return {
    setLevel: context?.setLevel === 'true',
    showDownloadOriginalPaper: context?.showDownloadOriginalPaper === 'true',
    showKnowledge: context?.showKnowledge === 'true',
  };
}
const balanceSchema = z.object({
  chartName: z.string().optional(),
  list: z
    .array(
      z.object({
        subjectName: z.string().min(1),
        thisLevel: z.number().finite().nullish(),
        usualLevel: z.number().finite().nullish(),
        mediumLevel: z.number().finite().nullish(),
      }),
    )
    .max(100),
});
export function balanceSection(raw: unknown): ReportSection {
  const data = parse(balanceSchema, raw);
  const values = data.list
    .flatMap((p) => [p.thisLevel, p.usualLevel, p.mediumLevel])
    .filter((n): n is number => n != null);
  const bound = values.length ? Math.floor(Math.max(...values.map(Math.abs))) + 1 : 3;
  if (bound > 1000) throw new ProviderError('UNKNOWN', '智学网学科水平超出支持范围');
  const series = [
    { label: '本次水平', values: data.list.map((p) => p.thisLevel ?? null) },
    { label: '平时水平', values: data.list.map((p) => p.usualLevel ?? null) },
    { label: '年级中等水平', values: data.list.map((p) => p.mediumLevel ?? null) },
  ].filter((s) => s.values.some((n) => n != null));
  const same = data.list.every((p) => (p.thisLevel ?? null) === (p.usualLevel ?? null));
  return {
    id: 'zhixue-subject-balance',
    title: data.chartName || '学科均衡',
    radar: {
      axes: data.list.map((p) => p.subjectName),
      series: series.filter((s) => !same || s.label !== '平时水平'),
      scale: { min: -bound, max: bound, reference: 0 },
    },
    notes: ['学生水平值表示学生在年级中的相对位置，不等同于分数、实际名次或击败率。'],
    collapseNotes: true,
    notesPosition: 'bottom',
  };
}
const trendSchema = z.object({
  chartName: z.string().optional(),
  list: z
    .array(
      z.object({
        dataList: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().optional(),
              dateDisp: z.string().optional(),
              dateTime: z.number().finite().optional(),
              level: z.string(),
            }),
          )
          .max(100),
      }),
    )
    .max(20),
});
export function v25Trend(raw: unknown, currentId: string, grade?: string): ReportSection {
  const data = parse(trendSchema, raw);
  const points = data.list[0]?.dataList ?? [];
  return {
    id: 'zhixue-v25-level-trend',
    title: data.chartName || '等级变化',
    notes: ['成绩单等级趋势；当前记录以本场主报告等级为准，不表示班级名次。'],
    collapseNotes: true,
    items: [...points]
      .sort((a, b) => (a.dateTime ?? 0) - (b.dateTime ?? 0))
      .map((p) => ({
        label: p.name || p.dateDisp || '考试',
        values: {
          等级: p.id === currentId && grade ? grade : p.level,
          ...(p.dateDisp ? { 日期: p.dateDisp } : {}),
        },
      })),
  };
}
export function v25MetricTrend(
  raw: unknown,
  kind: 'standard' | 'rate',
  permissions: Extract<ZhixueReportPlan, { version: 'v25' }>['permissions'],
): ReportSection {
  const schema = z.object({
    dataList: z
      .array(
        z.object({
          name: z.string().optional(),
          dateDisp: z.string().optional(),
          standardScore: z.number().finite().nullish(),
          myScoreRate: z.number().min(0).max(1).nullish(),
          classScoreRate: z.number().min(0).max(1).nullish(),
          gradeScoreRate: z.number().min(0).max(1).nullish(),
        }),
      )
      .max(100),
  });
  const data = parse(schema, raw);
  return {
    id: 'zhixue-v25-' + kind + '-trend',
    title: kind === 'standard' ? '标准分变化' : '得分率变化',
    items: data.dataList.map((p) => {
      const values: Record<string, string> = {};
      if (kind === 'standard' && p.standardScore != null)
        values['标准分'] = String(p.standardScore);
      for (const [flag, key, label] of [
        ['myScoringRate', 'myScoreRate', '本人'],
        ['classScoreRate', 'classScoreRate', '班级'],
        ['gradeScoreRate', 'gradeScoreRate', '学校'],
      ] as const)
        if (kind === 'rate' && permissions[flag] && p[key] != null)
          values[label + '得分率'] = `${Math.round(p[key]! * 1000) / 10}%`;
      return { label: p.name || p.dateDisp || '考试', values };
    }),
  };
}
export async function v25Sections(
  request: ReportRequest,
  plan: Extract<ZhixueReportPlan, { version: 'v25' }>,
  context: {
    examId: string;
    paperId?: string;
    subjectCode?: string;
    start: string;
    end: string;
    setLevel: boolean;
    grade?: string;
    subjectCount: number;
    standard?: boolean;
  },
  signal?: AbortSignal,
): Promise<ReportSection[]> {
  const result: ReportSection[] = [];
  const load = async (fn: () => Promise<ReportSection>) => {
    try {
      result.push(await fn());
    } catch (error) {
      throwIfAborted(signal);
      if (!(error instanceof ProviderError) || error.code === 'SESSION_EXPIRED') throw error;
      if (!['RESTRICTED', 'NOT_FOUND'].includes(error.code))
        result.push({
          id: 'zhixue-v25-unavailable-' + result.length,
          title: '附加报告',
          notes: ['附加报告暂时加载失败，可下拉刷新重试。'],
        });
    }
  };
  if (
    !context.paperId &&
    context.setLevel &&
    plan.permissions.showLevelFlag &&
    plan.modules.includes(context.paperId ? 'paperLevelTrend_v2025' : 'examLevelTrend_v2025')
  )
    await load(async () =>
      v25Trend(
        await request('exam/getLevelTrend', {
          examId: context.examId,
          paperId: context.paperId ?? '',
          subjectCode: context.subjectCode ?? '00',
          startSchoolYear: context.start,
          endSchoolYear: context.end,
          pageIndex: 1,
          pageSize: 5,
        }),
        context.paperId ?? context.examId,
        context.grade,
      ),
    );
  const hasTrend = plan.modules.includes(
    context.paperId ? 'paperLevelTrend_v2025' : 'examLevelTrend_v2025',
  );
  const metricParams = {
    examId: context.examId,
    paperId: context.paperId ?? '',
    subjectCode: context.subjectCode ?? '00',
    startSchoolYear: context.start,
    endSchoolYear: context.end,
    pageIndex: 1,
    pageSize: 5,
  };
  if (hasTrend && context.standard)
    await load(async () =>
      v25MetricTrend(
        await request('exam/getStandardTrend', metricParams),
        'standard',
        plan.permissions,
      ),
    );
  if (
    hasTrend &&
    plan.permissions.showScoreRateTrendFlag &&
    (plan.permissions.myScoringRate ||
      plan.permissions.classScoreRate ||
      plan.permissions.gradeScoreRate)
  )
    await load(async () =>
      v25MetricTrend(
        await request('exam/getScoreRateTrend', metricParams),
        'rate',
        plan.permissions,
      ),
    );
  if (
    !context.paperId &&
    context.subjectCount > 2 &&
    plan.modules.includes('examSubjectBalance_v2025')
  )
    await load(async () =>
      balanceSection(await request('exam/getSubjectBalance', { examId: context.examId })),
    );
  throwIfAborted(signal);
  return result;
}
const answerSchema = z.object({
  answerInfoDTOList: z
    .array(
      z.object({
        topicNumber: z.union([z.number().int(), z.string()]),
        dispTitle: z.string(),
        score: z.number().finite().nonnegative().nullish(),
        standardScore: z.number().finite().nonnegative().nullish(),
        sectionName: z.string().optional(),
        gradeAvgScore: z.number().finite().nonnegative().nullish(),
      }),
    )
    .max(10000),
});
const objectAnswerSchema = z
  .array(
    z.object({
      dispTitle: z.union([z.string(), z.number()]).nullish(),
      answer: z.string().nullish(),
      standardAnswer: z.string().nullish(),
      topicNumber: z.union([z.number().int(), z.string()]).nullish(),
    }),
  )
  .max(10000);
export function v25ObjectAnswers(raw: unknown): Map<string, string> {
  const data = parse(z.object({ objectAnswer: objectAnswerSchema.optional() }).passthrough(), raw);
  const map = new Map<string, string>();
  for (const row of data.objectAnswer ?? []) {
    const answer = row.standardAnswer ?? row.answer;
    if (answer != null) {
      const id = String(row.topicNumber ?? row.dispTitle ?? '');
      if (id) map.set(id, answer);
    }
  }
  return map;
}
export function v25Questions(
  raw: unknown,
  sheetQuestions: QuestionScore[] = [],
  correctAnswers = new Map<string, string>(),
): QuestionScore[] {
  const data = parse(answerSchema, raw);
  return data.answerInfoDTOList.map((q) => {
    const id = String(q.topicNumber),
      sheet = sheetQuestions.find((s) => s.id === id);
    return {
      ...sheet,
      id,
      label: q.dispTitle || id,
      score: q.score ?? undefined,
      maxScore: q.standardScore ?? undefined,
      ...(correctAnswers.has(id) ? { answer: correctAnswers.get(id) } : {}),
      ...(q.gradeAvgScore != null
        ? {
            providerContext: {
              ...sheet?.providerContext,
              schoolAverage: String(Math.round((q.gradeAvgScore + Number.EPSILON) * 100) / 100),
            },
          }
        : {}),
    };
  });
}
export function v25AverageScore(raw: unknown): number | undefined {
  const rows = parse(answerSchema, raw).answerInfoDTOList;
  if (
    !rows.length ||
    rows.some((q) => q.gradeAvgScore == null) ||
    new Set(rows.map((q) => String(q.topicNumber))).size !== rows.length
  )
    return undefined;
  return (
    Math.round((rows.reduce((sum, q) => sum + q.gradeAvgScore!, 0) + Number.EPSILON) * 100) / 100
  );
}
export function normalizeV25Sheet(raw: unknown): unknown {
  const sheet = parse(
    z
      .object({
        sheetImages: z.array(z.string().url()).max(1000),
        sheetDatas: z.string(),
        showSingleTopicScore: z.boolean(),
        showSingleCorrectTag: z.boolean(),
        answerSheetLocation: z.string().optional(),
      })
      .passthrough(),
    raw,
  );
  const flag = z
    .union([z.boolean(), z.literal(0), z.literal(1), z.enum(['', 'true', 'false', '0', '1'])])
    .nullish()
    .transform((v) =>
      v == null || v === '' ? undefined : v === true || v === 1 || v === 'true' || v === '1',
    );
  const record = z
    .object({ isCandidate: flag, isSelected: flag, subTopics: z.unknown().optional() })
    .passthrough();
  let decoded: unknown;
  try {
    decoded = JSON.parse(sheet.sheetDatas);
  } catch {
    throw new ProviderError('UNKNOWN', '智学网答题记录格式已变化');
  }
  const data = parse(
    z
      .object({
        userAnswerRecordDTO: z
          .object({ answerRecordDetails: z.array(record).max(10000) })
          .passthrough(),
      })
      .passthrough(),
    decoded,
  );
  const records = data.userAnswerRecordDTO.answerRecordDetails.map((r) => {
    let subTopics = r.subTopics;
    if (typeof subTopics === 'string') {
      try {
        subTopics = subTopics.trim() ? JSON.parse(subTopics) : undefined;
      } catch {
        throw new ProviderError('UNKNOWN', '智学网子题格式已变化');
      }
    }
    return { ...r, subTopics };
  });
  return {
    ...sheet,
    sheetDatas: JSON.stringify({
      ...data,
      userAnswerRecordDTO: { ...data.userAnswerRecordDTO, answerRecordDetails: records },
    }),
  };
}
