import { z } from 'zod';
import {
  ProviderError, type AuthSession, type QuestionScore,
  type Ranking, type ReportSection, type SubjectScore, type SubjectStatistic,
} from '../domain/models';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import { numericScore, parseValidated } from './codec';

/**
 * 海豚阅卷（学生端）直连 Provider。
 *
 * 协议来自 2026-10-09 学生端小程序抓包与线上实测（analysis/haitun/），要点：
 * - 全部接口为 JSON + 统一信封 `{errno, errmsg, data, traceId}`；errno=0 为成功。
 * - 「登录已失效」存在 HTTP 401 与 HTTP 200 + errno 401 两种形态（数据接口 401 响应、
 *   刷新接口 200 响应），统一按 errno 判定。
 * - accessToken 有效期仅 900 秒；refreshToken 为一次性令牌，刷新后旧令牌立即作废，
 *   因此 refreshSession 必须把下发的 refreshToken 写回会话上下文（withAccount 负责持久化），
 *   刷新失败时外层自动回退为密码重登。
 * - 登录错误语义（实测）：手机号或密码错误 = errno 401；密码格式不符 = errno 400。
 * - 答题卡图片托管在 ossimage.haitunyuejuan.com（http），免鉴权直链，URL 即访问凭据；
 *   官方客户端的分数标注是覆盖层渲染，原始扫描件不含，故只提供无水印版。
 */
const host = 'https://student-api.haitunyuejuan.com';
// 实测：服务端当前不校验 UA；与项目负责人约定固定为小程序抓包 UA，避免后续风控收紧。
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B)'
  + ' NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)'
  + ' UnifiedPCWindowsWechat(0xf2541d41) XWEB/25560';
/** 会话提前量：900 秒有效期按 30 秒 skew 提前判定过期，交给统一刷新链路。 */
const expirySkewSeconds = 30;
/** 平台接口无分页参数，一次下发全部考试；本端在内存中切片成每页 5 场（与好分数一致）。 */
const examPageSize = 5;

// ---------- 响应结构（字段全部来自抓包实测；缺失字段保持可选，不虚构默认值） ----------
const envelopeSchema = z.object({ errno: z.number(), errmsg: z.string().optional(), data: z.unknown() });
const sessionDataSchema = z.object({
  accessToken: z.string().min(20), refreshToken: z.string().min(20), expiresIn: z.number().positive(),
});
const bindingsSchema = z.array(z.object({
  bindingId: z.number().int(), studentId: z.number().int(), name: z.string().min(1),
  xuehao: z.string().optional(), kaohao: z.string().optional(), schoolName: z.string().optional(),
  grade: z.string().optional(), banji: z.string().optional(), default: z.number().optional(),
}));
const examsSchema = z.array(z.object({
  examId: z.number().int(), examName: z.string().min(1), beginTime: z.string().optional(),
}));
const subjectRowSchema = z.object({
  subjectId: z.number().int(), subjectName: z.string(),
  score: z.string(), fullScore: z.number().nullable().optional(),
  classRank: z.number().nullable().optional(), gradeRank: z.number().nullable().optional(),
  classAvgScore: z.number().nullable().optional(), gradeAvgScore: z.number().nullable().optional(),
  beatClass: z.number().nullable().optional(), beatGrade: z.number().nullable().optional(),
});
const paperBriefRowSchema = z.object({
  questionNo: z.string(), score: z.number(), fullScore: z.number(), questionType: z.string(),
});
const subjectDetailSchema = subjectRowSchema.extend({ paperBrief: z.array(paperBriefRowSchema).optional() });
const smallScoresSchema = z.array(z.object({
  tihao: z.string().min(1), questionType: z.string(), score: z.number(), fullScore: z.number(),
  stuAnswer: z.string().nullable().optional(), answer: z.string().nullable().optional(),
}));
const questionAnalysisSchema = z.array(z.object({
  tihao: z.string().nullable().optional(), questionNo: z.string().nullable().optional(),
  type: z.union([z.number(), z.string()]), typeName: z.string(), fullScore: z.number(), myScore: z.number(),
  gradeRightRate: z.number(), gradeAvgScore: z.number(),
}));
const answerSheetDataSchema = z.object({ imgs: z.array(z.string().min(1)) });

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  return parseValidated(schema, raw, `海豚阅卷${label}结构不符合预期`);
}

function defaultBinding(bindings: z.infer<typeof bindingsSchema>): z.infer<typeof bindingsSchema>[number] | undefined {
  return bindings.find((item) => item.default === 1) ?? bindings[0];
}

function questionAnalysisReport(data: z.infer<typeof questionAnalysisSchema> | undefined): ReportSection[] | undefined {
  if (!data?.length) return undefined;
  return [{
    id: 'haitun-question-analysis',
    title: '逐题分析',
    items: data.map((item) => ({
      // tihao 与 small-scores 的题目标识一致；合并科目数量可能不同，不能按数组下标配对。
      label: `${item.tihao?.trim() || item.questionNo?.trim() || '题号未提供'} · ${item.typeName}`,
      values: {
        '本人得分': `${item.myScore} / ${item.fullScore}`,
        '年级均分': String(item.gradeAvgScore),
        '年级正确率': `${item.gradeRightRate}%`,
      },
    })),
  }];
}

/** 平台标识为纯数字 ID。 */
function numericId(value: string): boolean {
  return /^\d{1,16}$/.test(value);
}

export interface HaitunyuejuanOptions {
  transport?: FetchTransport;
}

export function createHaitunyuejuanProvider(options: HaitunyuejuanOptions = {}): ScoreProvider {
  const providerId = 'haitunyuejuan';
  const transport: FetchTransport = options.transport ?? ((...args) => fetch(...args));
  // 弱引用让注销后的会话立即本地失效，而不必长期持有 token。
  const revoked = new WeakSet<AuthSession>();

  function assertSession(session: AuthSession): void {
    if (session.providerId !== providerId || revoked.has(session) || !session.accessToken
      || (session.expiresAt !== undefined && session.expiresAt <= Date.now())) {
      throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
    }
  }

  /** 数据接口都要求 studentBindingId + studentId，二者在登录后取默认绑定并缓存在会话上下文。 */
  function contextBinding(session: AuthSession): { bindingId: string; studentId: string } {
    assertSession(session);
    const bindingId = session.providerContext?.['bindingId'];
    const studentId = session.providerContext?.['studentId'];
    if (!bindingId || !studentId) throw new ProviderError('SESSION_EXPIRED', '学生信息不完整，请重新登录');
    return { bindingId, studentId };
  }

  function withQuery(session: AuthSession, path: string): string {
    const { bindingId, studentId } = contextBinding(session);
    return `${host}${path}?studentBindingId=${encodeURIComponent(bindingId)}&studentId=${encodeURIComponent(studentId)}`;
  }

  /** 统一请求入口：携带 UA 与 Bearer token，按「先信封后 HTTP 状态」的顺序映射错误。 */
  async function request(session: AuthSession | undefined, target: string, init: RequestInit = {}): Promise<{ data: unknown }> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': userAgent, 'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      };
      const response = await requestWithTimeout(transport, target, { ...init, headers, credentials: 'omit' });
      let body: unknown;
      try { body = await response.json(); } catch { body = undefined; }
      const envelope = envelopeSchema.safeParse(body);
      if (envelope.success) {
        if (envelope.data.errno === 0) return { data: envelope.data.data };
        // 平台把「登录已失效」「刷新令牌无效」等会话问题统一编码为 errno 401。
        if (envelope.data.errno === 401) throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
        throw new ProviderError('UNKNOWN', '海豚阅卷暂时无法完成此请求');
      }
      if (response.status === 401 || response.status === 403) throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
      if (response.status === 429) throw new ProviderError('UNSUPPORTED', '请求受到频率限制，请稍后再试');
      throw new ProviderError('NETWORK', '海豚阅卷服务请求失败', response.status >= 500);
    } catch (error) {
      throwIfAborted(init.signal);
      if (error instanceof ProviderError) throw error;
      // 不向调用方透出网络异常原文或响应内容。
      throw new ProviderError('NETWORK', '海豚阅卷请求失败或超时', true);
    }
  }

  function sessionFromLogin(data: z.infer<typeof sessionDataSchema>, accountId: string, context?: AuthSession['providerContext']): AuthSession {
    return {
      providerId, accountId, accessToken: data.accessToken,
      expiresAt: Date.now() + (data.expiresIn - expirySkewSeconds) * 1000,
      providerContext: { ...context, refreshToken: data.refreshToken },
    };
  }

  return {
    metadata: {
      id: providerId, name: '海豚阅卷',
      description: '直连官方学生端服务；手机号密码登录，支持名次、逐题小分与答题卡。',
      officialDomain: host,
    },
    capabilities: { profile: true, exams: true, results: true, ranking: true, subjectDetails: true, questionScores: true, answerSheets: true },
    async authenticate(account, password) {
      if (!account.trim() || !password) throw new ProviderError('INVALID_CREDENTIALS', '请输入手机号和密码');
      const login = await request(undefined, `${host}/api/student/v1/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ phone: account.trim(), password, code: '' }),
      }).catch((error: unknown) => {
        // 实测：手机号或密码错误时平台返回 errno 401；对登录而言这是凭据问题而非会话过期。
        if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') {
          throw new ProviderError('INVALID_CREDENTIALS', '手机号或密码不正确');
        }
        throw error;
      });
      const data = parse(sessionDataSchema, login.data, '登录结果');
      const session = sessionFromLogin(data, account.trim());
      const bindings = parse(bindingsSchema, (await request(session, `${host}/api/student/v1/students`)).data, '学生信息');
      const selected = defaultBinding(bindings);
      if (!selected) throw new ProviderError('UNSUPPORTED', '该账号未绑定学生，请在官方小程序完成绑定后再登录');
      session.providerContext = {
        ...session.providerContext,
        bindingId: String(selected.bindingId), studentId: String(selected.studentId), studentName: selected.name,
      };
      return session;
    },
    async refreshSession(session) {
      const refreshToken = session.providerContext?.['refreshToken'];
      if (!refreshToken) throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
      const body = await request(undefined, `${host}/api/student/v1/auth/refresh`, {
        method: 'POST', body: JSON.stringify({ refreshToken }),
      });
      const data = parse(sessionDataSchema, body.data, '刷新结果');
      // refreshToken 一次性轮换：必须写回新令牌，否则刷新成功一次后本会话即报废。
      return sessionFromLogin(data, session.accountId, session.providerContext);
    },
    async getProfile(session, options?: ProviderRequestOptions) {
      assertSession(session);
      const bindings = parse(bindingsSchema, (await request(session, `${host}/api/student/v1/students`, { signal: options?.signal })).data, '学生信息');
      const current = contextBinding(session);
      const selected = bindings.find((binding) => String(binding.bindingId) === current.bindingId && String(binding.studentId) === current.studentId);
      if (!selected) throw new ProviderError('NOT_FOUND', '当前学生已不在绑定列表中，请切换学生');
      return {
        id: String(selected.studentId), displayName: selected.name,
        schoolName: selected.schoolName || undefined, grade: selected.grade || undefined,
      };
    },
    async getProfiles(session, options) {
      assertSession(session);
      const bindings = parse(bindingsSchema, (await request(session, `${host}/api/student/v1/students`, { signal: options?.signal })).data, '学生信息');
      return bindings.map((binding) => ({
        id: String(binding.bindingId), displayName: binding.name,
        schoolName: binding.schoolName || undefined, grade: binding.grade || undefined,
        selected: String(binding.bindingId) === session.providerContext?.bindingId && String(binding.studentId) === session.providerContext?.studentId,
        providerContext: { bindingId: String(binding.bindingId), studentId: String(binding.studentId) },
      }));
    },
    async selectProfile(session, profileId, options) {
      assertSession(session);
      if (!numericId(profileId)) throw new ProviderError('NOT_FOUND', '学生标识无效');
      const bindings = parse(bindingsSchema, (await request(session, `${host}/api/student/v1/students`, { signal: options?.signal })).data, '学生信息');
      const selected = bindings.find((binding) => String(binding.bindingId) === profileId);
      if (!selected) throw new ProviderError('NOT_FOUND', '未找到该绑定学生');
      return {
        ...session,
        providerContext: {
          ...session.providerContext,
          bindingId: String(selected.bindingId), studentId: String(selected.studentId), studentName: selected.name,
        },
      };
    },
    async getExamList(session, page = {}, options?: ProviderRequestOptions) {
      const start = page.offset ?? 0;
      if (!Number.isSafeInteger(start) || start < 0) throw new ProviderError('UNKNOWN', '分页参数无效');
      const exams = parse(examsSchema, (await request(session, withQuery(session, '/api/student/v1/exams'), { signal: options?.signal })).data, '考试列表');
      return exams.slice(start, start + examPageSize).map((exam) => ({
        id: String(exam.examId), name: exam.examName, date: exam.beginTime || undefined,
      }));
    },
    async getExamResult(session, examId, options?: ProviderRequestOptions) {
      if (!numericId(examId)) throw new ProviderError('NOT_FOUND', '考试标识无效');
      const [exams, rows] = await Promise.all([
        request(session, withQuery(session, '/api/student/v1/exams'), { signal: options?.signal }).then((body) => parse(examsSchema, body.data, '考试列表')),
        request(session, withQuery(session, `/api/student/v1/exams/${encodeURIComponent(examId)}/subjects`), { signal: options?.signal }).then((body) => parse(z.array(subjectRowSchema), body.data, '科目成绩')),
      ]);
      const exam = exams.find((item) => String(item.examId) === examId);
      if (!exam) throw new ProviderError('NOT_FOUND', '在最近的考试中没有找到该考试');
      // 首行是总分汇总（subjectId=0、科目名为空），其余为科目行。
      const total = rows.find((row) => row.subjectId === 0 || row.subjectName === '');
      const subjects = rows.filter((row) => row.subjectId !== 0 && row.subjectName !== '');
      const rankings: Ranking[] = ([
        { scope: 'class' as const, rank: total?.classRank },
        { scope: 'grade' as const, rank: total?.gradeRank },
      ] satisfies { scope: 'class' | 'grade'; rank?: number | null }[])
        .flatMap((item) => typeof item.rank === 'number'
          ? [{ scope: item.scope, rank: item.rank }]
          : []);
      const subjectScores: SubjectScore[] = subjects.map((row) => {
        const context: Record<string, string> = {};
        if (row.beatClass !== null && row.beatClass !== undefined) context.beatClass = String(row.beatClass);
        if (row.beatGrade !== null && row.beatGrade !== undefined) context.beatGrade = String(row.beatGrade);
        if (row.classAvgScore !== null && row.classAvgScore !== undefined) context.classAvgScore = String(row.classAvgScore);
        if (row.gradeAvgScore !== null && row.gradeAvgScore !== undefined) context.gradeAvgScore = String(row.gradeAvgScore);
        return {
          id: String(row.subjectId), subject: row.subjectName,
          score: numericScore(row.score), maxScore: row.fullScore ?? undefined,
          ...(Object.keys(context).length ? { providerContext: context } : {}),
        };
      });
      const defeatRates = [
        { scope: 'class' as const, value: total?.beatClass },
        { scope: 'grade' as const, value: total?.beatGrade },
      ].filter((item): item is { scope: 'class' | 'grade'; value: number } => typeof item.value === 'number' && item.value >= 0 && item.value <= 100);
      // 平台不总在汇总行给满分；各科满分都有值时按官方语义取加和。
      const maxTotalScore = total?.fullScore ?? (subjects.every((row) => typeof row.fullScore === 'number' && row.fullScore > 0)
        ? subjects.reduce((sum, row) => sum + (row.fullScore ?? 0), 0)
        : undefined);
      return {
        examId, examName: exam.examName, subjects: subjectScores,
        totalScore: total ? numericScore(total.score) : undefined,
        maxTotalScore,
        ranking: rankings.find((item) => item.scope === 'grade') ?? rankings[0],
        ...(rankings.length ? { rankings } : {}),
        gradePercentile: total?.beatGrade !== null && total?.beatGrade !== undefined ? `超过${total.beatGrade}%` : undefined,
        ...(defeatRates.length ? { defeatRates } : {}),
      };
    },
    async getSubjectDetail(session, examId, subjectId, _cachedResult, options?: ProviderRequestOptions) {
      if (!numericId(examId) || !numericId(subjectId)) throw new ProviderError('NOT_FOUND', '考试或科目标识无效');
      const path = `/api/student/v1/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}`;
      // 明细与小分相互独立；小分缺失（无逐题权限等）不阻断科目页，仅提示。
      const [detail, smallScores, questionAnalysis] = await Promise.all([
        request(session, withQuery(session, `${path}/detail`), { signal: options?.signal }).then((body) => parse(subjectDetailSchema, body.data, '科目明细')),
        request(session, withQuery(session, `${path}/small-scores`), { signal: options?.signal })
          .then((body) => parse(smallScoresSchema, body.data, '逐题小分'))
          .catch((error: unknown) => {
            throwIfAborted(options?.signal);
            if (error instanceof ProviderError && error.code !== 'SESSION_EXPIRED') return undefined;
            throw error;
          }),
        request(session, withQuery(session, `${path}/question-analysis`), { signal: options?.signal })
          .then((body) => parse(questionAnalysisSchema, body.data, '逐题分析'))
          .catch((error: unknown) => {
            throwIfAborted(options?.signal);
            if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
            return undefined;
          }),
      ]);
      const questions: QuestionScore[] | undefined = smallScores?.map((row) => {
        const kind = row.questionType === '1' ? 'objective' as const : row.questionType === '2' ? 'subjective' as const : undefined;
        return {
          id: row.tihao, label: row.tihao, score: row.score, maxScore: row.fullScore,
          ...(kind ? { kind } : {}),
          ...(kind === 'objective' ? { myAnswer: row.stuAnswer || undefined, answer: row.answer || undefined } : {}),
        };
      });
      const summaries = detail.paperBrief?.flatMap((row) => {
        const kind = row.questionType === '1' ? 'objective' as const : row.questionType === '2' ? 'subjective' as const : undefined;
        return kind ? [{ kind, score: row.score, maxScore: row.fullScore }] : [];
      });
      const reportSections = questionAnalysisReport(questionAnalysis);
      const statistics: SubjectStatistic[] = [
        { scope: '班级', averageScore: detail.classAvgScore ?? undefined, rank: detail.classRank ?? undefined },
        { scope: '年级', averageScore: detail.gradeAvgScore ?? undefined, rank: detail.gradeRank ?? undefined },
      ].filter((item) => item.averageScore !== undefined || item.rank !== undefined);
      const defeatRates = [
        { scope: 'class' as const, value: detail.beatClass },
        { scope: 'grade' as const, value: detail.beatGrade },
      ].filter((item): item is { scope: 'class' | 'grade'; value: number } => typeof item.value === 'number' && item.value >= 0 && item.value <= 100);
      return {
        subjectId, subject: detail.subjectName,
        score: numericScore(detail.score), maxScore: detail.fullScore ?? undefined,
        ...(defeatRates.length ? { defeatRates } : {}),
        ...(statistics.length ? { statistics } : {}),
        ...(questions ? { questions } : {}),
        ...(summaries?.length ? { questionScoreSummaries: summaries } : {}),
        ...(reportSections ? { reportSections } : {}),
        questionNotice: questions?.length ? undefined : '平台未提供本场科目的逐题小分。',
      };
    },
    async getAnswerSheets(session, examId, subjectId, cachedResult, options?: ProviderRequestOptions) {
      if (!numericId(subjectId)) throw new ProviderError('NOT_FOUND', '科目标识无效');
      const data = parse(answerSheetDataSchema, (await request(session, withQuery(session, `/api/student/v1/papers/${encodeURIComponent(subjectId)}/answer-sheet`), { signal: options?.signal })).data, '答题卡');
      const subject = cachedResult?.subjects.find((item) => item.id === subjectId)?.subject ?? subjectId;
      return data.imgs.map((url) => ({ subject, subjectId, url, watermarked: false }));
    },
    async logout(session) { revoked.add(session); },
  };
}

export const haitunyuejuanProvider = createHaitunyuejuanProvider();
