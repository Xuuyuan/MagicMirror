import { z } from 'zod';
import type { ReportSection } from '../domain/models';

const numeric = z.union([z.number(), z.string(), z.null()]).optional();
export function reportNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
const list = z.array(numeric).optional();
const base = { ErrCount: numeric, scoreShow: numeric, scoreRank: numeric };
export const percentSchema = z.object({ ...base, subName: z.array(z.string()).optional(), myRatings: list, sumscore: list,
  lineRates: z.array(z.object({ lineName: z.string(), rates: list, lineScore: list, lineCount: list })).optional(),
  subSort: z.string().optional(), advSub: z.string().optional(), weakSub: z.string().optional() });
export const compareSchema = z.object({ ...base, cNum: numeric, cCount: numeric, oneCount: numeric, twoCount: numeric, offCount: numeric });
export const linesSchema = z.object({ groupLines: z.array(z.object({ lineName: z.string(), lineScore: numeric, lineRate: numeric, lineCount: numeric, realCount: numeric, edgeScore: numeric, topEdgeScore: numeric, bottomEdgeScore: numeric })).optional(),
  testsPaper: z.object({ TotalScore: numeric, QuestionCount: numeric, Papers: numeric, TestsModel: z.object({ TestDate: z.string().optional() }).optional() }).optional() });
const rateRow = z.object({ InfoTitle: z.string(), scorerate: numeric });
export const questionRatesSchema = z.object({ ...base, dataTable: z.array(z.object({ InfoTitle: z.string(), score: numeric, sumscore: numeric })).optional(), tsubcla: z.array(rateRow).optional(), tsubsch: z.array(rateRow).optional(), tsubtal: z.array(rateRow).optional() });
export const cutSchema = z.object({ errCode: z.coerce.number(), url: z.string().optional() });
const learningPaper = z.object({ subjectName: z.string(), sumScore: numeric, tNum: numeric, score: numeric, snum: numeric, dScore: numeric, nScore: numeric, dnScore: numeric, dnTnum: numeric });
export const learningTotalSchema = z.object({ ...base, papers: z.array(learningPaper).optional(), totalScore: numeric, totalNum: numeric, tScore: numeric, tnum: numeric, dScore: numeric, nScore: numeric, dnScore: numeric, dnTnum: numeric });

function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  return text && !['-', '--'].includes(text) ? text : undefined;
}
function values(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => value === undefined || value === null || value === '' ? [] : [[key, String(value)]]));
}
function percent(value: unknown): string | undefined { const n = reportNumber(value); return n !== undefined && n >= 0 && n <= 100 ? `${n}%` : undefined; }
function available(data: { ErrCount?: unknown } | undefined): boolean { return !!data && (data.ErrCount === undefined || reportNumber(data.ErrCount) === 0); }
function lineLabel(name: string): string { return name.endsWith('线') ? name : `${name}线`; }

export function examReportSections(rates: z.infer<typeof percentSchema> | undefined, compare: z.infer<typeof compareSchema> | undefined, lines: z.infer<typeof linesSchema> | undefined): ReportSection[] {
  const sections: ReportSection[] = [];
  if (available(rates) && rates?.subName?.length) {
    sections.push({ id: 'subject-comparison', title: '学科表现', comparisonMetric: '超过比例', notes: [clean(rates.subSort) && `学科排序：${clean(rates.subSort)}`, clean(rates.advSub) && `优势学科：${clean(rates.advSub)}`, clean(rates.weakSub) && `薄弱学科：${clean(rates.weakSub)}`].filter((s): s is string => !!s),
      items: rates.subName.map((label, i) => ({ label, values: values({ '本人得分': reportNumber(rates.sumscore?.[i]), '超过比例': percent(rates.myRatings?.[i]), ...Object.fromEntries((rates.lineRates ?? []).map(line => [`${lineLabel(line.lineName)}（分数 / 超过比例）`, `${reportNumber(line.lineScore?.[i]) ?? '—'} / ${percent(line.rates?.[i]) ?? '—'}`])) }) })),
      comparisons: rates.subName.map((label, i) => ({ label, series: [{ label: '本人', percent: reportNumber(rates.myRatings?.[i]) }, ...(rates.lineRates ?? []).map(line => ({ label: lineLabel(line.lineName), percent: reportNumber(line.rates?.[i]) }))].filter((s): s is { label: string; percent: number } => s.percent !== undefined && s.percent >= 0 && s.percent <= 100) })) });
  }
  if (available(compare) && compare && reportNumber(compare.scoreRank) !== 0) {
    const rank = reportNumber(compare.cNum); const count = reportNumber(compare.cCount);
    sections.push({ id: 'class-comparison', title: '班级位置', items: [{ label: '班级对比', values: values({ '排名': rank && count ? `${rank} / ${count}` : undefined,
      '超过比例': rank && count && rank <= count && count > 1 ? `${Math.round((count - rank) / (count - 1) * 100)}%` : undefined,
      'A线上人数': reportNumber(compare.oneCount), 'B线区间人数': reportNumber(compare.twoCount), '未上线人数': reportNumber(compare.offCount) }) }] });
  }
  const lineHighlights = lines?.groupLines?.flatMap(line => {
    const score = reportNumber(line.lineScore);
    return score === undefined ? [] : [{ label: lineLabel(line.lineName), value: String(score), unit: '分' }];
  });
  if (lineHighlights?.length) sections.push({ id: 'score-lines', title: '总分分数线', highlights: lineHighlights });
  return sections;
}

export function learningTotalSection(data: z.infer<typeof learningTotalSchema> | undefined): ReportSection | undefined {
  if (!available(data) || !data) return { id: 'learning-total', title: '综合学能分析', notes: ['综合学能分析暂不可用。'] };
  if (reportNumber(data.scoreShow) !== 1) return undefined;
  const rankEnabled = reportNumber(data.scoreRank) === 1;
  const rows = [...(data.papers ?? []), { subjectName: '总分', sumScore: data.totalScore, tNum: data.totalNum, score: data.tScore, snum: data.tnum, dScore: data.dScore, nScore: data.nScore, dnScore: data.dnScore, dnTnum: data.dnTnum }];
  return { id: 'learning-total', title: '综合学能分析', items: rows.map(row => ({ label: row.subjectName, values: values({ '原始分': reportNumber(row.sumScore), '学能分': reportNumber(row.score), '原始分定位': rankEnabled ? percent(row.tNum) : undefined, '学能分定位': rankEnabled ? percent(row.snum) : undefined,
    '应得分': reportNumber(row.dScore), '能力提升分': reportNumber(row.nScore), '理想分': reportNumber(row.dnScore), '理想分定位': rankEnabled ? percent(row.dnTnum) : undefined }) })) };
}

export function questionRateSection(data: z.infer<typeof questionRatesSchema> | undefined): ReportSection | undefined {
  if (!available(data) || !data?.dataTable?.length) return undefined;
  const comparisons = data.dataTable.map(row => {
    const earned = reportNumber(row.score); const max = reportNumber(row.sumscore);
    const other = (list: z.infer<typeof rateRow>[] | undefined) => reportNumber(list?.find(x => x.InfoTitle === row.InfoTitle)?.scorerate);
    return { label: row.InfoTitle, series: [{ label: '本人', percent: earned !== undefined && max && max > 0 ? Math.round(earned / max * 10000) / 100 : undefined }, { label: '班级', percent: other(data.tsubcla) }, { label: '学校', percent: other(data.tsubsch) }, { label: '总体', percent: other(data.tsubtal) }].filter((x): x is { label: string; percent: number } => x.percent !== undefined && x.percent >= 0 && x.percent <= 100) };
  });
  return { id: 'question-rates', title: '题组得分率', comparisons };
}
