import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import {
  ProviderError,
  type AuthSession,
  type ExamResult,
  type SubjectScore,
} from '../domain/models';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  numericScore,
  parseValidated,
  utf8ToBytes,
} from './codec';
import { zhixueLoginScript } from './zhixue-login';
import {
  zhixueQuestionAnswers,
  zhixueQuestionSheets,
  zhixueQuestions,
  zhixueSheets,
} from './zhixue-checksheet';
import { zhixueReportSections } from './zhixue-report';
import type { ProviderRequestOptions, ScoreProvider } from './types';

const id = 'zhixue';
const www = 'https://www.zhixue.com';
const hosts = [www, 'https://ali-bg.zhixue.com'] as const;
const identifier = z.string().min(1).max(256);
const envelopeSchema = z.object({ errorCode: z.number().int(), result: z.unknown().optional() });
const userSchema = z.object({
  userId: identifier,
  curChildId: identifier,
  userType: z.enum(['PARENT', 'STUDENT']),
});
const studentSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(128),
  schoolName: z.string().max(256).optional(),
});
const loginSchema = z
  .object({
    token: z.string().min(1).max(16384),
    student: studentSchema,
    userType: z.enum(['PARENT', 'STUDENT']).default('PARENT'),
    accountId: identifier.optional(),
  })
  .refine((value) => value.userType !== 'STUDENT' || !!value.accountId);
const contextSchema = z.object({
  studentId: identifier,
  studentName: z.string().min(1),
  schoolName: z.string().optional(),
  host: z.string(),
  userType: z.enum(['PARENT', 'STUDENT']).default('PARENT'),
});
const milliseconds = z
  .string()
  .regex(/^\d{10,16}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
const yearSchema = z
  .object({ code: identifier, name: z.string(), beginTime: milliseconds, endTime: milliseconds })
  .refine((value) => Number(value.beginTime) < Number(value.endTime));
const yearsSchema = z.array(yearSchema).max(100);
const examSchema = z.object({
  examId: identifier,
  examName: z.string().min(1),
  examCreateDateTime: z
    .number()
    .finite()
    .nonnegative()
    .max(8640000000000000 - 8 * 3600000)
    .optional(),
  examType: z.string().optional(),
});
const pageSchema = z.object({
  examList: z.array(examSchema),
  hasNextPage: z.boolean(),
  pagination: z.object({
    pageIndex: z.number().int().positive(),
    actualPosition: z.number().int().nonnegative(),
  }),
});
const metric = z.union([z.number().finite(), z.string()]).nullish();
const scoreSchema = z.object({
  userScore: metric,
  preAssignScore: metric,
  standardScore: metric,
  assignStandardScore: metric,
  hasAssignScore: z.boolean().optional(),
  userLevel: z.string().nullish(),
});
const subjectSchema = scoreSchema.extend({
  paperId: identifier,
  subjectName: z.string().min(1),
  subjectCode: z.string().optional(),
});
const resultSchema = z.object({
  title: z.string().optional(),
  paperList: z.array(subjectSchema),
  totalScore: scoreSchema.extend({ examName: z.string().optional() }).nullish(),
});
const examContextSchema = z.object({
  v: z.literal(1),
  examId: identifier,
  studentId: identifier,
  start: milliseconds,
  end: milliseconds,
});
type Year = z.infer<typeof yearSchema>;
type Cursor = { pageIndex: number; actualPosition: number; ended?: boolean };

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  return parseValidated(schema, value, `智学网${label}格式已变化，请稍后重试`);
}
export function zhixueOfficialHost(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('RESTRICTED', '智学网路由地址无效');
  }
  if (
    !hosts.includes(url.origin as (typeof hosts)[number]) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new ProviderError('RESTRICTED', '智学网返回了未支持的官方路由');
  }
  return url.origin;
}
function number(value: z.infer<typeof metric>): number | undefined {
  if (typeof value === 'number') return value >= 0 ? value : undefined;
  return numericScore(value ?? undefined);
}
function maxScore(value: z.infer<typeof scoreSchema>): number | undefined {
  return number(value.hasAssignScore ? value.assignStandardScore : value.standardScore);
}
function expiresAt(token: string): number | undefined {
  try {
    const claims = z
      .object({
        exp: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER / 1000),
      })
      .safeParse(
        JSON.parse(
          bytesToUtf8(base64ToBytes(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))),
        ),
      );
    return claims.success ? claims.data.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
export function createZhixueProvider(transport: FetchTransport = fetch): ScoreProvider {
  let clockOffset = 0;
  // Only pagination control state, never exam/report content. Bounded in memory.
  const cursors = new Map<string, Map<number, Cursor>>();
  const revoked = new WeakSet<AuthSession>();
  async function request(
    host: string,
    path: string,
    token: string,
    params: Record<string, string | number> = {},
    options?: ProviderRequestOptions,
    retried = false,
  ): Promise<unknown> {
    const origin = zhixueOfficialHost(host);
    const guid = Crypto.randomUUID();
    const timestamp = String(Date.now() - clockOffset);
    // Public signing convention in the official report client, not a user secret.
    const signature = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.MD5,
      guid + timestamp + 'iflytek!@#123student',
    );
    let response: Response;
    try {
      response = await requestWithTimeout(
        transport,
        `${origin}${path}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`,
        {
          credentials: 'omit',
          redirect: 'error',
          signal: options?.signal,
          headers: {
            XToken: token,
            token,
            authbizcode: '0001',
            authguid: guid,
            authtimestamp: timestamp,
            authtoken: signature,
            Referer: `${www}/activitystudy/web-report/index.html`,
            Origin: www,
            'User-Agent': 'Mozilla/5.0',
          },
        },
        15000,
      );
    } catch {
      throwIfAborted(options?.signal);
      throw new ProviderError('NETWORK', '智学网连接失败，请检查网络后重试', true);
    }
    if (response.status === 401)
      throw new ProviderError('SESSION_EXPIRED', '智学网登录已失效，请重新官方网页登录');
    if (response.status === 403)
      throw new ProviderError('RESTRICTED', '智学网暂不允许访问，请前往官方页面确认');
    if (!response.ok) throw new ProviderError('NETWORK', '智学网服务暂时不可用，请稍后重试', true);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('UNKNOWN', '智学网返回了无法识别的响应');
    }
    const routed = z
      .object({ code: z.number().int(), data: z.unknown().optional() })
      .safeParse(raw);
    if (routed.success) {
      if (routed.data.code !== 200) throw new ProviderError('UNKNOWN', '智学网路由查询失败');
      return routed.data.data;
    }
    const body = parse(envelopeSchema, raw, '响应');
    if (body.errorCode === 3001)
      throw new ProviderError('SESSION_EXPIRED', '智学网登录已失效，请重新官方网页登录');
    if (body.errorCode === 1111) throw new ProviderError('RESTRICTED', '智学网暂未开放此报告');
    if (body.errorCode === 9801) {
      const calibration = z
        .array(z.object({ systime: z.union([z.string().regex(/^\d+$/), z.number().finite()]) }))
        .nonempty()
        .safeParse(body.result);
      if (
        !retried &&
        calibration.success &&
        Math.abs(Date.now() - Number(calibration.data[0].systime)) <= 86400000
      ) {
        clockOffset = Date.now() - Number(calibration.data[0].systime);
        return request(host, path, token, params, options, true);
      }
      throw new ProviderError('UNKNOWN', '智学网时间校准失败，请检查设备时间');
    }
    if (body.errorCode === 40217) throw new ProviderError('NOT_FOUND', '智学网尚未提供此内容');
    if (path === '/zhixuebao/report/checksheet/') {
      if (body.errorCode === 40219)
        throw new ProviderError('RESTRICTED', '学校尚未开放本场考试的答题卡');
      if (body.errorCode === 40216)
        throw new ProviderError('RESTRICTED', '智学网答题卡存储空间不足，暂不可查看');
      if ([40218, 40220, -1].includes(body.errorCode))
        throw new ProviderError('NOT_FOUND', '智学网暂无本场考试的答题卡');
    }
    if (body.errorCode !== 0)
      throw new ProviderError('UNKNOWN', `智学网请求未完成（${body.errorCode}）`);
    return body.result;
  }
  function context(session: AuthSession) {
    if (
      session.providerId !== id ||
      revoked.has(session) ||
      (session.expiresAt !== undefined && session.expiresAt <= Date.now())
    )
      throw new ProviderError('SESSION_EXPIRED', '请重新使用智学网官方网页登录');
    const data = parse(contextSchema, session.providerContext, '会话');
    zhixueOfficialHost(data.host);
    return data;
  }
  async function verify(session: AuthSession, options?: ProviderRequestOptions) {
    const data = context(session);
    const user = parse(
      userSchema,
      await request(
        data.host,
        '/zhixuebao/base/common/getUserInfo',
        session.accessToken,
        {},
        options,
      ),
      '用户',
    );
    if (
      user.userId !== session.accountId ||
      user.curChildId !== data.studentId ||
      user.userType !== data.userType
    )
      throw new ProviderError('RESTRICTED', '智学网当前账号或学生已变化，请重新官方网页登录原学生');
    return data;
  }
  async function years(session: AuthSession, options?: ProviderRequestOptions) {
    const data = context(session);
    return parse(
      yearsSchema,
      await request(
        data.host,
        '/zhixuebao/base/common/academicYear',
        session.accessToken,
        {},
        options,
      ),
      '学年',
    );
  }
  function currentYear(values: Year[]) {
    return (
      values.find(
        (year) => Number(year.beginTime) <= Date.now() && Date.now() <= Number(year.endTime),
      ) ?? values[0]
    );
  }
  function decodeExam(examId: string, studentId: string) {
    let decoded: unknown;
    try {
      if (!examId.startsWith('zx1.') || examId.length > 4096) throw new Error();
      decoded = JSON.parse(
        bytesToUtf8(base64ToBytes(examId.slice(4).replace(/-/g, '+').replace(/_/g, '/'))),
      );
    } catch {
      throw new ProviderError('NOT_FOUND', '考试标识无效，请重新打开考试列表');
    }
    const exam = parse(examContextSchema, decoded, '考试上下文');
    if (exam.studentId !== studentId)
      throw new ProviderError('RESTRICTED', '此考试属于另一个学生，请返回考试列表');
    return exam;
  }
  async function examHost(session: AuthSession, examId: string, options?: ProviderRequestOptions) {
    const route = parse(
      z.object({ host: z.string() }),
      await request(
        www,
        '/routingconfig/zxbRoutingConfig/getHostByBusinessId',
        session.accessToken,
        { businessType: 'exam', businessId: examId },
        options,
      ),
      '考试路由',
    );
    return zhixueOfficialHost(route.host);
  }
  async function sheetSubject(
    session: AuthSession,
    examId: string,
    subjectId: string,
    cachedResult?: ExamResult,
    options?: ProviderRequestOptions,
  ) {
    const data = await verify(session, options);
    const exam = decodeExam(examId, data.studentId);
    const result =
      cachedResult?.examId === examId
        ? cachedResult
        : await provider.getExamResult(session, examId, options);
    const subject = result.subjects.find((item) => item.id === subjectId);
    if (!subject) throw new ProviderError('NOT_FOUND', '智学网未提供该科目');
    return { exam, subject };
  }
  async function checksheet(
    session: AuthSession,
    exam: z.infer<typeof examContextSchema>,
    paperId: string,
    options?: ProviderRequestOptions,
  ) {
    const host = await examHost(session, exam.examId, options);
    const raw = await request(
      host,
      '/zhixuebao/report/checksheet/',
      session.accessToken,
      {
        examId: exam.examId,
        paperId,
        startSchoolYear: exam.start,
        endSchoolYear: exam.end,
      },
      options,
    );
    await verify(session, options);
    throwIfAborted(options?.signal);
    return raw;
  }
  async function reports(
    session: AuthSession,
    exam: z.infer<typeof examContextSchema>,
    options?: ProviderRequestOptions,
    host?: string,
    subject?: SubjectScore,
  ) {
    let route: Promise<string> | undefined;
    return zhixueReportSections(
      async (path, params) => {
        if (path === '/zhixuebao/report/common/rulesAndCopywriter')
          return request(www, path, session.accessToken, params, options);
        const origin = host ?? (await (route ??= examHost(session, exam.examId, options)));
        return request(origin, path, session.accessToken, params, options);
      },
      {
        examId: exam.examId,
        start: exam.start,
        end: exam.end,
        ...(subject
          ? { paperId: subject.id, subjectCode: subject.providerContext?.subjectCode }
          : {}),
      },
      options?.signal,
    );
  }
  const provider: ScoreProvider = {
    metadata: {
      id,
      name: '智学网',
      description: '官方网页登录，支持当前学生与历史学年成绩',
      officialDomain: www,
    },
    capabilities: {
      profile: true,
      exams: true,
      results: true,
      ranking: false,
      subjectDetails: true,
      questionScores: true,
      answerSheets: true,
    },
    async authenticate() {
      throw new ProviderError('UNSUPPORTED', '智学网请使用官方网页登录并手动完成滑块');
    },
    webLogin: {
      // Start on a script-free official status page before clearing only the
      // official web sessions and returning through the official SSO logout.
      url: `${www}/loginState/`,
      allowedOrigins: [
        www,
        'https://ali-bg.zhixue.com',
        'https://sso.zhixue.com',
        'https://open.changyan.com',
      ],
      script: zhixueLoginScript,
      async authenticate(payload) {
        const input = parse(loginSchema, payload, '登录材料');
        const user = parse(
          userSchema,
          await request(www, '/zhixuebao/base/common/getUserInfo', input.token),
          '用户',
        );
        if (
          user.userType !== input.userType ||
          (input.accountId && user.userId !== input.accountId)
        )
          throw new ProviderError('RESTRICTED', '网页账号或身份与报告不一致，请重新官方网页登录');
        if (user.curChildId !== input.student.id)
          throw new ProviderError('RESTRICTED', '网页学生与报告学生不一致，请重新进入官方成绩报告');
        const route = parse(
          z.object({ host: z.string() }),
          await request(
            www,
            '/routingconfig/reportRoutingConfig/getReportCloudRoutingHostByUserId',
            input.token,
            { userId: user.userId },
          ),
          '用户路由',
        );
        const session: AuthSession = {
          providerId: id,
          accountId: user.userId,
          accessToken: input.token,
          expiresAt: expiresAt(input.token),
          providerContext: {
            userType: user.userType,
            studentId: user.curChildId,
            studentName: input.student.name,
            ...(input.student.schoolName ? { schoolName: input.student.schoolName } : {}),
            host: zhixueOfficialHost(route.host),
          },
        };
        await verify(session);
        await years(session);
        return session;
      },
    },
    async getProfile(session, options) {
      const data = await verify(session, options);
      return {
        id: data.studentId,
        displayName: data.studentName,
        schoolName: data.schoolName,
        selected: true,
      };
    },
    async getAcademicYears(session, options) {
      await verify(session, options);
      const values = await years(session, options);
      const selected = currentYear(values);
      return [...values]
        .sort((a, b) =>
          a === selected ? -1 : b === selected ? 1 : Number(b.beginTime) - Number(a.beginTime),
        )
        .map((year) => ({ id: year.code, label: year.name || year.code }));
    },
    async getExamList(session, page, options) {
      const data = await verify(session, options);
      const values = await years(session, options);
      const year = page?.academicYear
        ? values.find((value) => value.code === page.academicYear)
        : currentYear(values);
      if (!year) throw new ProviderError('NOT_FOUND', '所选学年已不可用，请重新选择');
      const key = JSON.stringify([
        session.accountId,
        data.studentId,
        session.accessToken,
        year.code,
      ]);
      let checkpoints = cursors.get(key);
      const offset = page?.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new ProviderError('NOT_FOUND', '分页位置无效');
      if (offset === 0) {
        checkpoints = new Map([[0, { pageIndex: 1, actualPosition: 0 }]]);
        if (cursors.size >= 32) cursors.delete(cursors.keys().next().value!);
        cursors.set(key, checkpoints);
      }
      const cursor = checkpoints?.get(offset);
      if (!cursor) throw new ProviderError('RESTRICTED', '分页状态已重置，请下拉刷新考试列表');
      if (cursor.ended) return [];
      const result = parse(
        pageSchema,
        await request(
          data.host,
          '/zhixuebao/report/exam/getUserExamList',
          session.accessToken,
          {
            pageIndex: cursor.pageIndex,
            pageSize: 10,
            actualPosition: cursor.actualPosition,
            startSchoolYear: year.beginTime,
            endSchoolYear: year.endTime,
          },
          options,
        ),
        '考试列表',
      );
      if (
        result.hasNextPage &&
        (!result.examList.length || result.pagination.pageIndex <= cursor.pageIndex)
      )
        throw new ProviderError('UNKNOWN', '智学网分页未前进，请重新刷新');
      // Until cross-student token semantics are verified, check again after
      // reading content so a server-side selection change is not displayed.
      await verify(session, options);
      throwIfAborted(options?.signal);
      checkpoints!.set(offset + result.examList.length, {
        ...result.pagination,
        ended: !result.hasNextPage,
      });
      const categories: Record<string, string> = {
        monthlyExam: '月考',
        weeklyExam: '周测',
        midtermExam: '期中考试',
        unifiedExam: '统考',
      };
      return result.examList.map((exam) => ({
        id: `zx1.${bytesToBase64(
          utf8ToBytes(
            JSON.stringify({
              v: 1,
              examId: exam.examId,
              studentId: data.studentId,
              start: year.beginTime,
              end: year.endTime,
            }),
          ),
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')}`,
        name: exam.examName,
        date:
          exam.examCreateDateTime === undefined
            ? undefined
            : new Date(exam.examCreateDateTime + 8 * 3600000).toISOString().slice(0, 10),
        category: categories[exam.examType ?? ''] ?? '其它',
      }));
    },
    async getExamResult(session, examId, options) {
      const data = await verify(session, options);
      const exam = decodeExam(examId, data.studentId);
      const host = await examHost(session, exam.examId, options);
      const main = parse(
        resultSchema,
        await request(
          host,
          '/zhixuebao/report/exam/getReportMain',
          session.accessToken,
          { examId: exam.examId },
          options,
        ),
        '主报告',
      );
      const subjects: SubjectScore[] = main.paperList.map((paper) => ({
        id: paper.paperId,
        subject: paper.subjectName,
        score: number(paper.userScore),
        maxScore: maxScore(paper),
        grade: paper.userLevel || undefined,
        ...(paper.subjectCode ||
        (paper.hasAssignScore &&
          number(paper.preAssignScore) !== undefined &&
          number(paper.userScore) !== undefined)
          ? {
              providerContext: {
                ...(paper.subjectCode ? { subjectCode: paper.subjectCode } : {}),
                ...(paper.hasAssignScore &&
                number(paper.preAssignScore) !== undefined &&
                number(paper.userScore) !== undefined
                  ? {
                      originalScore: String(number(paper.preAssignScore)),
                      scaledScore: String(number(paper.userScore)),
                    }
                  : {}),
              },
            }
          : {}),
      }));
      // A single paper is the whole exam; use its score in the same summary UI.
      // Keep an explicit official total authoritative and never sum multiple papers.
      const total =
        main.totalScore ?? (main.paperList.length === 1 ? main.paperList[0] : undefined);
      const examName = main.totalScore?.examName?.trim();
      const result: ExamResult = {
        examId,
        examName: examName || '考试报告',
        ...(!examName ? { examNameIsFallback: true } : {}),
        subjects,
      };
      if (total) {
        result.totalScore = number(total.userScore);
        result.maxTotalScore = maxScore(total);
        result.grade = total.userLevel || undefined;
        if (total.hasAssignScore) {
          result.originalTotalScore = number(total.preAssignScore);
          result.originalMaxTotalScore = number(total.standardScore);
        }
      }
      result.reportSections = await reports(session, exam, options, host);
      await verify(session, options);
      throwIfAborted(options?.signal);
      return result;
    },
    async getSubjectDetail(session, examId, subjectId, cachedResult, options) {
      const { exam, subject } = await sheetSubject(
        session,
        examId,
        subjectId,
        cachedResult,
        options,
      );
      const detail = {
        subjectId,
        subject: subject.subject,
        score: subject.score,
        maxScore: subject.maxScore,
        grade: subject.grade,
        providerContext: subject.providerContext,
      };
      const complete = async (parsed: ReturnType<typeof zhixueQuestions>) => {
        const reportSections = await reports(session, exam, options, undefined, subject);
        await verify(session, options);
        throwIfAborted(options?.signal);
        return { ...detail, ...parsed, reportSections };
      };
      let parsed: ReturnType<typeof zhixueQuestions>;
      try {
        parsed = zhixueQuestions(await checksheet(session, exam, subjectId, options));
      } catch (error) {
        if (!(error instanceof ProviderError) || !['NOT_FOUND', 'RESTRICTED'].includes(error.code))
          throw error;
        return complete({ questions: [], questionNotice: error.message });
      }
      if (!parsed.questions.some((question) => question.kind === 'objective'))
        return complete(parsed);
      try {
        const analysis = await request(
          www,
          '/zxbReport/report/getPaperAnalysis',
          session.accessToken,
          { examId: exam.examId, paperId: subjectId },
          options,
        );
        parsed = zhixueQuestionAnswers(parsed.questions, analysis);
      } catch (error) {
        throwIfAborted(options?.signal);
        if (!(error instanceof ProviderError) || error.code === 'SESSION_EXPIRED') throw error;
        parsed.questionNotice =
          error.code === 'NOT_FOUND'
            ? '智学网尚未提供本场考试的选择题正确答案。'
            : error.code === 'RESTRICTED'
              ? '智学网暂未开放本场考试的正确答案。'
              : '正确答案暂时加载失败，可下拉刷新重试；已有得分与我的答案仍可查看。';
      }
      return complete(parsed);
    },
    async getAnswerSheets(session, examId, subjectId, cachedResult, options) {
      const { exam, subject } = await sheetSubject(
        session,
        examId,
        subjectId,
        cachedResult,
        options,
      );
      return zhixueSheets(
        await checksheet(session, exam, subjectId, options),
        subjectId,
        subject.subject,
      );
    },
    async getQuestionAnswerSheets(session, examId, subjectId, questionId, cachedResult, options) {
      const { exam, subject } = await sheetSubject(
        session,
        examId,
        subjectId,
        cachedResult,
        options,
      );
      const sheets = zhixueQuestionSheets(
        await checksheet(session, exam, subjectId, options),
        subjectId,
        subject.subject,
        questionId,
      );
      throwIfAborted(options?.signal);
      return sheets;
    },
    async logout(session) {
      revoked.add(session);
      for (const key of cursors.keys()) {
        const [parent, , token] = JSON.parse(key) as string[];
        if (parent === session.accountId && token === session.accessToken) cursors.delete(key);
      }
    },
  };
  return provider;
}
export const zhixueProvider = createZhixueProvider();
