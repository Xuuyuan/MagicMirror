import { z } from 'zod';
import { ProviderError, type AnswerSheet, type AuthSession, type ExamResult, type Ranking, type QuestionScore, type QuestionScoreSummary } from '../domain/models';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import { numericScore, parseValidated } from './codec';
import { diagnosticEndpoint, recordDiagnostic } from '../services/diagnostics';

// numericScore 与编解码原语收拢在共享模块；这里重新导出，供测试直接引用。
export { numericScore } from './codec';

const host = 'https://hfs-be.yunxiao.com';
const id = z.union([z.string().min(1), z.number().int().safe().nonnegative()]);
const tokenSchema = z.string().regex(/^[A-Za-z0-9._~+=/-]+$/);
const numeric = z.preprocess((value) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value, z.number().finite());
const envelope = z.object({ code: z.preprocess((value) => typeof value === 'string' ? Number(value) : value, z.number().int()), data: z.unknown().optional(), msg: z.string().optional() });
const loginSchema = z.object({ token: tokenSchema, needUpdatePassword: z.boolean().optional() });
const profileSchema = z.object({ roleType: z.union([z.number(), z.string()]).optional(), linkedStudent: z.object({
  studentId: id, studentName: z.string().min(1), schoolName: z.string().optional(), grade: z.string().optional(),
  isVirtual: z.union([z.number(), z.string()]).optional(),
}).nullable() });
// /v4/exam/archives（考试档案）：官方新版客户端获取全部考试的端点，一次返回当前年级全部考试（无分页参数）。
const archivesSchema = z.object({
  list: z.array(z.object({
    examId: id, name: z.string().min(1), type: z.string().optional(), eventTime: numeric.optional(), paperCount: numeric.optional(),
    score: z.string().optional(), manfen: numeric.optional(), classStuNum: numeric.optional(), gradeStuNum: numeric.optional(),
    classRank: z.string().nullish(), gradeRank: z.string().nullish(),
  })),
  // 按科目聚合的跨考试走势；list[].id 为该次考试该科目的 pid（形如 `10321117-29321`），并带单科的排名展示串与人数。
  papers: z.array(z.object({
    subject: z.string().optional(),
    list: z.array(z.object({
      id: id, examId: id.optional(),
      classRank: z.string().nullish(), gradeRank: z.string().nullish(),
      classStuNum: numeric.optional(), gradeStuNum: numeric.optional(),
    })).optional(),
  })).optional(),
});
const scoreSchema = z.object({ scoreS: z.string().optional(), score: numeric.optional(), manfen: numeric });
const overviewSchema = scoreSchema.extend({
  examId: id, name: z.string().min(1), classRank: numeric.optional(), gradeRank: numeric.optional(), groupRank: numeric.optional(), classStuNum: numeric.optional(), gradeStuNum: numeric.optional(), groupStuNum: numeric.optional(), classAvg: numeric.optional(), gradeAvg: numeric.optional(), classRankS: z.string().optional(), gradeRankS: z.string().optional(), groupRankS: z.string().optional(), papers: z.array(scoreSchema.extend({ paperId: id.optional(), pid: id.optional(), subject: z.string().min(1).optional(), name: z.string().min(1).optional() })),
});
// 官方 H5 的 v4 总览使用 rank 展示串，并把分数放在 score 字段（通常是字符串）。
// 先单独校验，再归一化到内部 Overview，避免把 v4 的展示串误当成数值排名。
const v4Metric = z.union([numeric, z.string()]).nullish();
const v4OverviewSchema = z.object({
  examId: id, name: z.string().min(1), score: z.union([z.string(), numeric]).optional(), scoreS: z.string().optional(), manfen: numeric,
  classRank: z.union([z.string(), numeric]).nullish(), gradeRank: z.union([z.string(), numeric]).nullish(), groupRank: z.union([z.string(), numeric]).nullish(),
  classRankS: z.string().optional(), gradeRankS: z.string().optional(), groupRankS: z.string().optional(),
  classStuNum: numeric.optional(), gradeStuNum: numeric.optional(), groupStuNum: numeric.optional(), classAvg: v4Metric, gradeAvg: v4Metric,
  papers: z.array(z.object({ paperId: id.optional(), pid: id.optional(), subject: z.string().min(1).optional(), name: z.string().min(1).optional(), score: z.union([z.string(), numeric]).optional(), scoreS: z.string().optional(), manfen: numeric })),
});
const briefSchema = z.object({ name: z.string().min(1), papers: z.array(scoreSchema.extend({ paperId: id.optional(), subject: z.string().min(1).optional(), name: z.string().min(1).optional() })) });
const answerPictureSchema = z.object({ url: z.array(z.string().url()).optional(), urlResize: z.array(z.string().url()).optional(), questions: z.array(z.object({ id: id, name: z.string().optional(), score: numeric.optional(), manfen: numeric.optional(), type: numeric.optional(), myAnswer: z.string().nullish(), answer: z.string().nullish() })).optional() });
type Overview = z.infer<typeof overviewSchema>;
type Brief = z.infer<typeof briefSchema>;
type Paper = (Overview['papers'][number] | Brief['papers'][number]) & { pid?: string | number };

function parse<T>(schema: z.ZodType<T>, raw: unknown, stage = '响应'): T {
  return parseValidated(schema, raw, `好分数${stage}结构不符合预期`);
}

function displayRankValue(value: string | number | null | undefined): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function normalizeV4Overview(value: z.infer<typeof v4OverviewSchema>): Overview {
  return {
    examId: value.examId, name: value.name, manfen: value.manfen,
    ...(value.scoreS !== undefined ? { scoreS: value.scoreS } : typeof value.score === 'string' ? { scoreS: value.score } : value.score !== undefined ? { score: value.score } : {}),
    ...(displayRankValue(value.classRank) !== undefined ? { classRankS: displayRankValue(value.classRank) } : {}),
    ...(displayRankValue(value.gradeRank) !== undefined ? { gradeRankS: displayRankValue(value.gradeRank) } : {}),
    ...(displayRankValue(value.groupRank) !== undefined ? { groupRankS: displayRankValue(value.groupRank) } : {}),
    ...(value.classRankS !== undefined ? { classRankS: value.classRankS } : {}),
    ...(value.gradeRankS !== undefined ? { gradeRankS: value.gradeRankS } : {}),
    ...(value.groupRankS !== undefined ? { groupRankS: value.groupRankS } : {}),
    ...(value.classStuNum !== undefined ? { classStuNum: value.classStuNum } : {}),
    ...(value.gradeStuNum !== undefined ? { gradeStuNum: value.gradeStuNum } : {}),
    ...(value.groupStuNum !== undefined ? { groupStuNum: value.groupStuNum } : {}),
    ...(nonnegativeNumber(value.classAvg) !== undefined ? { classAvg: nonnegativeNumber(value.classAvg) } : {}),
    ...(nonnegativeNumber(value.gradeAvg) !== undefined ? { gradeAvg: nonnegativeNumber(value.gradeAvg) } : {}),
    papers: value.papers.map((paper) => ({
      ...(paper.paperId !== undefined ? { paperId: paper.paperId } : {}),
      ...(paper.pid !== undefined ? { pid: paper.pid } : {}),
      ...(paper.subject !== undefined ? { subject: paper.subject } : {}),
      ...(paper.name !== undefined ? { name: paper.name } : {}),
      manfen: paper.manfen,
      ...(paper.scoreS !== undefined ? { scoreS: paper.scoreS } : typeof paper.score === 'string' ? { scoreS: paper.score } : paper.score !== undefined ? { score: paper.score } : {}),
    })),
  };
}

/** 当前已验证可用的官方 H5 登录形态使用明文密码；roleType 由 Provider 版本固定传入。 */
function loginBody(roleType: 1 | 2, account: string, password: string): string {
  return JSON.stringify({ loginName: account, password, roleType, rememberMe: 1 });
}

function scoreValue(item: { scoreS?: string; score?: number }): number | undefined {
  return numericScore(item.scoreS ?? (item.score === undefined ? '' : String(item.score)));
}
/** 只汇总完整且与科目分数同口径的逐题数据，不用科目总分推算主观题。 */
function summarizeQuestions(questions: QuestionScore[], paper: Paper): QuestionScoreSummary[] | undefined {
  const totalScore = scoreValue(paper);
  if (!questions.length || totalScore === undefined || !Number.isFinite(totalScore) || totalScore < 0 || !Number.isFinite(paper.manfen) || paper.manfen <= 0) return undefined;
  if (new Set(questions.map((question) => question.id)).size !== questions.length) return undefined;
  if (questions.some((question) => question.kind === undefined || question.score === undefined || question.maxScore === undefined
    || !Number.isFinite(question.score) || !Number.isFinite(question.maxScore)
    || question.score < 0 || question.maxScore < 0 || question.score > question.maxScore)) return undefined;
  const sum = (items: QuestionScore[], field: 'score' | 'maxScore') => items.reduce((value, question) => value + question[field]!, 0);
  const epsilon = 0.000001;
  // 同时校验满分和得分，避免预览题、题组重复计入及原始分/赋分混算。
  if (Math.abs(sum(questions, 'maxScore') - paper.manfen) > epsilon || Math.abs(sum(questions, 'score') - totalScore) > epsilon) return undefined;
  const clean = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return (['objective', 'subjective'] as const).flatMap((kind) => {
    const items = questions.filter((question) => question.kind === kind);
    return items.length ? [{ kind, score: clean(sum(items, 'score')), maxScore: clean(sum(items, 'maxScore')) }] : [];
  });
}
/** 命中缓存成绩时按 subjectId 取出科目与其 pid；examId 不匹配或缺科目共用 undefined。 */
function cachedPaper(cachedResult: ExamResult | undefined, examId: string, subjectId: string): { paper: Paper; pid?: string; context?: Record<string, string> } | undefined {
  if (cachedResult?.examId !== examId) return undefined;
  const subject = cachedResult.subjects.find((candidate) => candidate.id === subjectId);
  if (!subject) return undefined;
  return { paper: { paperId: subjectId, subject: subject.subject, score: subject.score, manfen: subject.maxScore ?? 0 }, pid: subject.providerContext?.pid, context: subject.providerContext };
}
/** list/overview 的 time 是考试当天零点的毫秒时间戳（实测与考试名中的日期一致），按设备本地时区格式化为 YYYY-MM-DD。 */
function formatExamDate(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
/** 考生人数只接受正整数；官方用 -1 表示无数据。 */
function positiveCount(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function nonnegativeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 官方排名字符串（classRankS/gradeRankS/groupRankS）的三种形态（已对照官方 UI 验证）：
 * - 区间：`1~20`、`250~300/575人`（总览版内嵌分母）；
 * - 等级：`A`~`E`，按官方规则 A=前15%、B=15~50%、C=50~84%、D=84~99%、E=99~100%，需配合考生人数换算区间；
 * - 屏蔽：`**`（不下发名次）。
 * 数值字段 classRank/gradeRank/groupRank 实测恒为 -1 哨兵（且实测与官方展示不符），不采用。
 */
/** 等级字母按官方百分比规则换算名次区间；count 为分母人数。 */
function bandRange(letter: string, count: number): { rank: number; rankMax: number; total: number } | undefined {
  const n = Math.floor(count);
  if (n < 1) return undefined;
  const bounds = [1, 0.15, 0.5, 0.84, 0.99, 1].map((ratio, index) => index === 0 ? 1 : Math.min(n, Math.max(1, Math.floor(n * ratio))));
  const bands: Record<string, [number, number]> = { A: [bounds[0], bounds[1]], B: [bounds[1] + 1, bounds[2]], C: [bounds[2] + 1, bounds[3]], D: [bounds[3] + 1, bounds[4]], E: [bounds[4] + 1, bounds[5]] };
  const [from, to] = bands[letter.toUpperCase()] ?? [0, -1];
  return from <= to ? { rank: from, rankMax: to, total: n } : undefined;
}

export function rankFromDisplay(value: string | undefined, count: number | undefined): { rank: number; rankMax?: number; total?: number } | undefined {
  if (!value) return undefined;
  const text = value.trim().replace(/～/g, '~');
  if (text === '' || text === '**') return undefined;
  if (/^[A-Ea-e]$/.test(text)) {
    if (count === undefined) return undefined;
    return bandRange(text, count);
  }
  const range = /^(\d+)~(\d+)(?:\/(\d+)人)?$/.exec(text);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from < 1 || to < from) return undefined;
    const total = range[3] !== undefined ? Number(range[3]) : count;
    return { rank: from, rankMax: to, ...(total !== undefined && total >= to ? { total } : {}) };
  }
  const exact = /^(\d+)(?:\/(\d+)人)?$/.exec(text);
  if (exact) {
    const rank = Number(exact[1]);
    const total = exact[2] !== undefined ? Number(exact[2]) : count;
    return rank >= 1 && (total === undefined || total >= rank) ? { rank, ...(total !== undefined ? { total } : {}) } : undefined;
  }
  return undefined;
}

function paperName(paper: Paper): string { return paper.subject ?? paper.name ?? '未命名科目'; }
/** 档案里的排名展示串：屏蔽（**）与空串不进入上下文，避免展示无意义的占位。 */
function displayableRank(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text !== undefined && text !== '' && text !== '**' ? text : undefined;
}
function overviewRoute(examId: string): string { return `/v3/exam/${encodeURIComponent(examId)}/overview`; }
function answerPictureRoute(examId: string, paperId: string, pid: string): string {
  return `/v3/exam/${encodeURIComponent(examId)}/papers/${encodeURIComponent(paperId)}/answer-picture?pid=${encodeURIComponent(pid)}`;
}

function businessError(code: number): ProviderError {
  if (code >= 3001 && code <= 3006) return new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
  if ([4006, 4046].includes(code)) return new ProviderError('INVALID_CREDENTIALS', '账号、密码或所选账号类型不正确');
  if ([10, 11, 12, 13, 14, 2001, 2002, 4048].includes(code)) {
    return new ProviderError('UNSUPPORTED', '请在官方 App 完成必要验证或检查访问权限');
  }
  return new ProviderError('UNKNOWN', '好分数暂时无法完成此请求');
}

// 官方原生客户端 UA 为 `YX Android <Build.VERSION.RELEASE>`；Node 测试环境没有 react-native，退回官方抓包样本值 12。
function androidDevice(): { release: string; model: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS?: string; constants?: { Release?: unknown; Model?: unknown }; Version?: unknown } };
    if (Platform?.OS === 'android') {
      const release = Platform.constants?.Release ?? Platform.Version;
      const model = Platform.constants?.Model;
      return {
        release: release === undefined || release === null || release === '' ? '12' : String(release),
        model: typeof model === 'string' ? model : '',
      };
    }
  } catch { /* react-native 仅在 App 运行时可用 */ }
  return { release: '12', model: '' };
}

export function createHaofenshuProvider(roleType: 1 | 2, transport: FetchTransport = (...args) => fetch(...args)): ScoreProvider {
  const providerId = roleType === 1 ? 'haofenshu-student' : 'haofenshu-parent';
  // Weak references invalidate handed-out sessions locally without retaining their tokens.
  const revoked = new WeakSet<AuthSession>();
  // /v4/exam/archives（考试档案，官方 H5 形态）缓存：按会话隔离——同一 Provider 可能有多个账号，缓存绝不能互串；
  // 一次返回全部考试，分页在内存中切片；排名展示串（考试级与单科级）也从这里取。
  const archivesTtlMs = 15 * 60_000;
  const archivesCache = new Map<string, { data: z.infer<typeof archivesSchema>; at: number }>();
  function archivesFor(session: AuthSession): { data: z.infer<typeof archivesSchema>; at: number } | undefined {
    const cached = archivesCache.get(session.accessToken);
    return cached !== undefined && Date.now() - cached.at <= archivesTtlMs ? cached : undefined;
  }
  // 统一按官方 H5（mobile.haofenshu.com 页面）的形态请求：浏览器 UA 尾缀 HFS_XS/HFS_JZ（Constants.java：W=HFS_XS，X=HFS_JZ）
  // + hfs-token + 浏览器请求头。实测同一会话下，H5 形态登录创建的会话只接受 H5 形态请求。
  const device = androidDevice();
  // 官方 WebView 不伪造 UA：读取设备自身浏览器的 UA 后直接拼接应用标识（WebViewActivity.java:457-461），
  // 这里把同一后缀交给真实 WebView 的 applicationNameForUserAgent，由系统 UA 作为底座。
  const appVersionName = roleType === 1 ? '4.31.81' : '3.32.81';
  const h5UserAgentSuffix = `${roleType === 1 ? 'HFS_XS' : 'HFS_JZ'}version=${appVersionName}`;
  const h5UserAgent = `Mozilla/5.0 (Linux; Android ${device.release}${device.model ? `; ${device.model}` : ''}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Mobile Safari/537.36${h5UserAgentSuffix}`;
  function h5Headers(session: AuthSession | undefined): Record<string, string> {
    return {
      'User-Agent': h5UserAgent, Accept: '*/*', 'Content-Type': 'application/json',
      // React Native 的网络缓存会复用官方接口的 ETag；Provider 没有持久化 HTTP 响应，304 对本端等同于无数据。
      'Cache-Control': 'no-cache', Pragma: 'no-cache',
      Origin: 'https://mobile.haofenshu.com', Referer: 'https://mobile.haofenshu.com/',
      'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      // 官方 H5 的请求头只有 hfs-token；Cookie 来自登录响应写入的 hfs-session-id（浏览器 Cookie 容器的等价物）。
      ...(session ? { Cookie: `hfs-session-id=${session.accessToken}`, 'hfs-token': session.accessToken } : {}),
    };
  }
  async function request(session: AuthSession | undefined, route: string, init: RequestInit = {}): Promise<unknown> {
    if (session && (session.providerId !== providerId || revoked.has(session)
      || (session.expiresAt !== undefined && session.expiresAt <= Date.now()) || !tokenSchema.safeParse(session.accessToken).success)) {
      throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
    }
    const headers = { ...h5Headers(session), ...init.headers };
    try {
      const response = await requestWithTimeout(transport, host + route, {
        ...init, headers, cache: 'no-store' as const,
        credentials: 'omit', redirect: 'error',
      });
      if (response.status === 401) throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
      if ([403, 429, 451].includes(response.status)) throw new ProviderError('UNSUPPORTED', '请求受到访问或频率限制，请停止请求并在官方 App 检查');
      if (response.status !== 200) throw new ProviderError('NETWORK', '好分数服务请求失败', response.status >= 500);
      const body = parse(envelope, await response.json(), '响应');
      recordDiagnostic({ at: new Date().toISOString(), endpoint: `${providerId}/${diagnosticEndpoint(host + route) ?? 'response'}`, outcome: body.msg !== undefined && /锁定|风险/.test(body.msg) ? 'risk-rejected' : body.code === 0 ? 'business-ok' : 'business-error', code: body.code, source: 'provider' });
      // 官方把被风控锁定的账号提示为风险/锁定；不自动重试，交由界面引导使用官方 H5 登录。
      if (body.msg !== undefined && /锁定|风险/.test(body.msg)) {
        throw new ProviderError('RESTRICTED', '好分数访问受限，请稍后再试');
      }
      if (body.code === 1 && body.data == null) {
        if (route.startsWith('/v4/exam/archives?')) return { list: [] };
        throw new ProviderError('NOT_FOUND', '该接口暂未提供数据');
      }
      if (body.code !== 0) throw businessError(body.code);
      return body.data;
    } catch (error) {
      throwIfAborted(init.signal);
      if (error instanceof ProviderError) throw error;
      // Never expose network exceptions, response messages or validation input.
      throw new ProviderError('NETWORK', '好分数请求失败或超时', true);
    }
  }
  /** 拉取考试档案（按会话隔离的 15 分钟内存缓存）；分页切片与排名展示串共用这一份数据，避免翻页重复请求。 */
  async function fetchArchives(session: AuthSession, options?: ProviderRequestOptions): Promise<z.infer<typeof archivesSchema>> {
    const cached = archivesFor(session);
    if (cached !== undefined) return cached.data;
    // 每次真正发起考试档案请求前先访问一次官方配置接口；命中本地缓存时不重复探测。
    await probeRestriction(session, options);
    const data = parse(archivesSchema, await request(session, '/v4/exam/archives?grade=', { signal: options?.signal }), '考试档案');
    archivesCache.set(session.accessToken, { data, at: Date.now() });
    // 会话是低频长命对象，正常不会积累；超过上限时清理最旧的，防御异常使用方式。
    if (archivesCache.size > 8) for (const key of [...archivesCache.keys()].slice(0, archivesCache.size - 8)) archivesCache.delete(key);
    return data;
  }
  /** 探测官方配置接口；失败不阻断后续考试档案请求。 */
  async function probeRestriction(session: AuthSession, options?: ProviderRequestOptions): Promise<void> {
    try { await request(session, '/v2/config/school/hidden-config', { signal: options?.signal }); } catch (error) {
      throwIfAborted(options?.signal);
      // 探测本身被同一风控拦截时，仍由上层展示原始受限状态。
      if (!(error instanceof ProviderError)) return;
    }
  }

  return {
    metadata: { id: providerId, name: roleType === 1 ? '好分数学生版' : '好分数家长版',
      description: '实验接入：仅查询当前绑定学生；每页 5 场考试。', officialDomain: host },
    // Numeric rank fields are always the -1 sentinel; official rank display strings (rankS) are used instead.
    capabilities: { profile: true, exams: true, results: true, ranking: true, subjectDetails: true, questionScores: true, answerSheets: true },
    // 对照实验：官方 H5 自己的登录页，由页面自行创建会话（Provider 不提供凭据）。
    getOfficialH5LoginEntry() {
      return { url: 'https://mobile.haofenshu.com/pages/login/index', userAgentSuffix: h5UserAgentSuffix };
    },
    async getOfficialH5Bootstrap(session) {
      // 官方 getUserInfo 桥接返回的是缓存的完整 user-snapshot（含 linkedStudent/phoneNumber/feedToken 等，
      // 官方 H5 直接读 userInfo.linkedStudent.studentId）；这里保留服务端全部字段，只补 hfsToken，不做裁剪。
      const snapshot = parse(profileSchema.loose(), await request(session, '/v2/user-center/user-snapshot'), '学生信息');
      if (!snapshot.linkedStudent) throw new ProviderError('UNSUPPORTED', '请先在官方 App 绑定学生');
      // H5 判断"是否绑定学生"用的是严格相等 linkedStudent.isVirtual === 2；记录实际值与类型，便于对照页面表现。
      recordDiagnostic({ at: new Date().toISOString(), source: 'provider', endpoint: 'hfs/bootstrap', outcome: 'bootstrap',
        detail: `linked=yes isVirtual=${String(snapshot.linkedStudent.isVirtual)}(${typeof snapshot.linkedStudent.isVirtual}) roleType=${String(snapshot.roleType)}` });
      return {
        url: 'https://mobile.haofenshu.com/uni_modules/hfs-fe-uni-module/examPages/examRecord/index?isHFSVIPMember=false',
        userAgentSuffix: h5UserAgentSuffix,
        cookie: `hfs-session-id=${session.accessToken}`,
        userInfo: { ...snapshot, hfsToken: session.accessToken },
      };
    },
    async authenticate(account, password) {
      if (!account.trim() || !password) throw new ProviderError('INVALID_CREDENTIALS', '请输入账号和密码');
      const data = parse(loginSchema, await request(undefined, '/v2/users/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: loginBody(roleType, account.trim(), password),
      }), '登录');
      if (data.needUpdatePassword) throw new ProviderError('UNSUPPORTED', '请先在官方 App 完成账号安全操作');
      // Historical cookie Max-Age is not a promise about this session's lifetime.
      return { providerId, accountId: account.trim(), accessToken: data.token };
    },
    async authenticateWithToken(token) {
      if (!tokenSchema.safeParse(token.trim()).success) throw new ProviderError('INVALID_CREDENTIALS', '请输入有效的好分数 Token');
      const session = { providerId, accountId: 'token-login', accessToken: token.trim() };
      const profile = parse(profileSchema, await request(session, '/v2/user-center/user-snapshot'), '学生信息');
      if (!profile.linkedStudent) throw new ProviderError('UNSUPPORTED', '请先在官方 App 绑定学生');
      return { ...session, accountId: String(profile.linkedStudent.studentId) };
    },
    async getProfile(session, options?: ProviderRequestOptions) {
      const data = parse(profileSchema, await request(session, '/v2/user-center/user-snapshot', { signal: options?.signal }), '学生信息');
      if (!data.linkedStudent) throw new ProviderError('UNSUPPORTED', '请先在官方 App 绑定学生');
      return { id: String(data.linkedStudent.studentId), displayName: data.linkedStudent.studentName,
        schoolName: data.linkedStudent.schoolName, grade: data.linkedStudent.grade };
    },
    async getExamList(session, page = {}, options?: ProviderRequestOptions) {
      const start = page.offset ?? 0;
      if (!Number.isSafeInteger(start) || start < 0) throw new ProviderError('UNKNOWN', '分页参数无效');
      const data = await fetchArchives(session, options);
      // 档案无分页参数，官方一次下发全部；本端在内存缓存上切片成每页 5 场，翻页不再发请求。
      // 档案按时间正序返回，与 v3 列表一致改为新考试在前。
      const ordered = [...data.list].reverse();
      return ordered.slice(start, start + 5).map((exam) => ({ id: String(exam.examId), name: exam.name,
        date: exam.eventTime === undefined ? undefined : formatExamDate(exam.eventTime),
        ...(exam.type !== undefined && exam.type !== '' ? { category: exam.type } : {}),
        ...(exam.paperCount !== undefined ? { subjectCount: exam.paperCount } : {}) }));
    },
    async getExamResult(session, examId, options?: ProviderRequestOptions) {
      if (!/^[A-Za-z0-9_-]+$/.test(examId)) throw new ProviderError('NOT_FOUND', '考试标识无效');
      // 官方 H5 学科分析链路以 v4 总览为主；旧 v3 总览只作为兼容降级。
      let data: Overview;
      try {
        const v4 = parse(v4OverviewSchema, await request(session, `/v4/exam/overview?examId=${encodeURIComponent(examId)}`, { signal: options?.signal }), '考试总览');
        data = normalizeV4Overview(v4);
      } catch (error) {
        throwIfAborted(options?.signal);
        if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
        data = parse(overviewSchema, await request(session, overviewRoute(examId), { signal: options?.signal }), '考试总览');
      }
      if (String(data.examId) !== examId) throw new ProviderError('UNKNOWN', '返回的考试与所选考试不一致');
      // 排名展示串优先取考试档案（v4，官方最新展示，通常比 overview 更精细），overview 的 rankS 作回退；
      // 数值字段 classRank/gradeRank/groupRank 恒为 -1 哨兵，不采用；都不给的范围保持缺省，不编造名次。
      let archives: z.infer<typeof archivesSchema> | undefined;
      try {
        archives = await fetchArchives(session, options);
      } catch {
        throwIfAborted(options?.signal);
        // 档案是可选补充；补拉失败使用同一会话旧缓存，仍可展示已取得的 overview。
        archives = archivesCache.get(session.accessToken)?.data;
      }
      const entry = archives?.list.find((exam) => String(exam.examId) === examId);
      // 档案还按科目带单科排名（papers[].list[].id 即该科 pid）；屏蔽（**）的串不进入上下文。
      const paperRanks = new Map<string, { classRank?: string; classCount?: number; gradeRank?: string; gradeCount?: number }>();
      for (const trend of archives?.papers ?? []) {
        for (const paper of trend.list ?? []) {
          // examId 可缺省；最终以 overview 的 pid 精确匹配，不按科目名猜测。
          if (paper.examId !== undefined && String(paper.examId) !== examId) continue;
          const classRank = displayableRank(paper.classRank);
          const gradeRank = displayableRank(paper.gradeRank);
          if (classRank === undefined && gradeRank === undefined) continue;
          paperRanks.set(String(paper.id), {
            ...(classRank !== undefined ? { classRank, classCount: positiveCount(paper.classStuNum) } : {}),
            ...(gradeRank !== undefined ? { gradeRank, gradeCount: positiveCount(paper.gradeStuNum) } : {}),
          });
        }
      }
      const participants = [data.gradeStuNum, data.groupStuNum, data.classStuNum].map(positiveCount).find((value) => value !== undefined);
      const classCount = positiveCount(data.classStuNum) ?? positiveCount(entry?.classStuNum);
      const gradeCount = positiveCount(data.gradeStuNum) ?? positiveCount(entry?.gradeStuNum);
      const groupCount = positiveCount(data.groupStuNum);
      // 年级人数与联考组人数一致时视为校内考试：联考组维度没有额外信息，人数与排名都只保留年级。
      const schoolInternal = groupCount !== undefined && gradeCount === groupCount;
      const statistics = [
        { scope: '班级', averageScore: nonnegativeNumber(data.classAvg), participantCount: classCount },
        { scope: '年级', averageScore: nonnegativeNumber(data.gradeAvg), participantCount: gradeCount },
        ...(schoolInternal ? [] : [{ scope: '总排名', participantCount: groupCount }]),
      ].filter((stat) => stat.averageScore !== undefined || stat.participantCount !== undefined);
      const rankSources: { scope: Ranking['scope']; display?: string; count?: number }[] = [
        { scope: 'class', display: entry?.classRank ?? data.classRankS, count: classCount },
        { scope: 'grade', display: entry?.gradeRank ?? data.gradeRankS, count: gradeCount },
        ...(schoolInternal ? [] : [{ scope: 'group' as const, display: data.groupRankS, count: groupCount }]),
      ];
      const rankings: Ranking[] = rankSources.flatMap(({ scope, display, count }) => {
        const parsed = rankFromDisplay(display, count);
        return parsed ? [{ scope, ...parsed }] : [];
      });
      return { examId, examName: data.name, totalScore: scoreValue(data), maxTotalScore: data.manfen,
        ...(participants !== undefined ? { participantCount: participants } : {}),
        ...(statistics.length ? { statistics } : {}),
        ...(rankings.length ? { rankings } : {}),
        subjects: data.papers.map((item) => {
          const pid = item.pid === undefined ? undefined : String(item.pid);
          const trend = pid === undefined ? undefined : paperRanks.get(pid);
          // 单科人数优先取档案的按科人数（与单科排名同源，比考试总人数更准确）。
          const contextClassCount = trend?.classCount ?? classCount;
          const contextGradeCount = trend?.gradeCount ?? gradeCount;
          return { id: item.paperId === undefined ? undefined : String(item.paperId), subject: paperName(item), score: scoreValue(item), maxScore: item.manfen,
            providerContext: pid === undefined ? undefined : {
              pid,
              ...(contextClassCount !== undefined ? { classStuNum: String(contextClassCount) } : {}),
              ...(contextGradeCount !== undefined ? { gradeStuNum: String(contextGradeCount) } : {}),
              ...(trend?.classRank !== undefined ? { classRank: trend.classRank, ...(trend.classCount !== undefined ? { classCount: String(trend.classCount) } : {}) } : {}),
              ...(trend?.gradeRank !== undefined ? { gradeRank: trend.gradeRank, ...(trend.gradeCount !== undefined ? { gradeCount: String(trend.gradeCount) } : {}) } : {}),
            } };
        }) };
    },
    async getSubjectDetail(session, examId, subjectId, cachedResult, options?: ProviderRequestOptions) {
      const cached = cachedPaper(cachedResult, examId, subjectId);
      if (cachedResult?.examId === examId && !cached) throw new ProviderError('NOT_FOUND', '该科目暂无成绩');
      let item: Paper | undefined;
      let pid: string | undefined;
      let classCount: number | undefined;
      let gradeCount: number | undefined;
      if (cached) {
        item = cached.paper;
        pid = cached.pid;
        classCount = positiveCount(cached.context?.classStuNum);
        gradeCount = positiveCount(cached.context?.gradeStuNum);
      } else {
        const data = parse(briefSchema, await request(session, `/v3/exam/${encodeURIComponent(examId)}/brief?withSubPapers=1`, { signal: options?.signal }), '科目详情');
        item = data.papers.find((paper) => String(paper.paperId ?? '') === subjectId);
        if (!item) throw new ProviderError('NOT_FOUND', '该科目暂无成绩');
        const overview = parse(overviewSchema, await request(session, overviewRoute(examId), { signal: options?.signal }), '科目题目');
        pid = overview.papers.find((candidate) => String(candidate.paperId ?? '') === subjectId)?.pid?.toString();
        classCount = positiveCount(overview.classStuNum);
        gradeCount = positiveCount(overview.gradeStuNum);
      }
      // 官方排名字段未验证且可能被掩码，仅展示参考人数。
      const statistics = [
        { scope: '班级', participantCount: classCount },
        { scope: '年级', participantCount: gradeCount },
      ].filter((stat): stat is { scope: string; participantCount: number } => stat.participantCount !== undefined);
      if (!pid) return { subjectId, subject: paperName(item), score: scoreValue(item), maxScore: item.manfen, ...(statistics.length ? { statistics } : {}) };
      const picture = parse(answerPictureSchema, await request(session, answerPictureRoute(examId, subjectId, pid), { signal: options?.signal }), '科目题目');
      // type：1=主观题，2=客观题（客观题才带 myAnswer/answer；主观题的作答在答题卡图片里）。
      const questions: QuestionScore[] = (picture.questions ?? []).map((question) => ({ id: String(question.id), label: question.name ?? String(question.id), score: question.score, maxScore: question.manfen,
          ...(question.type === 1 || question.type === 2 ? { kind: question.type === 1 ? 'subjective' as const : 'objective' as const } : {}),
          ...(question.myAnswer != null && question.myAnswer !== '' ? { myAnswer: question.myAnswer } : {}),
          ...(question.answer != null && question.answer !== '' ? { answer: question.answer } : {}) }));
      const questionScoreSummaries = summarizeQuestions(questions, item);
      return { subjectId, subject: paperName(item), score: scoreValue(item), maxScore: item.manfen, ...(statistics.length ? { statistics } : {}), questions,
        ...(questionScoreSummaries ? { questionScoreSummaries } : {}),
        answerSheets: (picture.url ?? []).map((url) => ({ subject: paperName(item), subjectId, url, watermarked: false })) };
    },
    async getAnswerSheets(session, examId, subjectId, cachedResult, options?: ProviderRequestOptions) {
      const sheets: AnswerSheet[] = [];
      const cached = cachedPaper(cachedResult, examId, subjectId);
      if (cachedResult?.examId === examId && !cached) return sheets;
      let paper: Paper | undefined;
      let pid: string | undefined;
      if (cached) {
        paper = cached.paper;
        pid = cached.pid;
      } else {
        const overview = parse(overviewSchema, await request(session, overviewRoute(examId), { signal: options?.signal }), '答题卡科目');
        paper = overview.papers.find((item) => String(item.paperId ?? '') === subjectId);
        pid = paper?.pid?.toString();
      }
      if (!paper || paper.paperId === undefined || !pid) return sheets;
      const data = parse(answerPictureSchema, await request(session, answerPictureRoute(examId, String(paper.paperId), pid), { signal: options?.signal }), '答题卡');
      for (const url of data.url ?? []) sheets.push({ subject: paperName(paper), subjectId: String(paper.paperId), url, watermarked: false });
      return sheets;
    },
    async logout(session) { revoked.add(session); },
  };
}

export const haofenshuParentProvider = createHaofenshuProvider(2);
export const haofenshuStudentProvider = createHaofenshuProvider(1);
