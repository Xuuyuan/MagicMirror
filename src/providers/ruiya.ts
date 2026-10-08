import { getRandomBytes } from 'expo-crypto';
import { z } from 'zod';
import { ProviderError, type AnswerSheet, type AuthSession, type ExamResult, type ExamSummary, type StudentProfile, type SubjectScore, type QuestionScore, type QuestionScoreSummary } from '../domain/models';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import { clearPlatformCookies } from '../services/platform-cookies';
import { embeddedImageData } from '../domain/image-uri';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { bytesToBase64, rsaEncryptPkcs1, utf8ToBytes } from './codec';
import { compareSchema, cutSchema, examReportSections, learningTotalSchema, learningTotalSection, linesSchema, percentSchema, questionRateSection, questionRatesSchema, reportNumber } from './ruiya-report-analysis';

const defaultHost = 'https://ruiya.onlyets.com';
const defaultProviderId = 'ruiya';
export interface RuiyaProviderOptions { host?: string; providerId?: string; platformLabel?: string; system?: string; allowedHosts?: string[]; extendedReports?: boolean; abilityScoreAction?: 'getAbilityScore' | 'getByAbilityScore';
  /**
   * 会话 Cookie 交给系统 Cookie 容器保存。
   *
   * 百分智登录会跳转到另一台主机（bfzks.xueqingroom.cn），会话 Cookie 由中间 302 下发；
   * React Native 的 fetch 忽略 redirect:'manual'，重定向在原生层自动跟随且默认不保存 Cookie，
   * 手工 Cookie 无法拿到中间响应，登录后必然停留在未登录占位页。开启后整条链路依赖容器携带 Cookie。
   */
  platformCookieJar?: boolean; }
const publicModulus = BigInt('0xBB3EA1C5D21B0648107537780189065167F1019EF3BF655C2FBF4D58F8D111744B76FAD32A0C6B1E57B14939709FCCC11A88E5F0CAF678B5962C27C53B6707120BFB8CE5C9937E469D6BD0B1D225F046C8647FC029B504C41FFE8F83311AE9C9F1C16C14C3346EA9A7F333F540F0CCF586D0481C73E815B57DD88BCD9E9A1639');
const publicExponent = 65537n;
const papersResponseSchema = z.object({ papers: z.array(z.object({ pic_url: z.string().nullable().optional(), watermark_url: z.string().nullable().optional(), watermak_pic_url: z.string().nullable().optional() })).optional() }).passthrough();
const tsubsResponseSchema = z.object({ ErrCount: z.coerce.number().optional(), TotalSize: z.coerce.number().int().nonnegative().optional(), tSubList: z.array(z.object({ id: z.union([z.string(), z.number()]).optional(), no: z.string().nullable().optional(), mScore: z.unknown().optional(), tScore: z.unknown().optional(), mDiff: z.unknown().optional(), sScore: z.unknown().optional(), cScore: z.unknown().optional(), zhiShiDian: z.string().nullable().optional(), testImg: z.string().nullable().optional(), mAnswer: z.string().nullable().optional(), tAnswer: z.string().nullable().optional(), type: z.unknown().optional(), videoPath: z.string().nullable().optional() }).passthrough()).optional() }).passthrough();
const chapterResponseSchema = z.object({ ErrCount: z.number().optional(), aName: z.string().optional(), bName: z.string().optional(), chtNote: z.string().optional(), chtList: z.array(z.object({ title: z.string().optional(), tScore: z.unknown().optional(), aStandard: z.unknown().optional(), bStandard: z.unknown().optional(), mScore: z.unknown().optional(), sLevel: z.unknown().optional() }).passthrough()).optional(), chtSum: z.record(z.string(), z.unknown()).optional() }).passthrough();
const abilityResponseSchema = z.object({ ErrCount: z.number().optional(), content: z.string().optional(), aAblityName: z.string().optional(), bAblityName: z.string().optional(), title: z.array(z.string()).optional(), sumscore: z.array(z.unknown()).optional(), aAblity: z.array(z.unknown()).optional(), bAblity: z.array(z.unknown()).optional(), score: z.array(z.unknown()).optional(), mAblity: z.array(z.unknown()).optional() }).passthrough();
const abilityScoreResponseSchema = z.object({ ErrCount: z.number().optional(), scoreShow: z.unknown().optional(), dScore: z.array(z.unknown()).optional(), nScore: z.array(z.unknown()).optional(), cScore: z.array(z.unknown()).optional(), stuSumScore: z.unknown().optional(), sumscore: z.unknown().optional(), tNum: z.unknown().optional(), tnum: z.unknown().optional(), scoreRank: z.unknown().optional() }).passthrough();
const resultsResponseSchema = z.object({ scoreShow: z.number().optional(), Results: z.array(z.object({ subID: z.union([z.string(), z.number()]).optional(), subName: z.string(), SumScore: z.unknown().optional(), comdSumScore: z.unknown().optional(), levelName: z.string().optional(), cNum: z.union([z.string(), z.number()]).optional(), cCount: z.unknown().optional(), cAvgScore: z.unknown().optional(), sNum: z.union([z.string(), z.number()]).optional(), sCount: z.unknown().optional(), sAvgScore: z.unknown().optional(), tNum: z.union([z.string(), z.number()]).optional(), tCount: z.unknown().optional(), tAvgScore: z.unknown().optional(), StdScore: z.unknown().optional(), lineLevel: z.string().optional() }).passthrough()).optional() }).passthrough();
const sortResponseSchema = z.object({ scoreShow: z.unknown().optional(), sSort: z.unknown().optional(), oSort: z.unknown().optional() }).passthrough();

function rsaEncrypt(value: string): string {
  const message = utf8ToBytes(value);
  if (message.length > 117) throw new ProviderError('UNKNOWN', '平台登录密码长度不受支持');
  return bytesToBase64(rsaEncryptPkcs1(message, publicModulus, publicExponent, (size) => getRandomBytes(size)));
}

function htmlText(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function hidden(html: string, name: string): string { const match = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)`, 'i').exec(html); if (!match) throw new ProviderError('UNKNOWN', '平台登录页面缺少必要字段'); return match[1]; }
function reportSign(html: string): string { const match = /id=["']hncSign["'][^>]*value=["']([^"']*)/i.exec(html) ?? /value=["']([^"']*)["'][^>]*id=["']hncSign["']/i.exec(html); if (!match?.[1]) throw new ProviderError('UNKNOWN', '平台报告缺少访问签名'); return match[1]; }
function reportLinks(html: string): ExamSummary[] {
  const results: ExamSummary[] = []; const pattern = /<a[^>]+href=["'](\/report\/singleGroup\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) { const id = match[1].split('/').pop(); if (id && !results.some((item) => item.id === id)) results.push({ id, name: htmlText(match[2]), hasResult: true }); }
  const unopenedPattern = /<div[^>]+id=["'](day_[^"']+)["'][^>]*>([\s\S]*?)(?=<div[^>]+id=["']day_|$)/gi;
  while ((match = unopenedPattern.exec(html))) {
    // 同一报告块已有可访问链接时，以开放状态为准，忽略其他入口的提示。
    if (/href=["']\/report\/singleGroup\//i.test(match[2])) continue;
    if (!/<a\b[^>]*href=["']javascript:[^>]*>(?:(?!<\/a>)[\s\S])*未开放(?:(?!<\/a>)[\s\S])*<\/a>/i.test(match[2])) continue;
    const titles = Array.from(match[2].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi), (item) => htmlText(item[1])).filter(Boolean);
    const name = (titles.find((item) => /报告|测评/.test(item)) ?? titles.sort((left, right) => right.length - left.length)[0] ?? '未开放考试').replace(/\s*年级：[^\s]+\s*$/, '').replace(/\s*测评报告\s*$/, '').trim();
    const id = `unopened-${encodeURIComponent(match[1])}`;
    if (!results.some((item) => item.id === id)) results.push({ id, name, availability: 'unavailable' });
  }
  return results;
}
function reportTitle(html: string): string | undefined { const title = /《([^》]+)》/.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]; return title ? htmlText(title).replace(/\s*测评报告\s*$/, '').trim() : undefined; }
function answerSheetLinks(html: string, host: string, subject: string, subjectId: string, headers?: Record<string, string>): AnswerSheet[] {
  const urls = Array.from(html.matchAll(/href=["']([^"']*\/api\/single\/StudentNoImageSheet\/[^"']+\.png)["']/gi), (match) => match[1]);
  return Array.from(new Set(urls)).map((url) => ({ subject, subjectId, url: new URL(url, host).toString(), watermarked: false, headers }));
}
function subjectIdCandidates(html: string, subjectId: string, subject: string): string[] {
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<li[^>]+id=["']li(\\d+)["'][^>]*>(?:(?!<\\/li>)[\\s\\S])*?<a[^>]*>\\s*${escaped}\\s*</a>`, 'i').exec(html);
  const dataPaper = new RegExp(`<a[^>]+data-paper=["']([^"']+)["'][^>]*>\\s*${escaped}\\s*</a>`, 'i').exec(html)?.[1]
    ?? (match ? new RegExp(`<li[^>]+id=["']li${match[1]}["'][^>]*>[\\s\\S]*?<a[^>]+data-paper=["']([^"']+)["']`, 'i').exec(html)?.[1] : undefined);
  return Array.from(new Set([dataPaper, match?.[1], subjectId].filter((value): value is string => !!value)));
}
function reportSubject(html: string, subjectId: string): string | undefined {
  const entries = Array.from(html.matchAll(/<li[^>]+id=["']li(\d+)["'][^>]*>[\s\S]*?<a[^>]*>\s*([^<]+?)\s*<\/a>/gi), (match) => ({ id: match[1], subject: htmlText(match[2]) })).filter((item) => item.id !== '0');
  const ordinal = Number(subjectId);
  return entries.find((item) => item.id === subjectId)?.subject ?? (Number.isInteger(ordinal) && ordinal > 0 ? entries[ordinal - 1]?.subject : undefined);
}
function tableRows(html: string, id: string): string[][] {
  const table = new RegExp(`<table[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/table>`, 'i').exec(html)?.[1]; if (!table) return [];
  return Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi), (row) => Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi), (cell) => htmlText(cell[1])));
}
function score(value: string): { value?: number; scaled?: number } { const values = value.split('\\').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)); return { value: values[0], scaled: values[1] }; }
function parseResult(html: string, examId: string): ExamResult {
  const title = reportTitle(html);
  const rows = tableRows(html, 'tab_score'); if (!title || rows.length < 2) throw new ProviderError('UNKNOWN', '平台成绩响应结构不符合预期');
  const dataRows = rows.slice(1).filter((row) => row.length >= 2); const total = dataRows.find((row) => row[0] === '总分'); const totalScore = total ? score(total[1]) : {};
  const subjects = dataRows.filter((row) => row[0] !== '总分').map((row) => { const values = score(row[1]); return { subject: row[0], score: values.scaled ?? values.value, grade: row[7] || undefined, providerContext: values.value !== undefined && values.scaled !== undefined ? { originalScore: String(values.value), scaledScore: String(values.scaled) } : undefined }; });
  const rank = total?.[5]?.match(/^(\d+)\s*\//); const rankTotal = total?.[5]?.match(/\/\s*(\d+)/);
  return { examId, examName: htmlText(title), subjects, totalScore: totalScore.scaled ?? totalScore.value, originalTotalScore: totalScore.value !== undefined && totalScore.scaled !== undefined ? totalScore.value : undefined, maxTotalScore: undefined, ranking: rank && rankTotal ? { rank: Number(rank[1]), total: Number(rankTotal[1]), scope: 'group' } : undefined };
}
function parseResults(data: z.infer<typeof resultsResponseSchema>, examId: string): ExamResult {
  const rows = data.Results ?? [];
  const total = rows.find((row) => row.subName === '总分');
  if (!total || rows.length < 2) throw new ProviderError('UNKNOWN', '平台成绩响应结构不符合预期');
  const totalValue = numberValue(total.SumScore); const totalScaled = numberValue(total.comdSumScore);
  const subjects = rows.filter((row) => row.subName !== '总分').map((row) => {
    const value = numberValue(row.SumScore); const scaled = numberValue(row.comdSumScore);
    const context: Record<string, string> = {};
    if (value !== undefined) context.originalScore = String(value);
    if (scaled !== undefined && scaled !== -1) context.scaledScore = String(scaled);
    if (numberValue(row.cAvgScore) !== undefined) context.classAverage = String(numberValue(row.cAvgScore));
    if (numberValue(row.sAvgScore) !== undefined) context.gradeAverage = String(numberValue(row.sAvgScore));
    if (numberValue(row.tAvgScore) !== undefined) context.groupAverage = String(numberValue(row.tAvgScore));
    const classRanking = parseRanking(row.cNum, row.cCount); const gradeRanking = parseRanking(row.sNum, row.sCount); const groupRanking = parseRanking(row.tNum, row.tCount);
    if (classRanking) { context.classRank = String(classRanking.rank); context.classCount = String(classRanking.total); } else if (rankingPosition(row.cNum) !== undefined) context.classRank = String(rankingPosition(row.cNum));
    if (gradeRanking) { context.gradeRank = String(gradeRanking.rank); context.gradeCount = String(gradeRanking.total); } else if (rankingPosition(row.sNum) !== undefined) context.gradeRank = String(rankingPosition(row.sNum));
    if (groupRanking) { context.groupRank = String(groupRanking.rank); context.groupCount = String(groupRanking.total); } else if (rankingPosition(row.tNum) !== undefined) context.groupRank = String(rankingPosition(row.tNum));
    if (numberValue(row.StdScore) !== undefined) context.standardScore = String(numberValue(row.StdScore));
    return { id: row.subID === undefined ? undefined : String(row.subID), subject: row.subName, score: scaled !== undefined && scaled !== -1 ? scaled : value, grade: row.lineLevel, providerContext: Object.keys(context).length ? context : undefined };
  });
  const ranking = parseRanking(total.tNum, total.tCount) ?? parseRanking(total.sNum, total.sCount) ?? parseRanking(total.cNum, total.cCount);
  const statistics = [
    { scope: '班级', averageScore: numberValue(total.cAvgScore), participantCount: parseRanking(total.cNum, total.cCount)?.total, rank: rankingPosition(total.cNum) },
    { scope: '年级', averageScore: numberValue(total.sAvgScore), participantCount: parseRanking(total.sNum, total.sCount)?.total, rank: rankingPosition(total.sNum) },
    { scope: '总排名', averageScore: numberValue(total.tAvgScore), participantCount: parseRanking(total.tNum, total.tCount)?.total, rank: rankingPosition(total.tNum) },
  ].filter((item) => item.averageScore !== undefined || item.participantCount !== undefined || item.rank !== undefined);
  return { examId, examName: '', subjects, totalScore: totalScaled !== -1 ? totalScaled ?? totalValue : totalValue, originalTotalScore: totalValue !== undefined && totalScaled !== undefined && totalScaled !== -1 ? totalValue : undefined, maxTotalScore: undefined, statistics: statistics.length ? statistics : undefined, ranking: ranking ? { ...ranking, scope: 'group' } : undefined };
}
function parseRanking(value: unknown, separateTotal?: unknown): { rank: number; total: number } | undefined {
  const match = String(value ?? '').match(/^(\d+)\s*[\/／]\s*(\d+)/); const rank = match ? Number(match[1]) : rankingPosition(value); const total = match ? Number(match[2]) : numberValue(separateTotal);
  return rank !== undefined && total !== undefined && rank > 0 && total > 0 ? { rank, total } : undefined;
}
function rankingPosition(value: unknown): number | undefined { const match = String(value ?? '').match(/^(\d+)/); const rank = match ? Number(match[1]) : undefined; return rank !== undefined && rank > 0 ? rank : undefined; }
function parseRankPair(rankValue: unknown, totalValue: unknown): ExamResult['ranking'] {
  const rank = numberValue(rankValue); const total = numberValue(totalValue); return rank !== undefined && total !== undefined && rank > 0 && total > 0 ? { rank, total, scope: 'group' } : undefined;
}
function parseNamedRankings(section: unknown, label: string): NonNullable<ExamResult['ranking']>[] {
  return ([
    ['cNum', 'cCount', '班级', 'class'],
    ['sNum', 'sCount', '年级', 'grade'],
    ['tNum', 'tCount', '总排名', 'group'],
  ] as const).flatMap(([rankField, totalField, scopeLabel, scope]) => {
    const rank = numberValue(sortField(section, rankField)); const total = numberValue(sortField(section, totalField));
    return rank !== undefined && total !== undefined && rank > 0 && total > 0 ? [{ rank, total, scope, label: `${label}${scopeLabel}` }] : [];
  });
}
function sortField(section: unknown, field: string): unknown { return section && typeof section === 'object' && field in section ? (section as Record<string, unknown>)[field] : undefined; }
function numberValue(value: unknown): number | undefined { const parsed = Number(value); return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed) ? parsed : undefined; }
function questionKind(value: unknown): QuestionScore['kind'] {
  const type = numberValue(value);
  // 官方 singleDataByGroup.js：type > 0 展示作答扫描图，type = 0 展示客观题选项文字。
  return type !== undefined && Number.isInteger(type) && type >= 0 ? type === 0 ? 'objective' : 'subjective' : undefined;
}
function summarizeQuestions(data: z.infer<typeof tsubsResponseSchema>, questions: QuestionScore[], subject?: SubjectScore): QuestionScoreSummary[] | undefined {
  const rawScore = numberValue(subject?.providerContext?.originalScore) ?? (subject?.providerContext?.scaledScore === undefined ? subject?.score : undefined);
  // TotalSize 校验全量返回；得分与原始分核对，不能使用赋分做差或充当原始分。
  if (rawScore === undefined || !Number.isFinite(rawScore) || rawScore < 0 || !questions.length || (data.ErrCount !== undefined && data.ErrCount !== 0)
    || data.TotalSize !== questions.length || data.tSubList?.length !== questions.length
    || new Set(questions.map((question) => question.id)).size !== questions.length) return undefined;
  if (questions.some((question) => question.kind === undefined || question.score === undefined || question.maxScore === undefined
    || !Number.isFinite(question.score) || !Number.isFinite(question.maxScore) || question.score < 0 || question.maxScore < 0 || question.score > question.maxScore)) return undefined;
  const sum = (items: QuestionScore[], field: 'score' | 'maxScore') => items.reduce((value, question) => value + question[field]!, 0);
  if (Math.abs(sum(questions, 'score') - rawScore) > 0.000001) return undefined;
  const clean = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return (['objective', 'subjective'] as const).flatMap((kind) => {
    const items = questions.filter((question) => question.kind === kind);
    return items.length ? [{ kind, score: clean(sum(items, 'score')), maxScore: clean(sum(items, 'maxScore')) }] : [];
  });
}
function textValue(value: unknown): string | undefined { return value === undefined || value === null || value === '' ? undefined : String(value); }
function analysisItem(label: unknown, values: Record<string, unknown>): { label: string; values: Record<string, string> } | undefined {
  const normalized = Object.fromEntries(Object.entries(values).flatMap(([key, value]) => { const text = textValue(value); return text === undefined ? [] : [[key, text]]; }));
  const title = textValue(label); return title && Object.keys(normalized).length ? { label: title, values: normalized } : undefined;
}
function absentSubjects(html: string, subjects: SubjectScore[]): SubjectScore[] {
  const entries = Array.from(html.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi));
  return entries.flatMap(([, attributes, body]) => {
    if (!/class=["'][^"']*\babsent\b/i.test(attributes)) return [];
    const id = /id=["']li(\d+)/i.exec(attributes)?.[1]; const name = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(body)?.[1];
    const subject = name && htmlText(name);
    return id && subject && !subjects.some(x => x.subject === subject) ? [{ id, subject, status: 'absent' as const }] : [];
  });
}
function visibleResult(result: ExamResult, scoreShow: unknown, scoreRank: unknown): ExamResult {
  const gradesOnly = Number(scoreShow) === 2; const ranksHidden = Number(scoreRank) === 0;
  if (!gradesOnly && !ranksHidden) return result;
  const hiddenKeys = new Set([
    ...(gradesOnly ? ['originalScore', 'scaledScore', 'standardScore', 'classAverage', 'gradeAverage', 'groupAverage'] : []),
    ...(ranksHidden ? ['classRank', 'gradeRank', 'groupRank', 'classCount', 'gradeCount', 'groupCount'] : []),
  ]);
  return { ...result, totalScore: gradesOnly ? undefined : result.totalScore, originalTotalScore: gradesOnly ? undefined : result.originalTotalScore,
    ranking: ranksHidden ? undefined : result.ranking, rankings: ranksHidden ? undefined : result.rankings,
    statistics: result.statistics?.map(stat => ({ ...stat, averageScore: gradesOnly ? undefined : stat.averageScore, rank: ranksHidden ? undefined : stat.rank, participantCount: ranksHidden ? undefined : stat.participantCount })),
    subjects: result.subjects.map(row => ({ ...row, score: gradesOnly ? undefined : row.score, providerContext: row.providerContext ? Object.fromEntries(Object.entries(row.providerContext).filter(([key]) => !hiddenKeys.has(key))) : undefined })) };
}
async function parseJson<T>(response: Response, schema: z.ZodType<T>, message: string): Promise<T> { try { const result = schema.safeParse(await response.json()); if (!result.success) throw new ProviderError('UNKNOWN', message); return result.data; } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('UNKNOWN', message); } }

function collectCookies(jar: Map<string, string>, response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];
  for (const value of values) {
    for (const match of value.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;,\r\n]*)/g)) {
      jar.set(match[1], match[2]);
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');
}

function loginPage(html: string): boolean {
  return /name=["']txbPassword["']/i.test(html) && /name=["']btnSubmit["']/i.test(html);
}

/** 报告页地址，同时是各个 XHR 接口与答题卡图片的 Referer。 */
function reportReferer(apiHost: string, examId: string): string {
  return `${apiHost}/report/singleGroup/${encodeURIComponent(examId)}`;
}
/** 单科分析类 JSON 接口的公共请求头；官方页面以 XHR + 移动端 UA 访问它们。 */
function xhrHeaders(referer: string): Record<string, string> {
  return { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: referer, 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/121.0 Mobile Safari/537.36' };
}
/** 答题卡图片是受会话保护的资源，渲染/下载时需要带上 Cookie 与来源。 */
function sheetFetchHeaders(cookie: string | undefined, referer: string): Record<string, string> | undefined {
  return cookie ? { Cookie: cookie, Referer: referer, 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/121.0 Mobile Safari/537.36' } : undefined;
}

export function createRuiyaProvider(transport: FetchTransport = (...args) => fetch(...args), options: RuiyaProviderOptions = {}): ScoreProvider {
  const host = options.host ?? defaultHost;
  const providerId = options.providerId ?? defaultProviderId;
  const platformLabel = options.platformLabel ?? '睿芽';
  const system = options.system ?? '1';
  /** 平台 Cookie 容器模式下 Cookie 由容器携带，请求不再手工附加 Cookie 头。 */
  const platformCookieJar = options.platformCookieJar ?? false;
  const extendedReports = options.extendedReports ?? false;
  const abilityScoreAction = options.abilityScoreAction ?? 'getAbilityScore';
  const credentials: RequestCredentials = platformCookieJar ? 'include' : 'omit';
  const allowedHosts = new Set([new URL(host).hostname, ...(options.allowedHosts ?? [])]);
  const allowedHost = (target: URL): boolean => ['http:', 'https:'].includes(target.protocol) && Array.from(allowedHosts).some((allowed) => target.hostname === allowed || target.hostname.endsWith(`.${allowed}`));
  const revoked = new WeakSet<AuthSession>();
  async function request(session: AuthSession | undefined, path: string, init: RequestInit = {}): Promise<Response> {
    if (session && (session.providerId !== providerId || revoked.has(session) || !session.providerContext?.cookie)) throw new ProviderError('SESSION_EXPIRED', `${platformLabel}登录已失效，请重新登录`);
    try {
      const sessionHost = session?.providerContext?.host ?? host;
      const cookie = platformCookieJar ? undefined : session?.providerContext?.cookie;
      const response = await requestWithTimeout(transport, sessionHost + path, { ...init, credentials, redirect: init.redirect ?? 'error', headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) } });
      if (response.status === 401 || response.status === 403) throw new ProviderError('SESSION_EXPIRED', `${platformLabel}登录已失效，请重新登录`);
      if (response.status !== 200) throw new ProviderError('NETWORK', `${platformLabel}服务请求失败`, response.status >= 500);
      return response;
    } catch (error) { throwIfAborted(init.signal); if (error instanceof ProviderError) throw error; throw new ProviderError('NETWORK', `${platformLabel}请求失败或超时`, true); }
  }
  async function optionalReport<T>(session: AuthSession, path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T | undefined> {
    try { return await parseJson(await request(session, path, init), schema, `${platformLabel}分析响应结构不符合预期`); }
    catch { throwIfAborted(init.signal); return undefined; }
  }
  return {
    metadata: { id: providerId, name: platformLabel, description: '实验接入：查询官方报告、单科题目和答题卡。', officialDomain: host },
    capabilities: { profile: true, exams: true, results: true, ranking: true, subjectDetails: true, questionScores: true, answerSheets: true },
    async authenticate(account, password) {
      if (!account.trim() || !password) throw new ProviderError('INVALID_CREDENTIALS', '请输入账号和密码');
      const first = await request(undefined, '/'); const page = await first.text();
      const cookies = new Map<string, string>(); collectCookies(cookies, first);
      if (!cookies.size) throw new ProviderError('NETWORK', `${platformLabel}登录未返回会话 Cookie`);
      const body = new URLSearchParams({ __VIEWSTATE: hidden(page, '__VIEWSTATE'), __VIEWSTATEGENERATOR: hidden(page, '__VIEWSTATEGENERATOR'), __VIEWSTATEENCRYPTED: '', __EVENTVALIDATION: hidden(page, '__EVENTVALIDATION'), hndSystem: system, txbUserName: account.trim(), txbPassword: rsaEncrypt(password), btnSubmit: '登 录', btnhidedsubmit: '' }).toString();
      const postedUrl = host + '/';
      const authHeaders = (): Record<string, string> => platformCookieJar ? {} : { Cookie: cookieHeader(cookies) };
      let response: Response;
      try {
        response = await requestWithTimeout(transport, postedUrl, { method: 'POST', redirect: 'manual', credentials, headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      } catch { throw new ProviderError('NETWORK', `${platformLabel}登录请求失败或超时`, true); }
      collectCookies(cookies, response);
      if (response.status >= 500) throw new ProviderError('NETWORK', `${platformLabel}登录服务暂不可用`, true);
      if (response.status >= 400) throw new ProviderError('NETWORK', `${platformLabel}登录请求未成功`);
      let reportPath = '/report/test/';
      let sessionHost = host;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new ProviderError('UNKNOWN', `${platformLabel}登录跳转结构不符合预期`);
        const target = new URL(location, host);
        if (!allowedHost(target)) throw new ProviderError('UNKNOWN', `${platformLabel}登录跳转结构不符合预期`);
        // 平台 Cookie 容器按主机隔离 Cookie，必须沿用跳转给出的协议与主机；其余情况维持 https 升级。
        sessionHost = platformCookieJar ? target.origin : `https://${target.host}`;
        reportPath = `${target.pathname}${target.search}`;
      } else if (response.status !== 200) throw new ProviderError('NETWORK', `${platformLabel}登录请求未成功`);
      const html = response.status === 200 ? await response.text() : '';
      if (html && loginPage(html)) throw new ProviderError('INVALID_CREDENTIALS', `${platformLabel}账号或密码错误`);
      // React Native 的 fetch 忽略 redirect:'manual'，重定向在原生层自动跟随：登录后的主机与路径只能取自 response.url。
      if (response.status === 200 && platformCookieJar && response.url && response.url !== postedUrl) {
        try {
          const finalUrl = new URL(response.url);
          if (allowedHost(finalUrl)) { sessionHost = finalUrl.origin; reportPath = `${finalUrl.pathname}${finalUrl.search}`; }
        } catch { /* 最终地址无法解析时沿用默认报告列表地址。 */ }
      }
      let verify = await requestWithTimeout(transport, sessionHost + reportPath, { credentials, redirect: 'manual', headers: authHeaders() });
      for (let redirectCount = 0; redirectCount < 3 && verify.status >= 300 && verify.status < 400; redirectCount += 1) {
        collectCookies(cookies, verify);
        const location = verify.headers.get('location');
        if (!location) break;
        const target = new URL(location, sessionHost);
        if (!allowedHost(target)) break;
        sessionHost = platformCookieJar ? target.origin : `https://${target.host}`;
        reportPath = `${target.pathname}${target.search}`;
        verify = await requestWithTimeout(transport, sessionHost + reportPath, { credentials, redirect: 'manual', headers: authHeaders() });
      }
      collectCookies(cookies, verify);
      if (verify.status >= 300 && verify.status < 400) throw new ProviderError('SESSION_EXPIRED', `${platformLabel}登录会话未建立，请重试`);
      if (verify.status !== 200) throw new ProviderError('NETWORK', `${platformLabel}登录验证失败`, verify.status >= 500);
      const reportHtml = await verify.text();
      if (loginPage(reportHtml)) throw new ProviderError('SESSION_EXPIRED', `${platformLabel}登录会话未建立，请重试`);
      const cookie = cookieHeader(cookies);
      return { providerId, accountId: account.trim(), accessToken: cookie, providerContext: { cookie, host: sessionHost } };
    },
    async getProfile(session, options?: ProviderRequestOptions): Promise<StudentProfile> { const html = await (await request(session, '/report/test/', { signal: options?.signal })).text(); const name = /欢迎您，\s*([^<\s]+)\s*同学/.exec(htmlText(html))?.[1]; if (!name) throw new ProviderError('UNKNOWN', `${platformLabel}学生信息结构不符合预期`); return { id: session.accountId, displayName: name }; },
    async getExamList(session, page = {}, options?: ProviderRequestOptions): Promise<ExamSummary[]> { if (page.offset && page.offset > 0) return []; const html = await (await request(session, '/report/test/', { signal: options?.signal })).text(); const links = reportLinks(html); return Promise.all(links.map(async (item) => { try { const detail = await (await request(session, `/report/singleGroup/${encodeURIComponent(item.id)}`, { signal: options?.signal })).text(); const title = reportTitle(detail); return title ? { ...item, name: title } : item; } catch { return item; } })); },
    async getExamResult(session, examId, requestOptions?: ProviderRequestOptions): Promise<ExamResult> {
      if (!/^[A-Za-z0-9]+$/.test(examId)) throw new ProviderError('NOT_FOUND', `${platformLabel}报告标识无效`);
      const html = await (await request(session, `/report/singleGroup/${encodeURIComponent(examId)}`, { signal: requestOptions?.signal })).text();
      const sign = encodeURIComponent(reportSign(html));
      const results = await parseJson(await request(session, `/api/single/resultsByGroup/${sign}`, { signal: requestOptions?.signal }), resultsResponseSchema, `${platformLabel}成绩响应结构不符合预期`);
      const raw = results.Results?.length ? parseResults(results, examId) : parseResult(html, examId);
      const init = { headers: xhrHeaders(reportReferer(session.providerContext?.host ?? host, examId)), signal: requestOptions?.signal };
      const sort = await optionalReport(session, `/api/single/sortByGroup/${sign}/0`, sortResponseSchema, init);
      const ranksHidden = extendedReports && (Number(results.scoreRank) === 0 || Number(sort?.scoreRank) === 0);
      const gradesOnly = extendedReports && (Number(results.scoreShow) === 2 || Number(sort?.scoreShow) === 2);
      const parsed = extendedReports ? visibleResult(raw, gradesOnly ? 2 : results.scoreShow, ranksHidden ? 0 : results.scoreRank) : raw;
      const rankings = ranksHidden ? [] : [...parseNamedRankings(sort?.sSort, '赋分'), ...parseNamedRankings(sort?.oSort, '原始分')];
      const primary = Number(sort?.scoreShow) === 2 ? sort?.oSort : sort?.sSort;
      const ranking = ranksHidden ? undefined : parseRankPair(sortField(primary, 'tNum'), sortField(primary, 'tCount')) ?? parseRankPair(sortField(sort?.oSort, 'tNum'), sortField(sort?.oSort, 'tCount')) ?? parsed.ranking;
      let reportSections: ExamResult['reportSections'];
      let subjects = parsed.subjects;
      let maximum: Pick<ExamResult, 'maxTotalScore' | 'originalMaxTotalScore'> = {};
      if (options.extendedReports) {
        const classId = /<select\b[^>]*id=["']ddlClass["'][^>]*>[\s\S]*?<option\b[^>]*value=["'](\d+)["']/i.exec(html)?.[1];
        const [rates, compare, lines, learning] = await Promise.all([
          optionalReport(session, `/api/single/percentByGroup/${sign}`, percentSchema, init),
          classId ? optionalReport(session, `/api/single/compareByGroup/${sign}/${classId}`, compareSchema, init) : undefined,
          optionalReport(session, `/api/single/getscorelines/${sign}/0`, linesSchema, init),
          optionalReport(session, `/api/single/getByAbilityTotalScore/${sign}`, learningTotalSchema, init),
        ]);
        reportSections = examReportSections(gradesOnly ? undefined : rates, ranksHidden ? undefined : compare, gradesOnly ? undefined : lines);
        const learningSection = learningTotalSection(learning);
        if (learningSection) reportSections.push(learningSection);
        if (!rates) reportSections.push({ id: 'comparison-unavailable', title: '学科表现', notes: ['学科分析暂不可用，请稍后重新进入本场考试。'] });
        // 考试总览也需要试卷满分；只查询轻量元数据，不预加载逐题或答题卡。
        if (!gradesOnly) {
          const papers = await Promise.all(subjects.map(async (subject) => {
            if (!subject.id || subject.status === 'absent') return undefined;
            const paperId = subjectIdCandidates(html, subject.id, subject.subject)[0];
            const metadata = await optionalReport(session, `/api/single/getscorelines/${sign}/${encodeURIComponent(paperId)}`, linesSchema, init);
            const max = reportNumber(metadata?.testsPaper?.TotalScore);
            return max !== undefined && max > 0 ? { paperId, max } : undefined;
          }));
          subjects = subjects.map((subject, index) => {
            const max = papers[index]?.max;
            if (max === undefined) return subject;
            return subject.providerContext?.scaledScore !== undefined
              ? { ...subject, maxScore: max, providerContext: { ...subject.providerContext, originalMaxScore: String(max) } }
              : { ...subject, maxScore: max };
          });
          const originalScores = subjects.map(subject => reportNumber(subject.providerContext?.originalScore) ?? subject.score);
          const originalTotal = parsed.originalTotalScore ?? parsed.totalScore;
          // 只有完整、无重复试卷且科目原始分合计与官方总分一致时才合计满分。
          if (papers.length && papers.every(paper => paper !== undefined) && new Set(papers.map(paper => paper?.paperId)).size === papers.length
            && originalScores.every(score => score !== undefined) && originalTotal !== undefined
            && Math.abs(originalScores.reduce<number>((sum, score) => sum + (score ?? 0), 0) - originalTotal) < 1e-6) {
            const totalMax = papers.reduce((sum, paper) => sum + paper!.max, 0);
            maximum = { maxTotalScore: totalMax, ...(parsed.originalTotalScore !== undefined ? { originalMaxTotalScore: totalMax } : {}) };
          }
        }
      }
      return { ...parsed, ...maximum, examName: reportTitle(html) ?? parsed.examName,
        subjects: options.extendedReports ? [...subjects, ...absentSubjects(html, subjects)] : subjects,
        ...(ranking ? { ranking } : {}), ...(rankings.length ? { rankings } : {}), ...(reportSections ? { reportSections } : {}) };
    },
    async getSubjectDetail(session, examId, subjectId, cachedResult, options?: ProviderRequestOptions) {
      const html = await (await request(session, `/report/singleGroup/${encodeURIComponent(examId)}`, { signal: options?.signal })).text();
      const sign = reportSign(html); const apiHost = session.providerContext?.host ?? host; const cachedSubject = cachedResult?.subjects.find((item) => item.id === subjectId); const subject = cachedSubject?.subject ?? reportSubject(html, subjectId) ?? subjectId; const subjectIds = subjectIdCandidates(html, subjectId, subject); const referer = reportReferer(apiHost, examId); const apiHeaders = xhrHeaders(referer); let resolvedSubjectId = subjectIds[0] ?? subjectId; let subjectSort: z.infer<typeof sortResponseSchema> | undefined;
      let papers: z.infer<typeof papersResponseSchema> | undefined;
      let tsubs: z.infer<typeof tsubsResponseSchema> = {};
      for (const candidate of subjectIds) {
        resolvedSubjectId = candidate;
        let candidateSort: z.infer<typeof sortResponseSchema> | undefined;
        let candidatePapers: z.infer<typeof papersResponseSchema> | undefined;
        let candidateTsubs: z.infer<typeof tsubsResponseSchema> = {};
        try {
          candidateSort = await parseJson(await request(session, `/api/single/sortByGroup/${encodeURIComponent(sign)}/${encodeURIComponent(candidate)}`, { headers: apiHeaders, signal: options?.signal }), sortResponseSchema, `${platformLabel}科目排名响应结构不符合预期`);
        } catch { /* 该候选 ID 可能只适用于题目或答题卡接口。 */ }
        try {
          candidatePapers = await parseJson(await request(session, `/api/single/papersgroup/${encodeURIComponent(sign)}/${encodeURIComponent(candidate)}`, { headers: apiHeaders, signal: options?.signal }), papersResponseSchema, `${platformLabel}答题卡响应结构不符合预期`);
        } catch { /* 该候选 ID 可能只适用于题目接口。 */ }
        try {
          candidateTsubs = await parseJson(await request(session, `/api/single/tsubsByGroup/${encodeURIComponent(sign)}/${encodeURIComponent(candidate)}`, { headers: apiHeaders, signal: options?.signal }), tsubsResponseSchema, `${platformLabel}题目响应结构不符合预期`);
        } catch { if (candidate === subjectIds[subjectIds.length - 1]) throw new ProviderError('UNKNOWN', `${platformLabel}题目响应结构不符合预期`); }
        if (candidateSort && !subjectSort) subjectSort = candidateSort;
        if (candidatePapers?.papers?.length) papers = candidatePapers;
        if (candidateTsubs.tSubList?.length) { tsubs = candidateTsubs; break; }
        if (extendedReports && candidateSort && Number(candidateSort.ErrCount ?? 0) === 0 && Number(candidateTsubs.ErrCount) === 1) { tsubs = candidateTsubs; break; }
        if (candidate === subjectIds[subjectIds.length - 1]) tsubs = candidateTsubs;
      }
      const gradesOnly = extendedReports && (Number(subjectSort?.scoreShow) === 2 || Number(tsubs.scoreShow) === 2);
      const ranksHidden = extendedReports && Number(subjectSort?.scoreRank) === 0;
      const questions: QuestionScore[] = (extendedReports && tsubs.ErrCount && tsubs.ErrCount !== 0 ? [] : tsubs.tSubList ?? []).filter((item) => item.id !== undefined).map((item) => ({ id: String(item.id), label: item.no ?? String(item.id), score: gradesOnly ? undefined : numberValue(item.mScore), maxScore: numberValue(item.tScore), kind: questionKind(item.type),
        ...(extendedReports && questionKind(item.type) === 'objective' ? { myAnswer: item.mAnswer || undefined, answer: item.tAnswer || undefined } : {}),
        providerContext: { difference: String(item.mDiff ?? ''), schoolAverage: String(item.sScore ?? ''), classAverage: String(item.cScore ?? ''), knowledgePoint: item.zhiShiDian ?? '', studentAnswer: item.mAnswer ?? '', correctAnswer: item.tAnswer ?? '', testImage: item.testImg ?? '', videoPath: item.videoPath ?? '', ...(extendedReports && questionKind(item.type) === 'subjective' && item.mAnswer ? { answerImageAvailable: 'true' } : {}) } }));
      const questionScoreSummaries = summarizeQuestions(tsubs, questions, cachedSubject);
      const optional = async <T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> => {
        try { return await parseJson(await request(session, path, { headers: apiHeaders, signal: options?.signal }), schema, `${platformLabel}科目分析响应结构不符合预期`); } catch { throwIfAborted(options?.signal); return undefined; }
      };
      const [chapter, ability, abilityScore, metadata, questionRates] = await Promise.all([
        optional(`/api/single/chartByGroup/${encodeURIComponent(sign)}/${encodeURIComponent(resolvedSubjectId)}`, chapterResponseSchema),
        optional(`/api/single/ablityByGroup/${encodeURIComponent(sign)}/${encodeURIComponent(resolvedSubjectId)}`, abilityResponseSchema),
        optional(`/api/single/${abilityScoreAction}/${encodeURIComponent(sign)}/${encodeURIComponent(resolvedSubjectId)}`, abilityScoreResponseSchema),
        extendedReports ? optional(`/api/single/getscorelines/${encodeURIComponent(sign)}/${encodeURIComponent(resolvedSubjectId)}`, linesSchema) : undefined,
        extendedReports ? optional(`/api/single/getScoreByPaperInfoTitle/${encodeURIComponent(sign)}/${encodeURIComponent(resolvedSubjectId)}`, questionRatesSchema) : undefined,
      ]);
      const chapterAnalysis = chapter?.ErrCount ? undefined : chapter?.chtList?.map((item) => {
        const aLabel = extendedReports && chapter.aName ? `${chapter.aName}基准` : '达标分A';
        const bLabel = extendedReports && chapter.bName ? `${chapter.bName}基准` : '达标分B';
        const result = analysisItem(item.title, { '章节总分': item.tScore, [aLabel]: item.aStandard, [bLabel]: item.bStandard, '个人得分': item.mScore, '达成等级': item.sLevel });
        if (!result) return undefined;
        return { ...result, scoreBreakdown: {
          score: numberValue(item.mScore), maxScore: numberValue(item.tScore), grade: result.values['达成等级'],
          benchmarks: [{ label: aLabel, score: numberValue(item.aStandard) }, { label: bLabel, score: numberValue(item.bStandard) }].filter((entry): entry is { label: string; score: number } => entry.score !== undefined),
        } };
      }).filter((item): item is NonNullable<typeof item> => !!item);
      const abilityAnalysis = ability?.ErrCount ? undefined : ability?.title?.map((title, index) => analysisItem(title, { '能力总分': ability.sumscore?.[index], [extendedReports && ability.aAblityName ? `${ability.aAblityName}基准` : '达标分A']: ability.aAblity?.[index], [extendedReports && ability.bAblityName ? `${ability.bAblityName}基准` : '达标分B']: ability.bAblity?.[index], '个人得分': ability.score?.[index], '得分率': extendedReports && numberValue(ability.mAblity?.[index]) !== undefined ? `${ability.mAblity?.[index]}%` : ability.mAblity?.[index] })).filter((item): item is NonNullable<typeof item> => !!item);
      const showLearning = !abilityScore?.ErrCount && (!extendedReports || Number(abilityScore?.scoreShow) === 1);
      const position = (value: unknown) => numberValue(value) !== undefined && Number(value) >= 0 && Number(value) <= 100 && Number(abilityScore?.scoreRank) === 1 ? `${value}%` : undefined;
      const abilityScoreAnalysis = showLearning ? [
        analysisItem('原始分', { 分数: abilityScore?.stuSumScore, [extendedReports ? '定位比例' : '排名']: extendedReports ? position(abilityScore?.tNum) : abilityScore?.tNum }),
        analysisItem('学能分', { 分数: abilityScore?.sumscore, [extendedReports ? '定位比例' : '排名']: extendedReports ? position(abilityScore?.tnum) : abilityScore?.tnum }),
      ].filter((item): item is NonNullable<typeof item> => !!item) : undefined;
      const reportSections: NonNullable<ExamResult['reportSections']> = [];
      if (extendedReports) {
        const rateSection = questionRateSection(questionRates);
        if (rateSection) reportSections.push(rateSection);
        else if (questions.length) reportSections.push({ id: 'question-rates-empty', title: '题组得分率', notes: [questionRates ? '平台未提供本场科目的题组统计。' : '题组统计暂不可用。'] });
        if (chapterAnalysis?.length && chapter?.chtSum) {
          const total = analysisItem('章节合计', { '章节总分': chapter.chtSum.total, '本人得分': chapter.chtSum.mine, '整体等级': chapter.chtSum.level, [chapter.aName ? `${chapter.aName}基准` : '基准A']: Number(chapter.scoreRank) === 0 ? undefined : chapter.chtSum.one, [chapter.bName ? `${chapter.bName}基准` : '基准B']: Number(chapter.scoreRank) === 0 ? undefined : chapter.chtSum.two });
          reportSections.push({ id: 'chapter-summary', title: '章节概览', items: total ? [total] : undefined, notes: chapter.chtNote ? [htmlText(chapter.chtNote)] : undefined, collapseNotes: true });
        }
        if (!chapterAnalysis?.length) reportSections.push({ id: 'chapter-empty', title: '知识章节', notes: [chapter ? '平台未提供章节分析。' : '章节分析暂不可用。'] });
        if (!abilityAnalysis?.length) reportSections.push({ id: 'ability-empty', title: '学习能力', notes: [ability ? '平台未提供能力分析。' : '能力分析暂不可用。'] });
        if (!showLearning && Number(abilityScore?.scoreShow) !== 0) reportSections.push({ id: 'learning-status', title: '学能分析', notes: ['学能分析暂不可用。'] });
        if (showLearning) {
          const items = [abilityScore?.dScore, abilityScore?.nScore, abilityScore?.cScore].flatMap(row => {
            if (!row?.length || typeof row[0] !== 'string') return [];
            const item = analysisItem(row[0], { '涉及分值': numberValue(row[1]), '涉及题目': typeof row[2] === 'string' ? row[2] : undefined, '原始分可增至': numberValue(row[3]), '定位提升空间': position(row[4]) });
            return item ? [item] : [];
          });
          if (items.length) reportSections.push({ id: 'learning-potential', title: '提分分析', items });
        }
      }
      const sheetHeaders = sheetFetchHeaders(session.providerContext?.cookie, referer);
      const answerSheets = (papers?.papers ?? []).flatMap((paper): AnswerSheet[] => {
        const rawUrl = paper.watermak_pic_url ?? paper.watermark_url ?? paper.pic_url;
        if (!rawUrl) return [];
        const url = new URL(rawUrl, apiHost).toString();
        return [{ subject, subjectId: resolvedSubjectId, url, watermarked: rawUrl === paper.watermak_pic_url, headers: sheetHeaders }];
      });
      const resolvedAnswerSheets = answerSheets.length ? answerSheets : answerSheetLinks(html, apiHost, subject, resolvedSubjectId, sheetHeaders);
      const visibleSubject = cachedSubject && (extendedReports ? visibleResult({ examId, examName: '', subjects: [cachedSubject] }, gradesOnly ? 2 : undefined, ranksHidden ? 0 : undefined).subjects[0] : cachedSubject);
      const context = visibleSubject?.providerContext;
      const rankSource = (Number(subjectSort?.scoreShow) === 2 ? subjectSort?.oSort : subjectSort?.sSort) ?? (extendedReports ? subjectSort : undefined);
      const statistics = context ? [
        { scope: '标准分', averageScore: numberValue(context.standardScore) },
        { scope: '班级', averageScore: numberValue(context.classAverage), participantCount: numberValue(sortField(rankSource, 'cCount')) ?? numberValue(context.classCount), rank: numberValue(sortField(rankSource, 'cNum')) ?? numberValue(context.classRank) },
        { scope: '年级', averageScore: numberValue(context.gradeAverage), participantCount: numberValue(sortField(rankSource, 'sCount')) ?? numberValue(context.gradeCount), rank: numberValue(sortField(rankSource, 'sNum')) ?? numberValue(context.gradeRank) },
        { scope: '总排名', averageScore: numberValue(context.groupAverage), participantCount: numberValue(sortField(rankSource, 'tCount')) ?? numberValue(context.groupCount), rank: numberValue(sortField(rankSource, 'tNum')) ?? numberValue(context.groupRank) },
      ].map(item => ({ ...item, averageScore: gradesOnly ? undefined : item.averageScore, rank: ranksHidden ? undefined : item.rank, participantCount: ranksHidden ? undefined : item.participantCount }))
        .filter((item) => item.averageScore !== undefined || item.participantCount !== undefined || item.rank !== undefined) : undefined;
      const officialMax = reportNumber(metadata?.testsPaper?.TotalScore);
      return { subjectId: resolvedSubjectId, subject, score: visibleSubject?.score, ...(officialMax !== undefined && officialMax > 0 ? { maxScore: officialMax } : {}), grade: cachedSubject?.grade, providerContext: context, statistics, chapterAnalysis, abilityAnalysis, abilityScoreAnalysis, questions, ...(questionScoreSummaries ? { questionScoreSummaries } : {}), answerSheets: resolvedAnswerSheets,
        ...(extendedReports ? { reportSections, questionNotice: questions.length ? undefined : '平台未提供本场科目的逐题数据。' } : {}) };
    },
    ...(extendedReports ? { async getQuestionAnswerSheet(session: AuthSession, examId: string, subjectId: string, questionId: string, requestOptions?: ProviderRequestOptions): Promise<AnswerSheet> {
      if (!/^[A-Za-z0-9]+$/.test(examId) || !/^\d+$/.test(subjectId) || !/^\d+$/.test(questionId)) throw new ProviderError('NOT_FOUND', '作答图片标识无效');
      const html = await (await request(session, `/report/singleGroup/${encodeURIComponent(examId)}`, { signal: requestOptions?.signal })).text();
      const apiHost = session.providerContext?.host ?? host; const referer = reportReferer(apiHost, examId);
      const data = await parseJson(await request(session, `/api/single/getOSS_CutPaper/${encodeURIComponent(reportSign(html))}/${subjectId}/${questionId}`, { headers: xhrHeaders(referer), signal: requestOptions?.signal }), cutSchema, '作答图片响应结构不符合预期');
      if (data.errCode !== 0 || !data.url) throw new ProviderError('NOT_FOUND', '平台未提供此题的作答图片');
      if (embeddedImageData(data.url)) return { subject: `第 ${questionId} 题作答`, subjectId, url: data.url, watermarked: false };
      const url = new URL(data.url, apiHost);
      if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError('UNKNOWN', '平台图片地址无效');
      return { subject: `第 ${questionId} 题作答`, subjectId, url: url.toString(), watermarked: false, headers: sheetFetchHeaders(session.providerContext?.cookie, referer) };
    } } : {}),
    async getAnswerSheets(session, examId, subjectId, cachedResult, options?: ProviderRequestOptions) {
      // 答题卡页不需要题目与章节分析：只解析试卷图接口，省去整页详情所依赖的其余请求。
      const html = await (await request(session, `/report/singleGroup/${encodeURIComponent(examId)}`, { signal: options?.signal })).text();
      const sign = reportSign(html);
      const apiHost = session.providerContext?.host ?? host;
      const referer = reportReferer(apiHost, examId);
      const cachedSubject = cachedResult?.subjects.find((item) => item.id === subjectId);
      const subject = cachedSubject?.subject ?? reportSubject(html, subjectId) ?? subjectId;
      const apiHeaders = xhrHeaders(referer);
      const sheetHeaders = sheetFetchHeaders(session.providerContext?.cookie, referer);
      let papers: z.infer<typeof papersResponseSchema> | undefined;
      let resolvedSubjectId = subjectId;
      for (const candidate of subjectIdCandidates(html, subjectId, subject)) {
        resolvedSubjectId = candidate;
        try {
          const candidatePapers = await parseJson(await request(session, `/api/single/papersgroup/${encodeURIComponent(sign)}/${encodeURIComponent(candidate)}`, { headers: apiHeaders, signal: options?.signal }), papersResponseSchema, `${platformLabel}答题卡响应结构不符合预期`);
          if (candidatePapers.papers?.length) { papers = candidatePapers; break; }
        } catch { /* 尝试下一个候选 ID。 */ }
      }
      const answerSheets = (papers?.papers ?? []).flatMap((paper): AnswerSheet[] => {
        const rawUrl = paper.watermak_pic_url ?? paper.watermark_url ?? paper.pic_url;
        if (!rawUrl) return [];
        const url = new URL(rawUrl, apiHost).toString();
        return [{ subject, subjectId: resolvedSubjectId, url, watermarked: rawUrl === paper.watermak_pic_url, headers: sheetHeaders }];
      });
      return answerSheets.length ? answerSheets : answerSheetLinks(html, apiHost, subject, resolvedSubjectId, sheetHeaders);
    },
    async logout(session) { revoked.add(session); if (platformCookieJar) await clearPlatformCookies(); },
  };
}

export const ruiyaProvider = createRuiyaProvider(undefined, {
  extendedReports: true,
  abilityScoreAction: 'getByAbilityScore',
});
