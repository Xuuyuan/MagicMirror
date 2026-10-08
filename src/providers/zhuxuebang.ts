import { z } from 'zod';
import { ProviderError, type AnswerSheet, type AuthSession, type ExamResult, type QuestionScore, type QuestionScoreSummary, type StudentProfile, type SubjectScore } from '../domain/models';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import { base64ToBytes, bytesToUtf8, numericScore, parseValidated } from './codec';

const providerId = 'zhuxuebang';
const queryHost = 'https://stuquery.wylkyj.com';
const examHost = 'https://onlinexam.wylkyj.com';
const identifier = z.union([z.string().min(1), z.number().int().safe().nonnegative()]);
const flag = z.union([z.boolean(), z.number().int()]);
const metric = z.union([z.string(), z.number().finite()]).nullish();
const envelopeSchema = z.object({ code: z.number().int(), message: z.string().optional(), datas: z.unknown().optional() });
const loginSchema = z.object({ token: z.string().min(1) });
const studentId = identifier.refine((value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0);
const studentSchema = z.object({ id: studentId, stuName: z.string().min(1), schName: z.string().nullish(), gradeName: z.string().nullish() });
const profileSchema = studentSchema.extend({ gradeNo: identifier.nullish(), schNo: identifier.nullish() });
const sessionContextSchema = z.object({ studentId: z.string().regex(/^\d+$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0) });
const examSchema = z.object({
  examNo: identifier, examPno: identifier, examName: z.string().min(1), stuNo: z.string().min(1),
  examTime: z.string().nullish(), examType: z.string().nullish(),
  isAllowQuery: flag, showScore: flag.optional(), isGetAnswerSheet: flag.optional(),
});
// 当前官方成功响应会把 pageIndex/pageSize 填为 0，不能把这些占位字段当作分页失败。
const pageSchema = z.object({ list: z.array(examSchema), pageIndex: z.number().int().nonnegative(), pageSize: z.number().int().nonnegative(), count: z.number().int().nonnegative() });
const subjectSchema = z.object({
  esubNo: identifier, esubName: z.string().min(1), score: metric, giveScore: metric, rawScore: metric,
  scaleScore: z.number().int(), scale: z.string().nullish(), statType: z.number().int().optional(), subScore: metric,
  mergeSubInfo: z.object({ esubNo: identifier }).nullish(),
});
const scoresSchema = z.object({ score: metric, rawScore: metric, scaleScore: z.number().int(), showScore: flag, stuSubScoreDtos: z.array(subjectSchema) });
const sheetsSchema = z.array(z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'data.wylkyj.com' && !url.port && !url.username && !url.password && url.pathname.startsWith('/AnswerSheet/');
}));
const jwtSchema = z.object({ ExamNo: z.string(), SchNo: z.string(), GradeNo: z.string(), StuNo: z.string(), exp: z.number().int().positive() });
const examStudentSchema = z.object({ isPassWord: z.boolean() });
const answersSchema = z.union([z.string(), z.array(z.string())]).nullish();
const questionSchema = z.object({
  queNo: identifier, queName: z.string().nullish(), queScore: metric, stuScore: metric,
  isObject: z.union([z.literal(0), z.literal(1)]), stuAnswer: answersSchema, queAnswer: answersSchema,
});
const questionsSchema = z.object({ onlineQues: z.array(z.object({ queName: z.string().min(1), queScore: metric, queList: z.array(questionSchema) })) });
type Exam = z.infer<typeof examSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  return parseValidated(schema, value, `助学帮${label}结构不符合预期`);
}
function enabled(value: boolean | number | undefined): boolean { return value === true || value === 1; }
function score(value: string | number | null | undefined): number | undefined {
  const result = typeof value === 'number' ? value : numericScore(value ?? undefined);
  return result !== undefined && result >= 0 ? result : undefined;
}
function answer(value: z.infer<typeof answersSchema>): string | undefined {
  const parts = typeof value === 'string' ? [value] : value ?? [];
  const valid = parts.filter((item) => item.trim() && item !== '-');
  if (!valid.length) return undefined;
  // 多选选项次序不影响答案；其他类型保留原顺序。
  return valid.every((item) => /^[A-Z]$/.test(item)) ? [...valid].sort().join('') : valid.join('、');
}
function questionScoreSummaries(subject: SubjectScore, questions: QuestionScore[]): QuestionScoreSummary[] | undefined {
  const leaves = (items: QuestionScore[]): QuestionScore[] => items.flatMap((item) => item.children !== undefined ? leaves(item.children) : [item]);
  const all = leaves(questions);
  const original = subject.providerContext?.originalScore;
  const rawScore = original !== undefined ? score(original) : subject.providerContext?.scoreBasis === 'scaled' ? undefined : subject.score;
  const fullScore = subject.maxScore;
  if (rawScore === undefined || fullScore === undefined || !Number.isFinite(rawScore) || !Number.isFinite(fullScore) || rawScore < 0 || fullScore <= 0 || rawScore > fullScore || !all.length) return undefined;
  if (all.some((item) => item.kind === undefined || item.maxScore === undefined || !Number.isFinite(item.maxScore) || item.maxScore < 0)) return undefined;
  const sumMax = (items: QuestionScore[]) => items.reduce((sum, item) => sum + item.maxScore!, 0);
  // 只用小题验证完整性，题组满分不能重复累计；容忍浮点运算误差。
  const epsilon = 0.000001;
  if (Math.abs(sumMax(all) - fullScore) > epsilon) return undefined;
  const objective = all.filter((item) => item.kind === 'objective');
  const subjective = all.filter((item) => item.kind === 'subjective');
  if (!subjective.length || objective.some((item) => item.score === undefined || !Number.isFinite(item.score) || item.score < 0 || item.score > item.maxScore!)) return undefined;
  const objectiveScore = objective.reduce((sum, item) => sum + item.score!, 0);
  const subjectiveMax = sumMax(subjective);
  const inferred = rawScore - objectiveScore;
  if (inferred < -epsilon || inferred > subjectiveMax + epsilon) return undefined;
  const clean = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return [
    ...(objective.length ? [{ kind: 'objective' as const, score: clean(objectiveScore), maxScore: clean(sumMax(objective)) }] : []),
    { kind: 'subjective', score: clean(Math.min(subjectiveMax, Math.max(0, inferred))), maxScore: clean(subjectiveMax), inferred: true },
  ];
}
function businessError(code: number, message = '', authenticating = false): ProviderError {
  if ([401, 101, 701, 702, 705].includes(code)) return new ProviderError('SESSION_EXPIRED', '助学帮登录已失效，请重新登录');
  // -1000 同时用于权限、参数和登录错误，必须结合业务提示分类。
  if (/套餐|购买|付费|未开放|禁止查询|权限|验证码|安全验证|考试密码|单位未授权/.test(message)) return new ProviderError('RESTRICTED', '助学帮暂未开放此内容，请在官方 App 确认查询权限');
  if (authenticating && /密码|账号|手机号|用户不存在/.test(message)) return new ProviderError('INVALID_CREDENTIALS', '助学帮账号或密码不正确');
  if (code === 204 && /为空|无数据/.test(message)) return new ProviderError('NOT_FOUND', '助学帮暂未提供此内容');
  return new ProviderError('UNKNOWN', '助学帮暂时无法完成此请求');
}

export function createZhuxuebangProvider(options: { transport?: FetchTransport } = {}): ScoreProvider {
  const transport = options.transport ?? fetch;
  const revoked = new WeakSet<AuthSession>();
  const examTokens = new Map<string, { token: string; expiresAt: number }>();
  function context(session: AuthSession) {
    if (revoked.has(session) || session.providerId !== providerId || !session.accessToken) throw new ProviderError('SESSION_EXPIRED', '助学帮登录状态无效');
    return parse(sessionContextSchema, session.providerContext, '会话');
  }
  function queryHeaders(session: AuthSession, exam?: Exam): Record<string, string> {
    const { studentId } = context(session);
    return { token: session.accessToken, stuId: studentId, ...(exam ? {
      exam_no: String(exam.examNo),
      // 与官方 H5 的 examInfo.examPno || '' 一致；"0" 会触发项目错误。
      exam_pno: Number(exam.examPno) === 0 ? '' : String(exam.examPno),
    } : {}) };
  }
  async function request(path: string, body: unknown, headers: Record<string, string> = {}, requestOptions?: ProviderRequestOptions, authenticating = false, host = queryHost): Promise<unknown> {
    try {
      const response = await requestWithTimeout(transport, host + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
        signal: requestOptions?.signal, credentials: 'omit', redirect: 'error',
      });
      if (response.status === 401) throw new ProviderError('SESSION_EXPIRED', '助学帮登录已失效，请重新登录');
      if ([403, 429, 451].includes(response.status)) throw new ProviderError('RESTRICTED', '助学帮限制了此请求，请稍后在官方 App 确认');
      if (response.status !== 200) throw new ProviderError('NETWORK', '助学帮服务请求失败', response.status >= 500);
      const result = parse(envelopeSchema, await response.json(), '响应');
      if (result.code !== 200) throw businessError(result.code, result.message, authenticating);
      return result.datas;
    } catch (error) {
      throwIfAborted(requestOptions?.signal);
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('NETWORK', '助学帮请求失败或超时', true);
    }
  }
  async function student(session: AuthSession, requestOptions?: ProviderRequestOptions) {
    const value = parse(profileSchema, await request('/api/v2/Mine/GetStudentInfo', {}, queryHeaders(session), requestOptions), '学生信息');
    if (String(value.id) !== context(session).studentId) throw new ProviderError('RESTRICTED', '助学帮当前学生已变更，请重新登录');
    return value;
  }
  async function examState(session: AuthSession, examId: string, requestOptions?: ProviderRequestOptions): Promise<Exam> {
    const value = parse(examSchema, await request('/api/v2/exam/CheckExamState', { examNo: examId }, queryHeaders(session), requestOptions), '考试状态');
    if (String(value.examNo) !== examId) throw new ProviderError('NOT_FOUND', '助学帮返回了不匹配的考试');
    if (!enabled(value.isAllowQuery)) throw new ProviderError('RESTRICTED', '助学帮尚未开放该考试查询');
    return value;
  }
  async function examResult(session: AuthSession, exam: Exam, requestOptions?: ProviderRequestOptions): Promise<ExamResult> {
    const value = parse(scoresSchema, await request('/api/v2/Score/GetStuSubScores', { stuNo: exam.stuNo, source: 1 }, queryHeaders(session, exam), requestOptions), '成绩');
    const visible = enabled(value.showScore);
    // 官方将赋分行（原科目 ID + v）与原分行分开返回；入口和后续接口使用原科目。
    const assigned = new Map<string, z.infer<typeof subjectSchema>>();
    for (const item of value.stuSubScoreDtos) {
      if (item.statType !== 1 || item.scaleScore !== 1 || !String(item.esubNo).endsWith('v')) continue;
      const originalId = String(item.esubNo).slice(0, -1);
      const name = item.esubName.replace(/\s*[（(]赋分[）)]$/, '');
      if (value.stuSubScoreDtos.some((original) => String(original.esubNo) === originalId && original.esubName === name && original.scaleScore === 0)) assigned.set(originalId, item);
    }
    const mergedIds = new Set([...assigned.values()].map((item) => String(item.esubNo)));
    return {
      examId: String(exam.examNo), examName: exam.examName,
      totalScore: visible ? score(value.score) : undefined,
      originalTotalScore: visible && value.scaleScore === 1 ? score(value.rawScore) : undefined,
      subjects: value.stuSubScoreDtos.filter((item) => !mergedIds.has(String(item.esubNo))).map((item) => {
        const scaled = assigned.get(String(item.esubNo));
        const displayed = scaled ?? item;
        // 缺少原科目行的独立赋分行，score 也是赋分，不能当原始分。
        const originalScore = score(!scaled && item.statType === 1 && item.scaleScore === 1 ? item.rawScore : item.score);
        const scaledScore = score(displayed.giveScore);
        return {
          id: String(item.esubNo), subject: item.esubName,
          score: visible ? score(displayed.scaleScore === 1 ? displayed.giveScore : displayed.score) : undefined,
          maxScore: score(item.subScore),
          grade: [1, 2].includes(displayed.scaleScore) && displayed.scale && displayed.scale !== '-' ? displayed.scale : undefined,
          providerContext: {
            ...(displayed.scaleScore === 1 ? { scoreBasis: 'scaled' } : {}),
            ...(visible && (scaled || item.scaleScore === 1) && originalScore !== undefined ? { originalScore: String(originalScore), ...(scaledScore !== undefined ? { scaledScore: String(scaledScore) } : {}) } : {}),
            ...(item.statType === 5 && item.mergeSubInfo ? { answerSheetSubjectId: String(item.mergeSubInfo.esubNo) } : {}),
          },
        };
      }),
    };
  }
  async function subjectsFor(session: AuthSession, exam: Exam, cachedResult?: ExamResult, requestOptions?: ProviderRequestOptions) {
    if (cachedResult && cachedResult.examId !== String(exam.examNo)) throw new ProviderError('NOT_FOUND', '助学帮成绩缓存与考试不匹配');
    return (cachedResult ?? await examResult(session, exam, requestOptions)).subjects;
  }
  function examTokenKey(session: AuthSession, exam: Exam) {
    return `${session.accessToken}:${context(session).studentId}:${exam.examNo}:${exam.stuNo}`;
  }
  async function examLoginRequest(path: string, body: unknown, headers: Record<string, string>, requestOptions?: ProviderRequestOptions) {
    try { return await request(path, body, headers, requestOptions, false, examHost); }
    catch (error) {
      // 新考试会话本身被拒绝时，不让账号层误重登成绩查询账号。
      if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw new ProviderError('RESTRICTED', '助学帮考试登录不可用，请在官方 App 确认');
      throw error;
    }
  }
  async function onlineToken(session: AuthSession, exam: Exam, requestOptions?: ProviderRequestOptions) {
    const key = examTokenKey(session, exam);
    const cached = examTokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    examTokens.delete(key);
    const profile = await student(session, requestOptions);
    if (!profile.gradeNo || !profile.schNo) throw new ProviderError('RESTRICTED', '助学帮的学校信息不完整，请在官方 App 确认');
    const params = { examNo: String(exam.examNo), gradeNo: String(profile.gradeNo), schNo: String(profile.schNo), stuNo: exam.stuNo, platform: 0, deviceId: 'MagicMirror' };
    const token = parse(z.string().regex(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), await examLoginRequest('/api/v1/student/StuLogin', params, {}, requestOptions), '考试登录');
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    let claims: z.infer<typeof jwtSchema>;
    try { claims = parse(jwtSchema, JSON.parse(bytesToUtf8(base64ToBytes(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))), '考试会话'); }
    catch { throw new ProviderError('UNKNOWN', '助学帮考试会话结构不符合预期'); }
    if (claims.ExamNo !== params.examNo || claims.StuNo !== params.stuNo || claims.SchNo !== params.schNo || claims.GradeNo !== params.gradeNo || claims.exp * 1000 <= Date.now() + 30_000) throw new ProviderError('RESTRICTED', '助学帮返回了无效或不匹配的考试会话');
    const info = parse(examStudentSchema, await examLoginRequest('/api/v1/student/GetStudetInfo', { examNo: params.examNo, gradeNo: params.gradeNo, schNo: params.schNo, stuNo: params.stuNo }, { token }, requestOptions), '考试学生信息');
    if (info.isPassWord) throw new ProviderError('RESTRICTED', '该考试需要官方考试密码，请在助学帮 App 查看');
    context(session);
    if (examTokens.size >= 32) examTokens.delete(examTokens.keys().next().value!);
    examTokens.set(key, { token, expiresAt: claims.exp * 1000 });
    return token;
  }
  async function questions(session: AuthSession, exam: Exam, subjectId: string, requestOptions?: ProviderRequestOptions): Promise<QuestionScore[]> {
    const key = examTokenKey(session, exam);
    // 考试 Token 失效只重新换取一次，不使成绩查询 Token 失效。
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await onlineToken(session, exam, requestOptions);
      try {
        const value = parse(questionsSchema, await request('/api/v1/subject/GetSubQueList', { examNo: String(exam.examNo), esubNo: subjectId, stuNo: exam.stuNo }, { token }, requestOptions, false, examHost), '逐题明细');
        return value.onlineQues.map((group, groupIndex) => ({
          id: `group-${groupIndex}`, label: group.queName, maxScore: score(group.queScore),
          children: group.queList.map((item, index) => ({
            id: `${groupIndex}-${item.queNo}-${index}`, label: item.queName || String(item.queNo),
            maxScore: score(item.queScore), score: score(item.stuScore),
            kind: item.isObject === 1 ? 'objective' as const : 'subjective' as const,
            myAnswer: item.isObject === 1 ? answer(item.stuAnswer) : undefined,
            answer: item.isObject === 1 ? answer(item.queAnswer) : undefined,
          })),
        }));
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== 'SESSION_EXPIRED') throw error;
        examTokens.delete(key);
        if (attempt === 1) throw new ProviderError('RESTRICTED', '助学帮考试会话不可用，请在官方 App 确认');
      }
    }
    return [];
  }
  return {
    metadata: { id: providerId, name: '助学帮', remark: '五岳阅卷', officialDomain: queryHost, description: '直连助学帮官方服务；查询本人已绑定考试。' },
    capabilities: { profile: true, exams: true, results: true, ranking: false, subjectDetails: true, questionScores: true, answerSheets: true },
    async authenticate(account, password) {
      if (!account.trim() || !password) throw new ProviderError('INVALID_CREDENTIALS', '请输入助学帮手机号和密码');
      const login = parse(loginSchema, await request('/api/v1/auth/LoginByPassword', { mobile: account.trim(), password }, {}, undefined, true), '登录');
      const headers = { token: login.token };
      const students = parse(z.array(studentSchema), await request('/api/v1/Mine/GetStudentList', {}, headers), '学生列表');
      if (!students.length) throw new ProviderError('RESTRICTED', '请先在助学帮官方 App 绑定学生');
      if (students.length !== 1) throw new ProviderError('RESTRICTED', '助学帮多学生账号暂不支持，请使用仅绑定一个学生的账号');
      const selected = students[0];
      const session: AuthSession = { providerId, accountId: account.trim(), accessToken: login.token, providerContext: { studentId: String(selected.id) } };
      await student(session);
      return session;
    },
    async getProfile(session, requestOptions): Promise<StudentProfile> {
      const value = await student(session, requestOptions);
      return { id: String(value.id), displayName: value.stuName, schoolName: value.schName ?? undefined, grade: value.gradeName ?? undefined };
    },
    async getExamList(session, page, requestOptions) {
      const offset = page?.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ProviderError('UNKNOWN', '助学帮分页参数无效');
      const pageSize = 20;
      const pageIndex = Math.floor(offset / pageSize) + 1;
      const value = parse(pageSchema, await request('/api/v2/exam/GetStuExamList', { pageIndex, pageSize, stuId: Number(context(session).studentId) }, queryHeaders(session), requestOptions), '考试列表');
      if ((value.pageIndex !== 0 && value.pageIndex !== pageIndex) || (value.pageSize !== 0 && value.pageSize !== pageSize)) throw new ProviderError('UNKNOWN', '助学帮返回了不匹配的分页');
      if (offset >= value.count) return [];
      // 列表 isAllowQuery=false 可能是占位值；官方打开报告时以 CheckExamState 为准。
      return value.list.slice(offset % pageSize).map((item) => ({ id: String(item.examNo), name: item.examName, date: item.examTime?.replace(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}$/, '$1'), category: item.examType || undefined }));
    },
    async getExamResult(session, examId, requestOptions) { return examResult(session, await examState(session, examId, requestOptions), requestOptions); },
    async getSubjectDetail(session, examId, subjectId, cachedResult, requestOptions) {
      const exam = await examState(session, examId, requestOptions);
      const subject = (await subjectsFor(session, exam, cachedResult, requestOptions)).find((item) => item.id === subjectId);
      if (!subject) throw new ProviderError('NOT_FOUND', '助学帮未提供该科目');
      const subjectQuestions = await questions(session, exam, subject.providerContext?.answerSheetSubjectId ?? subjectId, requestOptions);
      return { subjectId, subject: subject.subject, score: subject.score, maxScore: subject.maxScore, grade: subject.grade, providerContext: subject.providerContext, questions: subjectQuestions, questionScoreSummaries: questionScoreSummaries(subject, subjectQuestions) };
    },
    async getAnswerSheets(session, examId, subjectId, cachedResult, requestOptions): Promise<AnswerSheet[]> {
      const exam = await examState(session, examId, requestOptions);
      if (!enabled(exam.isGetAnswerSheet)) throw new ProviderError('RESTRICTED', '助学帮尚未开放该考试答题卡');
      const subjects = await subjectsFor(session, exam, cachedResult, requestOptions);
      const subject = subjects.find((item) => item.id === subjectId);
      if (!subject) throw new ProviderError('NOT_FOUND', '助学帮未提供该科目');
      const esubNo = subject.providerContext?.answerSheetSubjectId ?? subject.id;
      const urls = parse(sheetsSchema, await request('/api/v1/Score/GetStuAnswersheet', { stuNo: exam.stuNo, esubNo }, queryHeaders(session, exam), requestOptions), '答题卡');
      return urls.map((url) => ({ subject: subject.subject, subjectId: subject.id, url, watermarked: false }));
    },
    async logout(session) {
      revoked.add(session);
      for (const key of examTokens.keys()) if (key.startsWith(`${session.accessToken}:`)) examTokens.delete(key);
      // 本地账号层删除 SecureStore 会话；auth/LogOff 是注销账号，不能调用。
    },
  };
}

export const zhuxuebangProvider = createZhuxuebangProvider();
