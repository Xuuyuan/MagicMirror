import { z } from 'zod';
import {
  ProviderError,
  type AnswerSheet,
  type AuthSession,
  type DistributionGroup,
  type ExamResult,
  type ExamSummary,
  type QuestionScore,
  type QuestionScoreSummary,
  type Ranking,
  type ReportSection,
  type StudentProfile,
  type SubjectDetail,
  type SubjectScore,
  type SubjectStatistic,
} from '../domain/models';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import { numericScore, parseValidated } from './codec';

/**
 * 小力学伴 Provider（家长手机号 + 密码登录，直连官方门户与报告服务）。
 *
 * 协议来自 2026-10-30 对官方网页 / H5 Bundle 的静态分析与本人测试账号的只读实测，
 * 脱敏记录见 analysis/xiaolixueban/provider-protocol-verification.md。要点：
 * - 登录必须走官方登录页的「手机号登录」通道：POST /loginserv/login/login，
 *   `{parameter:{cellphone,pwd,saveCookie:true}}`；「账号密码登录」是另一条带请求加密的链路。
 * - 门户接口（school.nicezhuanye.com）除 Cookie `loginToken` 外还必须带 `hqjl-user`/`hqjl-token`/
 *   `hqjlblkey`，否则返回 HTTP 911（门户前端解释为“用户信息失效”）。
 * - 报告会话经 `/nicezhuanye/ssoLogin/getTicket` + `auth/sso`（必须 `clientType:1`）换取
 *   `dongniLoginToken`；此后报告接口只需要请求头 `DONGNI-LOGIN`，小程序入口的
 *   `nzyToken`/`quarkToken` 不参与本链路。
 * - 报告接口的 `studentId` 是 `account/role` 里的 `relativeId`（学生ID），不是门户
 *   `studentUserID`，也不是换票返回的 `relativeId`（父关系ID）；用错返回 `10001 学生信息不存在`。
 * - 报告统一外壳 `{status,message,data,error}`：`0` 成功、`10051` 会话过期、`10057` 无权限；
 *   门户是 `{code,status,result}`，`911` 表示门户会话失效。
 * - 排名口径由官方 H5 源码确认：`classRanking`=班级、`examRanking`=年级、`ranking`=区域；
 *   区域排名在官方页面还受「会员 + 区域开关」控制，本 Provider 不提供区域排名。
 * - 平台不公布分数时 `scoreRankInfo` 只返回 `originalVolumeStatus`；此时总分为空、
 *   单科分数取自该科报告视图（如“物理(全体)”）。
 *
 * 隐私约定：`paper/question` 不按学生过滤，会返回同班全部同学的分数与作答。Provider 只按当前
 * 会话 `studentId` 取本人那一条，其余数据不展示、不缓存、不记录；任何接口都不记录响应正文。
 */

const providerId = 'xiaolixueban';
const providerName = '小力学伴';
const portalHost = 'https://school.nicezhuanye.com';
const reportHost = 'https://m.nicezhuanye.com';
const ssoHost = 'https://nicezhuanye.dongni100.com';
const cdnHost = 'https://cdn.dongni100.com';
const portalHomepage = `${portalHost}/portal/index.html#/homepage`;
/** 官方 H5 使用移动端 UA；实测服务端不校验。 */
const userAgent =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
/** 官方考试列表每页 20 条。 */
const examPageSize = 20;
/** 与官方页面一致的考试类型集合（2/3/4/5 校内外考试，7 联考，9/10 区域考试）。 */
const examTypes = '2,3,4,5,7,9,10';
const pollIntervalMs = 1000;
const pollAttempts = 12;
/** 官方前端以 UTC+8 渲染考试日期。 */
const dateOffsetMs = 8 * 60 * 60 * 1000;

// ---------- 响应结构（字段来自实测样本；缺失保持可选，不虚构默认值） ----------
const idLike = z
  .union([z.number(), z.string()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0, '标识不能为空');

const portalEnvelopeSchema = z.object({
  code: z.coerce.number(),
  status: z.string().optional(),
  errorMessage: z.string().optional(),
  message: z.string().optional(),
  result: z.unknown().optional(),
});
const portalStudentSchema = z.object({
  studentUserID: idLike,
  studentName: z.string().optional(),
  schoolID: idLike.optional(),
  schoolName: z.string().optional(),
  gradeID: idLike.optional(),
  gradeName: z.string().optional(),
  classID: idLike.optional(),
  className: z.string().optional(),
  regionID: idLike.optional(),
});
const portalChildrenSchema = z.object({
  studentUsers: z.array(portalStudentSchema),
});

const ssoSchema = z.object({
  dongniLoginToken: z.string().min(1),
  relativeId: idLike.optional(),
});
const roleUserSchema = z.object({
  userId: idLike,
  relativeId: idLike,
  parentStudentId: idLike.optional(),
  schoolId: idLike,
  classId: idLike.optional(),
  gradeId: idLike.optional(),
  studentName: z.string().optional(),
  nickname: z.string().optional(),
  gradeName: z.string().optional(),
  className: z.string().optional(),
  schoolName: z.string().optional(),
  userType: z.number().optional(),
  membershipStatus: z.number().optional(),
});
const roleDataSchema = z.array(z.object({ userList: z.array(roleUserSchema) }));

const reportEnvelopeSchema = z.object({
  status: z.coerce.number(),
  message: z.string().optional(),
  // 会话失效等错误外壳没有 data 字段，先按可选解析再判定业务码。
  data: z.unknown().optional(),
});

const examStatSchema = z.object({
  examId: idLike,
  examName: z.string().min(1),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
  examTypeName: z.string().optional(),
  stat: z
    .object({
      statId: z.number(),
      resultStatus: z.number().optional(),
      totalScore: z.number().optional(),
      // 赋分考试：originalScore 是原始分（官方列表文案“我的得分”），totalScore 是赋分。
      originalScore: z.number().nullish(),
      scoreChange: z.boolean().optional(),
      fullMark: z.string().optional(),
    })
    .optional(),
});
const examListSchema = z.object({
  exam: z.array(examStatSchema),
  totalCount: z.number().optional(),
});
const examInfoSchema = z.object({
  examId: idLike,
  examName: z.string().optional(),
  examStatus: z.number().optional(),
  examType: z.number().optional(),
});
const baseIndexSchema = z.array(
  z.object({
    schoolId: z.number().optional(),
    averageScore: z.union([z.number(), z.string()]).optional(),
    participationNumber: z.number().optional(),
    // 区域汇总行的单科均分（联考均分）从这里取；学校行也有同名结构。
    course: z
      .array(
        z.object({
          courseId: z.number().optional(),
          averageScore: z.union([z.number(), z.string()]).nullish(),
          participationNumber: z.number().nullish(),
        }),
      )
      .optional(),
  }),
);
const statViewSchema = z.array(
  z.object({
    statId: z.number(),
    statName: z.string().min(1),
    statStatus: z.number().optional(),
    statSort: z.number().optional(),
  }),
);
const rankRowSchema = z.object({
  courseId: z.number().optional(),
  courseName: z.string().optional(),
  totalScore: z.number().optional(),
  fullMark: z.string().optional(),
  examRanking: z.number().optional(),
  ranking: z.number().optional(),
  classRanking: z.number().optional(),
  examRankNumber: z.number().optional(),
  schoolRankNumber: z.number().optional(),
  classRankNumber: z.number().optional(),
  schoolAverageScore: z.string().optional(),
  classAverageScore: z.string().optional(),
});
const rankInfoSchema = z.object({
  originalVolumeStatus: z.number().optional(),
  scoreRanking: z.array(rankRowSchema).optional(),
});
const courseRankInfoSchema = z.object({
  scoreRanking: z
    .array(
      z.object({
        courseId: z.coerce.number(),
        totalScore: z.coerce.number().optional(),
        fullMark: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});
const levelInfoSchema = z.object({
  list: z.array(
    z.object({
      examId: idLike,
      statId: z.number().optional(),
      consistName: z.string().optional(),
    }),
  ),
});
const scoreRateSchema = z.object({
  studentScoreRate: z
    .array(z.object({ courseId: z.number(), scoreRate: z.string().optional() }))
    .optional(),
  scoreRate: z
    .array(z.object({ courseId: z.number(), averageRate: z.string().optional() }))
    .optional(),
});
const courseInfoSchema = z.array(
  z.object({
    courseId: z.number(),
    courseName: z.string().min(1),
    paperId: idLike.optional(),
  }),
);
const paperQuestionSchema = z.object({
  student: z
    .array(
      z.object({
        studentId: idLike,
        courseName: z.string().optional(),
        totalScore: z.number().optional(),
        questions: z
          .array(
            z.object({
              questionNumber: z.number(),
              structureNumber: z.string().optional(),
              scoreValue: z.number().optional(),
              finallyScore: z.number().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  totalCount: z.number().optional(),
});
const questionAnalysisSchema = z.object({
  question: z.array(
    z.object({
      questionNumber: z.number(),
      structureNumber: z.string().optional(),
      scoreValue: z.number().optional(),
      finallyScore: z.number().optional(),
      recognitionValue: z.string().optional(),
      isObjective: z.boolean().optional(),
      questionTypeName: z.string().optional(),
      scoreRate: z.string().optional(),
      classAverageScore: z.string().optional(),
      schoolAverageScore: z.string().optional(),
    }),
  ),
});
const scoreSectionSchema = z.array(
  z.object({
    courseId: z.number(),
    fullMark: z.string().optional(),
    participationNumber: z.number().optional(),
    scoreSection: z.array(
      z.object({
        open: z.union([z.string(), z.number()]).transform(String),
        close: z
          .union([z.string(), z.number()])
          .nullish()
          .transform((value) => (value == null ? value : String(value))),
        total: z.number(),
        cumulative: z.number().nullish(),
        ratio: z.number().optional(),
      }),
    ),
  }),
);
/** 总分分数段：school 返回对象，class 返回数组；含本人总分与参与人数。 */
const totalSectionRowSchema = z.object({
  classId: idLike.optional(),
  fullMark: z.union([z.string(), z.number()]).optional(),
  totalStudent: z.number().optional(),
  participationNumber: z.number().optional(),
  totalScore: z.number().nullish(),
  scoreSection: z.array(
    z.object({
      open: z.union([z.string(), z.number()]),
      close: z.union([z.string(), z.number()]).nullish(),
      total: z.number(),
      cumulative: z.number().nullish(),
      ratio: z.number().nullish(),
    }),
  ),
});
const totalSectionSchema = z.union([totalSectionRowSchema, z.array(totalSectionRowSchema)]);
const errorAnalysisSchema = z.array(
  z.object({
    questionNumber: z.number(),
    structureNumber: z.string().nullish(),
    scoreValue: z.number().nullish(),
    finallyScore: z.number().nullish(),
    recognitionValue: z.string().nullish(),
    // 客观题才下发正确答案；主观题为空或缺失。
    correctAnswer: z.string().nullish(),
  }),
);
const asyncStartSchema = z.object({ uuid: z.string().min(1) });
const asyncPollSchema = z.object({
  status: z.number(),
  data: z
    .object({
      studentInfo: z.object({ studentId: idLike }).optional(),
      answerCardList: z
        .array(
          z.object({
            pageNumber: z.number().optional(),
            filePath: z.string().optional(),
            correctPath: z.string().optional(),
            originFilePath: z.string().optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  return parseValidated(schema, raw, `${providerName}${label}结构不符合预期`);
}

/** 平台返回 `740.0000` 这类定长小数字符串；非法值一律视为缺失。 */
function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberFromValue(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? roundScore(value) : undefined;
  if (value === undefined) return undefined;
  const parsed = numericScore(value.trim());
  return parsed === undefined ? undefined : roundScore(parsed);
}

function numberFromString(value: string | undefined): number | undefined {
  return numberFromValue(value);
}

/** 平台比率是 0–1 小数；UI 使用 0–100，保留一位小数。 */
function percentFromRate(value: string | undefined): number | undefined {
  const parsed = value === undefined ? undefined : numericScore(value.trim());
  if (parsed === undefined) return undefined;
  return Math.round(parsed * 1000) / 10;
}

function sumQuestionAverage(
  questions: z.infer<typeof questionAnalysisSchema>['question'] | undefined,
  key: 'classAverageScore' | 'schoolAverageScore',
): number | undefined {
  if (!questions?.length) return undefined;
  const values = questions.map((question) => numberFromString(question[key]));
  if (!values.every((value): value is number => value !== undefined)) return undefined;
  return roundScore(values.reduce((total, value) => total + value, 0));
}

function formatExamDate(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const shifted = new Date(value + dateOffsetMs);
  if (Number.isNaN(shifted.getTime())) return undefined;
  return shifted.toISOString().slice(0, 10);
}

/** `school/scoreSection` 返回对象，`class/scoreSection` 返回数组。 */
function firstSectionRow(
  value: z.infer<typeof totalSectionSchema> | undefined,
): z.infer<typeof totalSectionRowSchema> | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 用总分分数段的累计人数估算名次区间：分段是 [open, close)，cumulative 为不低于 open 的人数。
 * 返回 [高于本段人数+1, 本段累计人数]，只能作为区间估计。
 */
function estimateRankFromSection(
  row: z.infer<typeof totalSectionRowSchema> | undefined,
  score: number | undefined,
): { rank: number; rankMax: number; total?: number } | undefined {
  if (!row || score === undefined || !Number.isFinite(score)) return undefined;
  const bucket = row.scoreSection.find((item) => {
    const open = Number(item.open);
    const close = item.close == null ? undefined : Number(item.close);
    return (
      Number.isFinite(open) &&
      score >= open &&
      (close === undefined || (Number.isFinite(close) && score < close))
    );
  });
  if (!bucket) return undefined;
  const cumulative = bucket.cumulative;
  if (cumulative === undefined || cumulative === null || cumulative <= 0) return undefined;
  const above = Math.max(0, cumulative - bucket.total);
  const rank = above + 1;
  return {
    rank,
    rankMax: Math.max(rank, cumulative),
    ...(row.participationNumber !== undefined ? { total: row.participationNumber } : {}),
  };
}

function estimateRankFromSubjectSection(
  row: z.infer<typeof scoreSectionSchema>[number] | undefined,
  score: number | undefined,
): { rank: number; rankMax: number; total?: number } | undefined {
  if (!row || score === undefined || !Number.isFinite(score)) return undefined;
  const bucket = row.scoreSection.find((item) => {
    const open = Number(item.open);
    const close = item.close == null ? undefined : Number(item.close);
    return (
      Number.isFinite(open) &&
      score >= open &&
      (close === undefined || (Number.isFinite(close) && score < close))
    );
  });
  if (!bucket?.cumulative || bucket.cumulative <= 0) return undefined;
  const above = Math.max(0, bucket.cumulative - bucket.total);
  return {
    rank: above + 1,
    rankMax: Math.max(above + 1, bucket.cumulative),
    ...(row.participationNumber !== undefined ? { total: row.participationNumber } : {}),
  };
}

function scoreRangeLabel(open: number, close: number | undefined): string {
  return close === undefined || !Number.isFinite(close) ? `[${open}, +∞)` : `[${open}, ${close})`;
}

/** 某一范围（班级/年级）的总分分数段条形图。 */
function distributionGroupOf(
  row: z.infer<typeof totalSectionRowSchema> | undefined,
  scope: 'class' | 'school',
  ownScore: number | undefined,
): DistributionGroup | undefined {
  if (!row?.scoreSection?.length) return undefined;
  const name = scope === 'class' ? '班级' : '学校';
  const participants = row.participationNumber;
  const totalStudents = row.totalStudent;
  const countText =
    participants !== undefined
      ? `${participants} 人参加${
          totalStudents !== undefined && totalStudents !== participants
            ? `，共 ${totalStudents} 人`
            : ''
        }`
      : totalStudents !== undefined
        ? `共 ${totalStudents} 人`
        : '';
  return {
    id: `xiaolixueban-${scope}-score-distribution`,
    title: `${name}分数分布`,
    layout: 'bars',
    unitLabel: '',
    questions: [
      {
        label: `${name}${countText ? `（${countText}）` : ''}`,
        bins: row.scoreSection.map((bucket) => {
          const open = Number(bucket.open);
          const close = bucket.close == null ? undefined : Number(bucket.close);
          return {
            label: scoreRangeLabel(open, close),
            value: `${bucket.total} 人`,
            ...(ownScore !== undefined &&
            Number.isFinite(open) &&
            ownScore >= open &&
            (close === undefined || (Number.isFinite(close) && ownScore < close))
              ? { highlight: true }
              : {}),
            ...(bucket.ratio !== undefined && bucket.ratio !== null
              ? { percent: Math.round(bucket.ratio * 1000) / 10 }
              : {}),
          };
        }),
      },
    ],
  };
}

/** 单科分数区间分布，沿用总分分布的横向条形图样式。 */
function subjectDistributionGroupOf(
  row: z.infer<typeof scoreSectionSchema>[number] | undefined,
  scope: 'class' | 'school',
  ownScore: number | undefined,
): DistributionGroup | undefined {
  if (!row?.scoreSection?.length) return undefined;
  const name = scope === 'class' ? '班级' : '学校';
  return {
    id: `xiaolixueban-${scope}-subject-score-distribution`,
    title: `${name}分数区间分布`,
    layout: 'bars',
    unitLabel: '',
    questions: [
      {
        label: row.participationNumber
          ? `${name}参考人数 ${row.participationNumber} 人`
          : `${name}参考人数`,
        bins: row.scoreSection.map((bucket) => {
          const open = Number(bucket.open);
          const close = bucket.close == null ? undefined : Number(bucket.close);
          return {
            label: scoreRangeLabel(open, close),
            value: `${bucket.total} 人`,
            ...(ownScore !== undefined &&
            Number.isFinite(open) &&
            ownScore >= open &&
            (close === undefined || (Number.isFinite(close) && ownScore < close))
              ? { highlight: true }
              : {}),
            ...(bucket.ratio !== undefined
              ? { percent: Math.round(bucket.ratio * 1000) / 10 }
              : {}),
          };
        }),
      },
    ],
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function collectCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [
    (headers.get('set-cookie') ?? '').split(/,(?=\s*[^=;,\s]+=)/).join('\n'),
  ];
  const values = raw.flatMap((value) => value.split('\n'));
  const pairs: string[] = [];
  for (const value of values) {
    // 只取首个 `name=value` 段，忽略 Path/HttpOnly 等属性。
    const pair = value.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) pairs.push(`${pair.slice(0, index).trim()}=${pair.slice(index + 1)}`);
  }
  return pairs.join('; ');
}

function profileOf(student: z.infer<typeof portalStudentSchema>): StudentProfile {
  return {
    id: student.studentUserID,
    displayName: student.studentName?.trim() || '未命名学生',
    schoolName: student.schoolName,
    grade: student.gradeName,
  };
}

interface ReportAddress {
  userId?: string;
  studentId?: string;
  /** 报告接口按学校维度校验；缺失时返回 `{"schoolId":"无效的ID"}`。 */
  schoolId?: string;
  classId?: string;
}

export interface XiaolixuebanOptions {
  transport?: FetchTransport;
  portalHost?: string;
  reportHost?: string;
  ssoHost?: string;
  /** 答题卡异步任务轮询间隔（毫秒）；默认 1000，测试可缩短。 */
  pollIntervalMs?: number;
}

export function createXiaolixuebanProvider(options: XiaolixuebanOptions = {}): ScoreProvider {
  const portal = options.portalHost ?? portalHost;
  const report = options.reportHost ?? reportHost;
  const sso = options.ssoHost ?? ssoHost;
  const pollDelay = options.pollIntervalMs ?? pollIntervalMs;
  const transport: FetchTransport = options.transport ?? ((...args) => fetch(...args));
  const revoked = new WeakSet<AuthSession>();

  function assertSession(session: AuthSession): void {
    if (
      session.providerId !== providerId ||
      revoked.has(session) ||
      !session.accessToken ||
      !session.providerContext?.studentId ||
      !session.providerContext?.portalToken
    )
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    if (session.expiresAt !== undefined && session.expiresAt <= Date.now())
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
  }

  function networkError(error: unknown, action: string): never {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('NETWORK', `${providerName}${action}失败或超时`, true);
  }

  /** 门户请求：Cookie + hqjl-* 头；HTTP 911 表示门户会话失效。 */
  async function portalRequest(
    path: string,
    init: {
      portal: { userId: string; token: string; cookie: string };
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await requestWithTimeout(transport, `${portal}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          Origin: portal,
          Referer: `${portal}/portal/`,
          'User-Agent': userAgent,
          Cookie: init.portal.cookie,
          'hqjl-user': init.portal.userId,
          'hqjl-token': init.portal.token,
        },
        body: JSON.stringify(init.body ?? { parameter: {} }),
        signal: init.signal,
      });
    } catch (error) {
      throwIfAborted(init.signal);
      networkError(error, '门户请求');
    }
    throwIfAborted(init.signal);
    if (response.status === 911 || response.status === 401 || response.status === 403)
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    if (response.status !== 200)
      throw new ProviderError('NETWORK', `${providerName}服务请求失败`, response.status >= 500);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('UNKNOWN', `${providerName}门户响应不是有效 JSON`);
    }
    const envelope = parse(portalEnvelopeSchema, raw, '门户响应');
    if (envelope.code !== 0) {
      const message = (envelope.errorMessage ?? envelope.message ?? '').trim();
      throw new ProviderError('UNKNOWN', message.slice(0, 60) || `${providerName}请求未成功`);
    }
    return envelope.result;
  }

  /** 报告请求的原始数据层：统一鉴权头、会话码与网络错误；不校验业务 schema。 */
  async function callReport(
    accessToken: string,
    address: ReportAddress,
    path: string,
    params: Record<string, string | number | undefined>,
    options: ProviderRequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(`${report}${path}`);
    const base: Record<string, string | number | undefined> = {
      clientType: 2,
      client_check_time: Date.now(),
      ...(address.userId ? { userId: address.userId } : {}),
      ...(address.studentId ? { studentId: address.studentId } : {}),
      ...(address.schoolId ? { schoolId: address.schoolId } : {}),
      ...(address.classId ? { classId: address.classId } : {}),
    };
    for (const [key, value] of Object.entries({ ...base, ...params }))
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await requestWithTimeout(transport, url.toString(), {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json;charset=UTF-8',
          Origin: report,
          Referer: `${report}/`,
          'User-Agent': userAgent,
          'DONGNI-LOGIN': accessToken,
          wechatType: '',
        },
        signal: options.signal,
      });
    } catch (error) {
      throwIfAborted(options.signal);
      networkError(error, '报告请求');
    }
    throwIfAborted(options.signal);
    if (response.status === 911 || response.status === 401 || response.status === 403)
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    if (response.status !== 200)
      throw new ProviderError('NETWORK', `${providerName}服务请求失败`, response.status >= 500);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('UNKNOWN', `${providerName}报告响应不是有效 JSON`);
    }
    const envelope = parse(reportEnvelopeSchema, raw, '报告响应');
    if (envelope.status === 10051)
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    if (envelope.status === 10057)
      throw new ProviderError('RESTRICTED', `${providerName}当前账号无权限查看该内容`);
    if (envelope.status !== 0) {
      const message = (envelope.message ?? '').trim();
      throw new ProviderError(
        'UNKNOWN',
        message.slice(0, 60) || `${providerName}暂时无法完成此请求`,
        message.includes('系统繁忙'),
      );
    }
    return envelope.data;
  }

  async function reportRequest<T>(
    session: AuthSession,
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | number | undefined>,
    options: ProviderRequestOptions | undefined,
    label: string,
  ): Promise<T> {
    assertSession(session);
    const data = await callReport(
      session.accessToken,
      {
        userId: session.providerContext?.reportUserId ?? session.providerContext?.portalUserId,
        studentId: session.providerContext?.studentId,
        schoolId: session.providerContext?.schoolId,
        classId: session.providerContext?.classId,
      },
      path,
      params,
      options,
    );
    return parse(schema, data, label);
  }

  /** 可选端点：失败按“平台未提供该数据”处理，但会话过期与取消必须上抛。 */
  async function optional<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
      if (isAbortError(error)) throw error;
      return undefined;
    }
  }

  /** 门户登录：手机号 + 密码通道（官方登录页的「手机号登录」）。 */
  async function portalLogin(
    account: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<{ userId: string; token: string; cookie: string }> {
    let response: Response;
    try {
      response = await requestWithTimeout(transport, `${portal}/loginserv/login/login`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          Origin: portal,
          Referer: `${portal}/login/`,
          'User-Agent': userAgent,
        },
        body: JSON.stringify({
          parameter: { cellphone: account.trim(), pwd: password, saveCookie: true },
        }),
        signal,
      });
    } catch (error) {
      throwIfAborted(signal);
      networkError(error, '登录');
    }
    throwIfAborted(signal);
    if (response.status >= 500)
      throw new ProviderError('NETWORK', `${providerName}登录服务暂不可用`, true);
    if (response.status !== 200)
      throw new ProviderError('NETWORK', `${providerName}登录请求未成功`);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('UNKNOWN', `${providerName}登录响应不是有效 JSON`);
    }
    const envelope = parse(portalEnvelopeSchema, raw, '登录响应');
    if (envelope.code !== 0) {
      const message = (envelope.errorMessage ?? envelope.message ?? '').trim();
      // 官方对「密码错误」和「登录过于频繁」使用同一文案，Provider 不自动重试。
      throw new ProviderError('INVALID_CREDENTIALS', message.slice(0, 60) || '账号或密码错误');
    }
    const result = parse(
      z.object({
        userList: z.array(
          z.object({
            userID: idLike,
            accesstoken: z.string().min(1),
            identity: z.string().optional(),
          }),
        ),
      }),
      envelope.result,
      '登录结果',
    );
    const user = result.userList[0];
    if (!user) throw new ProviderError('INVALID_CREDENTIALS', '账号或密码错误');
    const cookie = collectCookies(response);
    if (!cookie)
      throw new ProviderError('NETWORK', `${providerName}登录未返回门户会话，请重试`, true);
    return { userId: user.userID, token: user.accesstoken, cookie };
  }

  async function portalChildren(
    target: { userId: string; token: string; cookie: string },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof portalStudentSchema>[]> {
    const result = await portalRequest('/nicezhuanye/parent/getChilder', {
      portal: target,
      body: { parameter: { userID: target.userId } },
      signal,
    });
    const children = parse(portalChildrenSchema, result, '学生列表');
    if (!children.studentUsers.length)
      throw new ProviderError('UNSUPPORTED', `${providerName}未查询到绑定学生，暂不支持该账号角色`);
    return children.studentUsers;
  }

  /** 换取报告会话：ticket → dongniLoginToken → account/role（报告侧学生上下文）。 */
  async function issueReportSession(
    target: { userId: string; token: string; cookie: string },
    studentUserID: string,
    signal?: AbortSignal,
  ): Promise<{ accessToken: string; member: z.infer<typeof roleUserSchema> }> {
    const ticket = await portalRequest('/nicezhuanye/ssoLogin/getTicket', {
      portal: target,
      body: {
        parameter: { userID: target.userId, roleType: 'Parent', stuUserID: studentUserID },
      },
      signal,
    });
    if (typeof ticket !== 'string' || !ticket)
      throw new ProviderError('UNKNOWN', `${providerName}未取得报告会话票据，请重试`);
    let response: Response;
    try {
      response = await requestWithTimeout(transport, `${sso}/api/base/data/system/auth/sso`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          Origin: sso,
          Referer: `${sso}/auth/sso?dictKey=nicezhuanye`,
          'User-Agent': userAgent,
        },
        // 官方 SSO 页面固定 clientType=1；2 会返回 10002 登录失败。
        body: JSON.stringify({
          dictKey: 'nicezhuanye',
          ticket,
          referer: portalHomepage,
          loginUrl: '',
          clientType: 1,
          client_check_time: Date.now(),
        }),
        signal,
      });
    } catch (error) {
      throwIfAborted(signal);
      networkError(error, '报告会话换取');
    }
    throwIfAborted(signal);
    if (response.status !== 200)
      throw new ProviderError('NETWORK', `${providerName}报告会话换取失败`, true);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('UNKNOWN', `${providerName}报告会话换取响应不是有效 JSON`);
    }
    const envelope = parse(reportEnvelopeSchema, raw, '报告会话换取响应');
    if (envelope.status !== 0)
      throw new ProviderError('UNKNOWN', `${providerName}报告会话换取失败，请重新登录`);
    const ssoData = parse(ssoSchema, envelope.data, '报告会话');
    const roleData = parse(
      roleDataSchema,
      await callReport(ssoData.dongniLoginToken, {}, '/api/base/data/account/role', {}, { signal }),
      '账号角色',
    );
    const users = roleData[0]?.userList ?? [];
    const member =
      users.find((item) => item.parentStudentId === ssoData.relativeId) ??
      users.find((item) => item.userType === 5) ??
      users[0];
    if (!member) throw new ProviderError('UNSUPPORTED', `${providerName}未找到该学生的报告身份`);
    return { accessToken: ssoData.dongniLoginToken, member };
  }

  function sessionFrom(
    accountId: string,
    target: { userId: string; token: string; cookie: string },
    student: z.infer<typeof portalStudentSchema>,
    reportSession: { accessToken: string; member: z.infer<typeof roleUserSchema> },
  ): AuthSession {
    const { member } = reportSession;
    const context: Record<string, string> = {
      portalUserId: target.userId,
      portalToken: target.token,
      portalCookie: target.cookie,
      studentUserID: student.studentUserID,
      studentId: member.relativeId,
      reportUserId: member.userId,
      schoolId: member.schoolId,
    };
    const studentName = student.studentName?.trim() || member.studentName || member.nickname;
    if (studentName) context.studentName = studentName;
    const schoolName = student.schoolName ?? member.schoolName;
    if (schoolName) context.schoolName = schoolName;
    const gradeName = student.gradeName ?? member.gradeName;
    if (gradeName) context.gradeName = gradeName;
    const className = student.className ?? member.className;
    if (className) context.className = className;
    if (member.classId) context.classId = member.classId;
    if (member.gradeId) context.gradeId = member.gradeId;
    if (member.membershipStatus !== undefined)
      context.membershipStatus = String(member.membershipStatus);
    return {
      providerId,
      accountId,
      accessToken: reportSession.accessToken,
      providerContext: context,
    };
  }

  async function portalTargetOf(session: AuthSession): Promise<{
    userId: string;
    token: string;
    cookie: string;
  }> {
    const context = session.providerContext ?? {};
    if (!context.portalUserId || !context.portalToken || !context.portalCookie)
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    return {
      userId: context.portalUserId,
      token: context.portalToken,
      cookie: context.portalCookie,
    };
  }

  async function visibleStats(
    session: AuthSession,
    examId: string,
    options?: ProviderRequestOptions,
  ): Promise<z.infer<typeof statViewSchema>> {
    return reportRequest(
      session,
      '/api/analysis/data/exam/student/weChat/all/schoolExamStat',
      statViewSchema,
      { examId },
      options,
      '报告视图',
    );
  }

  async function coursesOf(
    session: AuthSession,
    examId: string,
    statId: number,
    options?: ProviderRequestOptions,
  ): Promise<z.infer<typeof courseInfoSchema>> {
    return reportRequest(
      session,
      '/api/analysis/data/exam/student/weChat/courseInfo',
      courseInfoSchema,
      { examId, statId },
      options,
      '科目列表',
    );
  }

  /** 在考试列表中定位一场考试（最多翻 5 页），读取赋分/原始分等列表级字段。 */
  async function findExamStat(
    session: AuthSession,
    examId: string,
    options?: ProviderRequestOptions,
  ): Promise<z.infer<typeof examStatSchema>['stat']> {
    const context = session.providerContext ?? {};
    for (let pageNo = 1; pageNo <= 5; pageNo += 1) {
      const data = await reportRequest(
        session,
        '/api/exam/plan/student/all',
        examListSchema,
        { schoolId: context.schoolId, pageNo, pageSize: examPageSize, examType: examTypes },
        options,
        '考试列表',
      );
      const row = data.exam.find((item) => item.examId === examId);
      if (row) return row.stat;
      if (data.exam.length < examPageSize) return undefined;
    }
    return undefined;
  }

  /** `statName` 形如“物理(全体)”；只接受全名或“科目(…)”形式，避免把“物理类赋分(全体生)”当成物理单科。 */
  function courseForStat(
    statName: string,
    courses: z.infer<typeof courseInfoSchema>,
  ): z.infer<typeof courseInfoSchema>[number] | undefined {
    return courses.find((course) => {
      if (statName === course.courseName) return true;
      if (!statName.startsWith(course.courseName)) return false;
      const rest = statName.slice(course.courseName.length);
      return rest.startsWith('(') || rest.startsWith('（');
    });
  }

  /** 排名口径：班级 / 年级 / 联考（区域）；只要接口返回就展示。 */ function rankingsOf(
    row: z.infer<typeof rankRowSchema>,
  ): Ranking[] {
    const rankings: Ranking[] = [];
    if (row.classRanking !== undefined)
      rankings.push({
        rank: row.classRanking,
        ...(row.classRankNumber !== undefined ? { total: row.classRankNumber } : {}),
        scope: 'class',
        label: '班级排名',
      });
    if (row.examRanking !== undefined)
      rankings.push({
        rank: row.examRanking,
        ...(row.schoolRankNumber !== undefined ? { total: row.schoolRankNumber } : {}),
        scope: 'grade',
        label: '年级排名',
      });
    if (row.ranking !== undefined)
      rankings.push({
        rank: row.ranking,
        ...(row.examRankNumber !== undefined ? { total: row.examRankNumber } : {}),
        scope: 'group',
        label: '联考排名',
      });
    return rankings;
  }

  function sessionStudentId(session: AuthSession): string {
    const studentId = session.providerContext?.studentId;
    if (!studentId)
      throw new ProviderError('SESSION_EXPIRED', `${providerName}登录已失效，请重新登录`);
    return studentId;
  }

  function parseSubjectId(
    subjectId: string,
    cached?: ExamResult,
  ): { statId: number; courseId: number; paperId?: string } {
    const match = /^(\d{1,9}):(\d{1,9})$/.exec(subjectId);
    if (match) return { statId: Number(match[1]), courseId: Number(match[2]) };
    const cachedSubject = cached?.subjects.find((item) => item.id === subjectId);
    const statId = Number(cachedSubject?.providerContext?.statId);
    const courseId = Number(cachedSubject?.providerContext?.courseId);
    if (!Number.isFinite(statId) || !Number.isFinite(courseId))
      throw new ProviderError('NOT_FOUND', `${providerName}科目标识无效`);
    return {
      statId,
      courseId,
      ...(cachedSubject?.providerContext?.paperId
        ? { paperId: cachedSubject.providerContext.paperId }
        : {}),
    };
  }

  async function paperIdOf(
    session: AuthSession,
    examId: string,
    statId: number,
    courseId: number,
    options?: ProviderRequestOptions,
  ): Promise<string | undefined> {
    const courses = await optional(coursesOf(session, examId, statId, options));
    return courses?.find((course) => course.courseId === courseId)?.paperId;
  }

  /** 异步答题卡：起始任务 + 轮询；只接受本人学生信息对应的卡片集。 */
  async function fetchAnswerCards(
    session: AuthSession,
    examId: string,
    statId: number,
    courseId: number,
    paperId: string,
    options?: ProviderRequestOptions,
  ): Promise<z.infer<typeof asyncPollSchema>['data']> {
    assertSession(session);
    const start = await reportRequest(
      session,
      '/api/exam/answerCard/view/student/async',
      asyncStartSchema,
      { examId, statId, courseId, paperId },
      options,
      '答题卡任务',
    );
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      throwIfAborted(options?.signal);
      await new Promise((resolve) => setTimeout(resolve, pollDelay));
      throwIfAborted(options?.signal);
      const poll = await reportRequest(
        session,
        '/api/common/my/async',
        asyncPollSchema,
        { uuid: start.uuid },
        options,
        '答题卡结果',
      );
      if (poll.status === 40 || poll.status === 30) {
        const data = poll.data;
        if (!data) return undefined;
        if (data.studentInfo && data.studentInfo.studentId !== sessionStudentId(session))
          throw new ProviderError('RESTRICTED', `${providerName}答题卡与当前学生不一致`);
        return data;
      }
      if (poll.status >= 50)
        throw new ProviderError('UNKNOWN', `${providerName}答题卡生成失败，请稍后重试`);
    }
    throw new ProviderError('NETWORK', `${providerName}答题卡生成超时，请稍后重试`, true);
  }

  function sheetUrlsOf(
    cards: z.infer<typeof asyncPollSchema>['data'],
    subject: string,
    subjectId: string,
  ): AnswerSheet[] {
    return (cards?.answerCardList ?? [])
      .map((card, index) => ({
        pageNumber: card.pageNumber ?? index + 1,
        path: card.filePath ?? card.correctPath ?? card.originFilePath,
      }))
      .filter((item): item is { pageNumber: number; path: string } => !!item.path)
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .map((item) => ({
        subject,
        subjectId,
        url: `${cdnHost}/${item.path.replace(/^\/+/, '')}`,
        watermarked: false,
      }));
  }

  return {
    metadata: {
      id: providerId,
      name: providerName,
      description: '查询官方考试报告、单科成绩与答题卡（家长手机号登录）。',
      officialDomain: portalHost,
    },
    capabilities: {
      profile: true,
      exams: true,
      results: true,
      ranking: true,
      subjectDetails: true,
      questionScores: true,
      answerSheets: true,
    },
    async authenticate(account, password) {
      if (!account.trim() || !password)
        throw new ProviderError('INVALID_CREDENTIALS', '请输入手机号和密码');
      const target = await portalLogin(account.trim(), password);
      const student = (await portalChildren(target))[0];
      const reportSession = await issueReportSession(target, student.studentUserID);
      return sessionFrom(account.trim(), target, student, reportSession);
    },
    async getProfile(session) {
      assertSession(session);
      const context = session.providerContext ?? {};
      return {
        id: context.studentUserID ?? context.studentId ?? session.accountId,
        displayName: context.studentName ?? '未命名学生',
        schoolName: context.schoolName,
        grade: context.gradeName,
        selected: true,
      };
    },
    async getProfiles(session) {
      assertSession(session);
      const target = await portalTargetOf(session);
      const current = session.providerContext?.studentUserID;
      return (await portalChildren(target)).map((student) => ({
        ...profileOf(student),
        ...(student.studentUserID === current ? { selected: true } : {}),
      }));
    },
    async selectProfile(session, profileId, options) {
      assertSession(session);
      const target = await portalTargetOf(session);
      const students = await portalChildren(target, options?.signal);
      const student = students.find((item) => item.studentUserID === profileId);
      if (!student) throw new ProviderError('NOT_FOUND', '未找到该绑定学生');
      const reportSession = await issueReportSession(
        target,
        student.studentUserID,
        options?.signal,
      );
      return sessionFrom(session.accountId, target, student, reportSession);
    },
    async getExamList(session, page = {}, options) {
      assertSession(session);
      const context = session.providerContext ?? {};
      const offset = Math.max(0, page.offset ?? 0);
      const pageNo = Math.floor(offset / examPageSize) + 1;
      const fetchPage = async (index: number) => {
        const data = await reportRequest(
          session,
          '/api/exam/plan/student/all',
          examListSchema,
          {
            schoolId: context.schoolId,
            pageNo: index,
            pageSize: examPageSize,
            examType: examTypes,
          },
          options,
          '考试列表',
        );
        return data.exam;
      };
      const start = offset % examPageSize;
      let rows = await fetchPage(pageNo);
      if (start > 0) rows = [...rows, ...(await fetchPage(pageNo + 1))];
      return rows.slice(start, start + examPageSize).map((row): ExamSummary => {
        const summary: ExamSummary = { id: row.examId, name: row.examName };
        const date = formatExamDate(row.startDate ?? row.endDate);
        if (date) summary.date = date;
        if (row.examTypeName) summary.category = row.examTypeName;
        // 只有“已出分”标记为可查；未出分保持未定义，避免界面误显示“需要加载”（本平台没有加载动作）。
        if (row.stat?.resultStatus === 0) summary.hasResult = true;
        return summary;
      });
    },
    async getExamResult(session, examId, options) {
      assertSession(session);
      if (!/^\d{1,16}$/.test(examId))
        throw new ProviderError('NOT_FOUND', `${providerName}考试标识无效`);
      const stats = await visibleStats(session, examId, options);
      let requestedStatId: number | undefined;
      if (options?.reportId) {
        const parsed = Number(options.reportId);
        if (!Number.isInteger(parsed) || parsed < 0)
          throw new ProviderError('NOT_FOUND', '报告标识无效');
        requestedStatId = parsed;
      }
      if (requestedStatId !== undefined && !stats.some((item) => item.statId === requestedStatId))
        throw new ProviderError('NOT_FOUND', '该报告不可用');
      const primary =
        requestedStatId !== undefined
          ? stats.find((item) => item.statId === requestedStatId)
          : stats[0];
      if (!primary) throw new ProviderError('NOT_FOUND', '该考试的报告尚未发布');

      const [
        info,
        courses,
        rankInfo,
        baseIndex,
        levelInfo,
        scoreRate,
        listStat,
        schoolTotalSection,
        classTotalSection,
      ] = await Promise.all([
        optional(
          reportRequest(
            session,
            '/api/analysis/data/exam/student/weChat/info',
            examInfoSchema,
            { examId, statId: primary.statId },
            options,
            '考试信息',
          ),
        ),
        optional(coursesOf(session, examId, primary.statId, options)),
        optional(
          reportRequest(
            session,
            '/api/analysis/data/exam/student/weChat/scoreRankInfo',
            rankInfoSchema,
            { examId, statId: primary.statId },
            options,
            '成绩排名',
          ),
        ),
        optional(
          reportRequest(
            session,
            '/api/analysis/view/monitor/exam/stat/baseIndex',
            baseIndexSchema,
            // 平台要求 statId；缺失时返回 “statId 不是一个合法的数字”，联考均分会因此缺失。
            { examId, statId: primary.statId },
            options,
            '区域统计',
          ),
        ),
        optional(
          reportRequest(
            session,
            '/api/analysis/data/exam/student/weChat/scoreLevel',
            levelInfoSchema,
            { examId, statId: primary.statId },
            options,
            '成绩等级',
          ),
        ),
        optional(
          reportRequest(
            session,
            '/api/analysis/data/monitor/exam/student/scoreRate',
            scoreRateSchema,
            { examId },
            options,
            '学科得分率',
          ),
        ),
        optional(findExamStat(session, examId, options)),
        // 总分分数段：同时给出本人总分、参与人数与分布，statId=0 即原始总分口径。
        optional(
          reportRequest(
            session,
            '/api/analysis/view/monitor/exam/school/scoreSection',
            totalSectionSchema,
            { examId, statId: primary.statId },
            options,
            '分数分布',
          ),
        ),
        optional(
          reportRequest(
            session,
            '/api/analysis/view/monitor/exam/class/scoreSection',
            totalSectionSchema,
            { examId, statId: primary.statId },
            options,
            '分数分布',
          ),
        ),
      ]);

      const rows = rankInfo?.scoreRanking ?? [];
      const totalRow = rows.find((row) => row.courseId === undefined);
      const courseRows = rows.filter((row) => row.courseId !== undefined);

      // 单科报告视图（如“物理(全体)”）不经 scoreRankInfo，需单独取本人本科总分。
      const subjectStatScores: {
        statId: number;
        courseId: number;
        course: z.infer<typeof courseInfoSchema>[number];
        score?: number;
        maxScore?: number;
      }[] = [];
      if (courses?.length) {
        for (const stat of stats) {
          const course = courseForStat(stat.statName, courses);
          if (!course) continue;
          if (courseRows.some((row) => row.courseId === course.courseId)) continue;
          const paper = await optional(
            reportRequest(
              session,
              '/api/analysis/data/exam/student/weChat/paper/question',
              paperQuestionSchema,
              {
                examId,
                statId: stat.statId,
                courseId: course.courseId,
                ...(course.paperId ? { paperId: course.paperId } : {}),
              },
              options,
              '单科成绩',
            ),
          );
          const own = paper?.student?.find((row) => row.studentId === sessionStudentId(session));
          const maxScore = own?.questions?.reduce(
            (total, question) => total + (question.scoreValue ?? 0),
            0,
          );
          subjectStatScores.push({
            statId: stat.statId,
            courseId: course.courseId,
            course,
            score: own?.totalScore === undefined ? undefined : roundScore(own.totalScore),
            maxScore: maxScore && maxScore > 0 ? maxScore : undefined,
          });
        }
      }

      const ownStudentId = sessionStudentId(session);
      const subjectById = new Map<number, SubjectScore>();
      for (const row of courseRows) {
        const course = courses?.find((item) => item.courseId === row.courseId);
        const subject = row.courseName ?? course?.courseName;
        if (row.courseId === undefined || !subject) continue;
        const maxScore = numberFromString(row.fullMark);
        subjectById.set(row.courseId, {
          id: `${primary.statId}:${row.courseId}`,
          subject,
          ...(row.totalScore !== undefined ? { score: roundScore(row.totalScore) } : {}),
          ...(maxScore !== undefined ? { maxScore } : {}),
          providerContext: {
            statId: String(primary.statId),
            courseId: String(row.courseId),
            ...(course?.paperId ? { paperId: course.paperId } : {}),
          },
        });
      }
      for (const item of subjectStatScores) {
        subjectById.set(item.courseId, {
          id: `${item.statId}:${item.courseId}`,
          subject: item.course.courseName,
          ...(item.score !== undefined ? { score: item.score } : {}),
          ...(item.maxScore !== undefined ? { maxScore: item.maxScore } : {}),
          providerContext: {
            statId: String(item.statId),
            courseId: String(item.courseId),
            ...(item.course.paperId ? { paperId: item.course.paperId } : {}),
          },
        });
      }
      // 平台没给某些科目生成单科报告时（校内科考试常见：只出“物理(全体)”），
      // 逐题接口仍返回本人该科分数与满分，按用户选择补全这些科目。
      const uncoveredCourses = (courses ?? []).filter(
        (course) => course.paperId !== undefined && !subjectById.has(course.courseId),
      );
      const primaryCourse = courses ? courseForStat(primary.statName, courses) : undefined;
      if (uncoveredCourses.length) {
        const fetched = await Promise.all(
          uncoveredCourses.map(async (course) => {
            const paper = await optional(
              reportRequest(
                session,
                '/api/analysis/data/exam/student/weChat/paper/question',
                paperQuestionSchema,
                {
                  examId,
                  statId: primary.statId,
                  courseId: course.courseId,
                  ...(course.paperId ? { paperId: course.paperId } : {}),
                },
                options,
                '单科成绩',
              ),
            );
            const own = paper?.student?.find((row) => row.studentId === ownStudentId);
            if (own) {
              const maxScore = own.questions?.reduce(
                (total, question) => total + (question.scoreValue ?? 0),
                0,
              );
              return {
                course,
                score: own.totalScore,
                maxScore: maxScore && maxScore > 0 ? maxScore : undefined,
              };
            }
            const analysis = await optional(
              reportRequest(
                session,
                '/api/analysis/data/exam/student/weChat/result/question/analysis',
                questionAnalysisSchema,
                { examId, statId: primary.statId, courseId: course.courseId },
                options,
                '单科成绩',
              ),
            );
            const analysisQuestions = analysis?.question ?? [];
            if (analysisQuestions.length) {
              const score = analysisQuestions.every(
                (question) => question.finallyScore !== undefined,
              )
                ? analysisQuestions.reduce(
                    (total, question) => total + (question.finallyScore ?? 0),
                    0,
                  )
                : undefined;
              const maxScore = analysisQuestions.reduce(
                (total, question) => total + (question.scoreValue ?? 0),
                0,
              );
              if (score !== undefined)
                return {
                  course,
                  score,
                  maxScore: maxScore > 0 ? maxScore : undefined,
                };
            }
            // 部分单科报告的 paper/question 只返回主导科目；按科目再查 scoreRankInfo，
            // 这是官方详情页用于显示其它科目分数的回退口径。
            const rank = primaryCourse
              ? await optional(
                  reportRequest(
                    session,
                    '/api/analysis/data/exam/student/weChat/scoreRankInfo',
                    courseRankInfoSchema,
                    { examId, statId: primary.statId, courseId: course.courseId },
                    options,
                    '单科成绩',
                  ),
                )
              : undefined;
            const row = rank?.scoreRanking?.find((item) => item.courseId === course.courseId);
            return {
              course,
              score: row?.totalScore,
              maxScore: numberFromValue(row?.fullMark),
            };
          }),
        );
        fetched.forEach(({ course, score, maxScore }) => {
          if (score === undefined && maxScore === undefined) return;
          subjectById.set(course.courseId, {
            id: `${primary.statId}:${course.courseId}`,
            subject: course.courseName,
            ...(score !== undefined ? { score: roundScore(score) } : {}),
            ...(maxScore !== undefined && maxScore > 0 ? { maxScore } : {}),
            providerContext: {
              statId: String(primary.statId),
              courseId: String(course.courseId),
              ...(course.paperId ? { paperId: course.paperId } : {}),
            },
          });
        });
      }
      // 单科报告的 courseInfo 仍会返回本场全部科目；即使逐题补取暂时失败，
      // 也保留官方返回的科目入口，避免切换到“物理(全体)”后政治等科目消失。
      const subjects = (
        courses?.length
          ? courses.map(
              (course) =>
                subjectById.get(course.courseId) ??
                (primaryCourse
                  ? {
                      id: `${primary.statId}:${course.courseId}`,
                      subject: course.courseName,
                      providerContext: {
                        statId: String(primary.statId),
                        courseId: String(course.courseId),
                        ...(course.paperId ? { paperId: course.paperId } : {}),
                      },
                    }
                  : undefined),
            )
          : [...subjectById.values()]
      ).filter((item): item is SubjectScore => item !== undefined);

      const schoolRow = firstSectionRow(schoolTotalSection);
      const classList = Array.isArray(classTotalSection)
        ? classTotalSection
        : classTotalSection
          ? [classTotalSection]
          : [];
      const classRow =
        classList.find((item) => item.classId === session.providerContext?.classId) ?? classList[0];
      const sectionTotal = schoolRow?.totalScore ?? classRow?.totalScore ?? undefined;
      // 赋分考试：列表 stat 同时给出赋分（totalScore）与原始分（originalScore），报表侧只有赋分。
      const rankedTotal =
        totalRow?.totalScore !== undefined
          ? roundScore(totalRow.totalScore)
          : listStat?.scoreChange === true && listStat.totalScore !== undefined
            ? roundScore(listStat.totalScore)
            : undefined;
      // 分数段接口自带本人总分，是平台下发的官方值；display 关闭分数时仍用它兜底（产品取舍）。
      const convertedTotal =
        rankedTotal ??
        (sectionTotal !== undefined && sectionTotal !== null
          ? roundScore(sectionTotal)
          : undefined);
      let totalScore = convertedTotal;
      const subjectMaxSum =
        subjects.length > 0 &&
        (!courses?.length || subjects.length === courses.length) &&
        subjects.every((item) => item.maxScore !== undefined)
          ? roundScore(subjects.reduce((sum, item) => sum + (item.maxScore ?? 0), 0))
          : undefined;
      let maxTotalScore =
        numberFromString(totalRow?.fullMark) ??
        numberFromString(listStat?.fullMark) ??
        subjectMaxSum ??
        numberFromValue(schoolRow?.fullMark);
      let derivedTotal = false;
      // 平台没有下发总分时（校内科考试常见：display 关闭分数且 scoreRankInfo 无行），
      // 若所有科目的分数与满分齐全，则用各科合计作为主分数，并在页面顶部说明来源。
      if (
        convertedTotal === undefined &&
        subjects.length > 0 &&
        (!courses?.length || subjects.length === courses.length) &&
        subjects.every((item) => item.score !== undefined && item.maxScore !== undefined)
      ) {
        totalScore = roundScore(subjects.reduce((sum, item) => sum + (item.score ?? 0), 0));
        maxTotalScore = subjectMaxSum;
        derivedTotal = true;
      }
      // 官方只在 scoreChange 为真时展示“新高考赋分”，此时 originalScore 是原始分；
      // 单科没有原始分口径（报表接口的 originalScore 与赋分相同），不做推算。
      const rawTotal = listStat?.originalScore;
      const originalTotalScore = rawTotal == null ? undefined : roundScore(rawTotal);
      const officialRankings = totalRow ? rankingsOf(totalRow) : [];
      // 官方没有班级/年级排名时，用总分分数段的人数和累计人数估算区间名次。
      const estimatedRankings: Ranking[] = [];
      if (!officialRankings.some((item) => item.scope === 'class')) {
        const estimate = estimateRankFromSection(classRow, totalScore);
        if (estimate)
          estimatedRankings.push({
            ...estimate,
            scope: 'class',
            label: '预估班级排名',
            estimate: true,
          });
      }
      if (!officialRankings.some((item) => item.scope === 'grade')) {
        const estimate = estimateRankFromSection(schoolRow, totalScore);
        if (estimate)
          estimatedRankings.push({
            ...estimate,
            scope: 'grade',
            label: '预估年级排名',
            estimate: true,
          });
      }
      const rankings = [...estimatedRankings, ...officialRankings];
      const isRegionalExam = info?.examType === 7 || info?.examType === 9 || info?.examType === 10;

      const statistics: SubjectStatistic[] = [];
      if (totalRow) {
        // 卡片顺序：班级均分在前、学校均分在后。
        const classAverage = numberFromString(totalRow.classAverageScore);
        if (classAverage !== undefined)
          statistics.push({ scope: '班级', averageScore: classAverage });
        const gradeAverage = numberFromString(totalRow.schoolAverageScore);
        // 均分卡片只放均分：各口径人数已由排名卡片展示，避免重复。
        if (gradeAverage !== undefined)
          statistics.push({ scope: '年级', averageScore: gradeAverage });
      }
      const regionalIndex = baseIndex?.find((row) => row.schoolId === undefined);
      const regionalAverage = numberFromValue(regionalIndex?.averageScore);
      // 联考只在均分可用时给出一张“联考均分”卡片；缺失均分时不退化成人数卡片。
      if (isRegionalExam && regionalAverage !== undefined)
        statistics.push({ scope: '联考', averageScore: regionalAverage });

      const level = levelInfo?.list.find(
        (item) =>
          item.examId === examId && (item.statId === undefined || item.statId === primary.statId),
      );

      const sections: ReportSection[] = [];
      const studentRates = new Map(
        (scoreRate?.studentScoreRate ?? []).map((row) => [row.courseId, row.scoreRate]),
      );
      const averageRates = new Map(
        (scoreRate?.scoreRate ?? []).map((row) => [row.courseId, row.averageRate]),
      );
      if (studentRates.size > 0 || averageRates.size > 0) {
        const axes = subjects.map((subject) => subject.subject);
        const ownValues = subjects.map((subject) => {
          const courseId = Number(subject.providerContext?.courseId);
          return Number.isFinite(courseId)
            ? (percentFromRate(studentRates.get(courseId)) ?? null)
            : null;
        });
        const averageValues = subjects.map((subject) => {
          const courseId = Number(subject.providerContext?.courseId);
          return Number.isFinite(courseId)
            ? (percentFromRate(averageRates.get(courseId)) ?? null)
            : null;
        });
        if (axes.length && [...ownValues, ...averageValues].some((value) => value !== null))
          sections.push({
            id: 'xiaolixueban-score-rate',
            title: '学科强弱得分率',
            radar: {
              scale: { min: 0, max: 100 },
              axes,
              series: [
                { label: '本人', values: ownValues },
                { label: '学校平均', values: averageValues },
              ],
            },
          });
      }
      const distributionGroups = [
        distributionGroupOf(classRow, 'class', totalScore),
        distributionGroupOf(schoolRow, 'school', totalScore),
      ].filter((group): group is DistributionGroup => group !== undefined);
      if (distributionGroups.length)
        sections.push({
          id: 'xiaolixueban-score-distribution',
          title: '分数分布',
          distributions: distributionGroups,
        });

      const result: ExamResult = {
        examId,
        examName: info?.examName ?? '考试报告',
        ...(info?.examName ? {} : { examNameIsFallback: true }),
        subjects,
        reports: stats.map((item) => ({ id: String(item.statId), name: item.statName })),
      };
      if (isRegionalExam) result.isUnion = true;
      if (totalScore !== undefined) result.totalScore = totalScore;
      if (maxTotalScore !== undefined) result.maxTotalScore = maxTotalScore;
      if (originalTotalScore !== undefined) result.originalTotalScore = originalTotalScore;
      // 人数已在排名卡片展示；仅当所有排名都不显示人数时，才用独立的“考生人数”兜底。
      if (
        totalRow?.examRankNumber !== undefined &&
        !rankings.some((ranking) => ranking.total !== undefined)
      )
        result.participantCount = totalRow.examRankNumber;
      // 统一用 rankings：单条排名若走 ranking 字段，界面会按“联考”标题渲染，口径不符。
      if (rankings.length) result.rankings = rankings;
      if (statistics.length) result.statistics = statistics;
      if (level?.consistName?.trim()) result.grade = level.consistName.trim();
      if (sections.length) result.reportSections = sections;
      if (derivedTotal)
        result.notice = {
          id: 'xiaolixueban-derived-total',
          text: '平台未公布总分，当前总分由各科分数合计得出。',
        };
      return result;
    },
    async getSubjectDetail(session, examId, subjectId, cachedResult, options) {
      assertSession(session);
      const target = parseSubjectId(subjectId, cachedResult);
      const paperId =
        target.paperId ??
        (await paperIdOf(session, examId, target.statId, target.courseId, options));
      const paper = await reportRequest(
        session,
        '/api/analysis/data/exam/student/weChat/paper/question',
        paperQuestionSchema,
        {
          examId,
          statId: target.statId,
          courseId: target.courseId,
          ...(paperId ? { paperId } : {}),
        },
        options,
        '单科成绩',
      );
      // 该接口返回整班数据，只保留本人那一条，其余立即丢弃。
      const paperOwn = paper.student?.find((row) => row.studentId === sessionStudentId(session));
      const [courses, analyses, sectionsData, classSectionsData, rankInfo, errors, baseIndex] =
        await Promise.all([
          optional(coursesOf(session, examId, target.statId, options)),
          optional(
            reportRequest(
              session,
              '/api/analysis/data/exam/student/weChat/result/question/analysis',
              questionAnalysisSchema,
              { examId, statId: target.statId, courseId: target.courseId },
              options,
              '逐题分析',
            ),
          ),
          optional(
            reportRequest(
              session,
              '/api/analysis/view/monitor/exam/school/course/scoreSection',
              scoreSectionSchema,
              { examId, statId: target.statId, courseId: target.courseId },
              options,
              '分数区间',
            ),
          ),
          optional(
            reportRequest(
              session,
              '/api/analysis/view/monitor/exam/class/course/scoreSection',
              scoreSectionSchema,
              { examId, statId: target.statId, courseId: target.courseId },
              options,
              '分数区间',
            ),
          ),
          optional(
            reportRequest(
              session,
              '/api/analysis/data/exam/student/weChat/scoreRankInfo',
              rankInfoSchema,
              { examId, statId: target.statId, courseId: target.courseId },
              options,
              '单科排名',
            ),
          ),
          optional(
            reportRequest(
              session,
              '/api/analysis/data/monitor/exam/item/student/question/error/analysis',
              errorAnalysisSchema,
              // 平台要求 paperId；缺失时逐题得分与正确答案都取不到。
              {
                examId,
                statId: target.statId,
                courseId: target.courseId,
                ...(paperId ? { paperId } : {}),
              },
              options,
              '题目解析',
            ),
          ),
          optional(
            reportRequest(
              session,
              '/api/analysis/view/monitor/exam/stat/baseIndex',
              baseIndexSchema,
              { examId, statId: target.statId },
              options,
              '区域统计',
            ),
          ),
        ]);
      const analysisQuestions = analyses?.question ?? [];
      const own =
        paperOwn ??
        (analysisQuestions.length
          ? {
              studentId: sessionStudentId(session),
              totalScore: analysisQuestions.every((question) => question.finallyScore !== undefined)
                ? analysisQuestions.reduce(
                    (total, question) => total + (question.finallyScore ?? 0),
                    0,
                  )
                : undefined,
              questions: analysisQuestions.map((question) => ({
                questionNumber: question.questionNumber,
                structureNumber: question.structureNumber,
                scoreValue: question.scoreValue,
                finallyScore: question.finallyScore,
              })),
            }
          : undefined);
      if (!own)
        throw new ProviderError('RESTRICTED', `${providerName}未返回本人该科目的数据，请核对账号`);

      const course = courses?.find((item) => item.courseId === target.courseId);
      const subject = course?.courseName ?? own.courseName ?? '未命名科目';
      // 平台画像：`result/question/analysis` 的部分考试（如区域赋分）finallyScore 全为 0，
      // 真实的逐题得分与客观题正确答案在 error/analysis；两者按题号合并，得分以 error 为准。
      const analysisByNumber = new Map(
        (analyses?.question ?? []).map((item) => [item.questionNumber, item]),
      );
      const errorByNumber = new Map((errors ?? []).map((item) => [item.questionNumber, item]));
      const questionNumbers = [
        ...analysisByNumber.keys(),
        ...[...errorByNumber.keys()].filter((number) => !analysisByNumber.has(number)),
      ];
      const questions: QuestionScore[] = questionNumbers.map((questionNumber) => {
        const analysis = analysisByNumber.get(questionNumber);
        const errorRow = errorByNumber.get(questionNumber);
        const score = errorRow?.finallyScore ?? analysis?.finallyScore;
        const maxScore = errorRow?.scoreValue ?? analysis?.scoreValue;
        const myAnswer = (errorRow?.recognitionValue ?? analysis?.recognitionValue)?.trim();
        const answer = errorRow?.correctAnswer?.trim();
        const question: QuestionScore = {
          id: String(questionNumber),
          label:
            errorRow?.structureNumber?.trim() ||
            analysis?.structureNumber?.trim() ||
            String(questionNumber),
        };
        if (score !== undefined && score !== null) question.score = score;
        if (maxScore !== undefined && maxScore !== null) question.maxScore = maxScore;
        if (analysis?.isObjective !== undefined)
          question.kind = analysis.isObjective ? 'objective' : 'subjective';
        if (myAnswer) question.myAnswer = myAnswer;
        if (answer) question.answer = answer;
        return question;
      });

      const questionScoreSummaries: QuestionScoreSummary[] = [];
      if (questions.length && questions.every((item) => item.kind !== undefined)) {
        const objective = questions.filter((item) => item.kind === 'objective');
        const subjective = questions.filter((item) => item.kind === 'subjective');
        const sumOf = (items: QuestionScore[], key: 'score' | 'maxScore') => {
          let total = 0;
          for (const item of items) {
            const value = item[key];
            if (value === undefined) return undefined;
            total += value;
          }
          return items.length ? total : undefined;
        };
        const objectiveScore = sumOf(objective, 'score');
        const objectiveMax = sumOf(objective, 'maxScore');
        const subjectiveScore = sumOf(subjective, 'score');
        const subjectiveMax = sumOf(subjective, 'maxScore');
        if (objectiveScore !== undefined && objectiveMax !== undefined)
          questionScoreSummaries.push({
            kind: 'objective',
            score: Math.round(objectiveScore * 100) / 100,
            maxScore: Math.round(objectiveMax * 100) / 100,
          });
        if (subjective.length && subjectiveMax !== undefined) {
          const resolvedSubjectiveScore =
            subjectiveScore ??
            (own.totalScore !== undefined && objectiveScore !== undefined
              ? own.totalScore - objectiveScore
              : undefined);
          if (
            resolvedSubjectiveScore !== undefined &&
            resolvedSubjectiveScore >= -0.001 &&
            resolvedSubjectiveScore <= subjectiveMax + 0.001
          )
            questionScoreSummaries.push({
              kind: 'subjective',
              score: Math.round(resolvedSubjectiveScore * 100) / 100,
              maxScore: Math.round(subjectiveMax * 100) / 100,
              inferred: true,
            });
        }
      }

      const rankRow = rankInfo?.scoreRanking?.find((row) => row.courseId === target.courseId);
      const statistics: SubjectStatistic[] = [];
      const rankings = rankRow ? rankingsOf(rankRow) : [];
      const ownSection = sectionsData?.find((item) => item.courseId === target.courseId);
      const classSection = classSectionsData?.find((item) => item.courseId === target.courseId);
      const estimatedClass = rankings.some((item) => item.scope === 'class')
        ? undefined
        : estimateRankFromSubjectSection(classSection, own.totalScore);
      const estimatedGrade = rankings.some((item) => item.scope === 'grade')
        ? undefined
        : estimateRankFromSubjectSection(ownSection, own.totalScore);
      const classRank =
        rankings.find((item) => item.scope === 'class') ??
        (estimatedClass
          ? { ...estimatedClass, scope: 'class' as const, label: '预估班级排名', estimate: true }
          : undefined);
      const gradeRank =
        rankings.find((item) => item.scope === 'grade') ??
        (estimatedGrade
          ? { ...estimatedGrade, scope: 'grade' as const, label: '预估年级排名', estimate: true }
          : undefined);
      const groupRank = rankings.find((item) => item.scope === 'group');
      // 卡片顺序：班级在前、学校在后；联考（区域考试）补充均分与排名。
      {
        const average =
          numberFromString(rankRow?.classAverageScore) ??
          sumQuestionAverage(analyses?.question, 'classAverageScore');
        if (average !== undefined || classRank) {
          statistics.push({
            scope: '班级',
            ...(average !== undefined ? { averageScore: average } : {}),
            ...(classRank ? { rank: classRank.rank } : {}),
            ...(classRank?.total !== undefined
              ? { participantCount: classRank.total }
              : rankRow?.classRankNumber !== undefined
                ? { participantCount: rankRow.classRankNumber }
                : {}),
          });
        }
      }
      {
        const average =
          numberFromString(rankRow?.schoolAverageScore) ??
          sumQuestionAverage(analyses?.question, 'schoolAverageScore');
        if (average !== undefined || gradeRank) {
          statistics.push({
            scope: '年级',
            ...(average !== undefined ? { averageScore: average } : {}),
            ...(gradeRank ? { rank: gradeRank.rank } : {}),
            ...(gradeRank?.total !== undefined
              ? { participantCount: gradeRank.total }
              : rankRow?.schoolRankNumber !== undefined
                ? { participantCount: rankRow.schoolRankNumber }
                : {}),
          });
        }
      }
      const regionalCourse = baseIndex
        ?.find((row) => row.schoolId === undefined)
        ?.course?.find((item) => item.courseId === target.courseId);
      const regionalAverage = numberFromValue(regionalCourse?.averageScore ?? undefined);
      if (groupRank || regionalAverage !== undefined) {
        const showCount = groupRank !== undefined && rankRow?.examRankNumber !== undefined;
        statistics.push({
          scope: '联考',
          ...(regionalAverage !== undefined ? { averageScore: regionalAverage } : {}),
          ...(groupRank ? { rank: groupRank.rank } : {}),
          ...(showCount ? { participantCount: rankRow?.examRankNumber } : {}),
        });
      }

      const sections: ReportSection[] = [];
      {
        const scoreDistributions = [
          subjectDistributionGroupOf(classSection, 'class', own.totalScore),
          subjectDistributionGroupOf(ownSection, 'school', own.totalScore),
        ].filter((group): group is DistributionGroup => group !== undefined);
        if (scoreDistributions.length)
          sections.push({
            id: 'xiaolixueban-score-section',
            title: '分数区间',
            distributions: scoreDistributions,
          });
      }
      const questionMaxSum = own.questions?.reduce(
        (total, item) => total + (item.scoreValue ?? 0),
        0,
      );
      const maxScore =
        numberFromString(ownSection?.fullMark) ??
        (questionMaxSum && questionMaxSum > 0 ? questionMaxSum : undefined) ??
        numberFromString(rankRow?.fullMark);
      const originalScore =
        questions.length > 0 && questions.every((question) => question.score !== undefined)
          ? roundScore(questions.reduce((total, question) => total + (question.score ?? 0), 0))
          : undefined;

      const detail: SubjectDetail = {
        subjectId,
        subject,
        providerContext: {
          statId: String(target.statId),
          courseId: String(target.courseId),
          ...(paperId ? { paperId } : {}),
        },
      };
      if (own.totalScore !== undefined) detail.score = own.totalScore;
      if (originalScore !== undefined) detail.originalScore = originalScore;
      if (maxScore !== undefined) detail.maxScore = maxScore;
      if (statistics.length) detail.statistics = statistics;
      if (questions.length) detail.questions = questions;
      if (questionScoreSummaries.length) detail.questionScoreSummaries = questionScoreSummaries;
      if (sections.length) detail.reportSections = sections;
      return detail;
    },
    async getAnswerSheets(session, examId, subjectId, cachedResult, options) {
      assertSession(session);
      const target = parseSubjectId(subjectId, cachedResult);
      const courses = await optional(coursesOf(session, examId, target.statId, options));
      const paperId =
        target.paperId ?? courses?.find((course) => course.courseId === target.courseId)?.paperId;
      if (!paperId) throw new ProviderError('NOT_FOUND', `${providerName}未找到本科试卷`);
      const cards = await fetchAnswerCards(
        session,
        examId,
        target.statId,
        target.courseId,
        paperId,
        options,
      );
      const subject =
        cachedResult?.subjects.find((item) => item.id === subjectId)?.subject ??
        courses?.find((course) => course.courseId === target.courseId)?.courseName ??
        '答题卡';
      return sheetUrlsOf(cards, subject, subjectId);
    },
    async logout(session) {
      if (session.providerId !== providerId) return;
      revoked.add(session);
      try {
        await requestWithTimeout(
          transport,
          `${report}/api/base/data/logout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              Origin: report,
              Referer: `${report}/`,
              'User-Agent': userAgent,
              'DONGNI-LOGIN': session.accessToken,
            },
            body: JSON.stringify({ clientType: 2 }),
          },
          5000,
        );
      } catch {
        /* 注销失败不影响本地移除账号；会话已在本地撤销。 */
      }
    },
  };
}

export const xiaolixuebanProvider = createXiaolixuebanProvider();
