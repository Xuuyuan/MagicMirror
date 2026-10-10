import { createHaitunyuejuanProvider } from '@/src/providers/haitunyuejuan';
import type { AuthSession, ExamResult } from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';
import { haitunQuestionAnalysisResponse, haitunSubjectDetailResponse } from './fixtures/haitunyuejuan';

// 全部为虚构数据（仅结构与真实响应一致），不含任何真实账号信息。
const okEnvelope = (data: unknown) => ({ errno: 0, errmsg: 'ok', data, traceId: 'trace-fixture' });
const loginData = { accessToken: 'a'.repeat(40), refreshToken: 'r'.repeat(40), expiresIn: 900 };
const bindings = [
  { bindingId: 21, studentId: 310, name: '林测测', schoolName: '虚构第一中学', grade: '高一', banji: '3', default: 0 },
  { bindingId: 22, studentId: 311, name: '林测测', schoolName: '虚构第一中学', grade: '高一', banji: '3', default: 1 },
];
const exams = [
  { examId: 9001, examName: '虚构月考一', beginTime: '2026-10-05' },
  { examId: 9002, examName: '虚构月考二', beginTime: '2026-09-01' },
  { examId: 9003, examName: '虚构月考三', beginTime: '2026-08-01' },
  { examId: 9004, examName: '虚构月考四', beginTime: '2026-07-01' },
  { examId: 9005, examName: '虚构月考五', beginTime: '2026-06-01' },
  { examId: 9006, examName: '虚构月考六', beginTime: '2026-05-01' },
];
const subjectRows = [
  { examId: 9001, subjectId: 0, subjectName: '', score: '200.00', fullScore: 250, classRank: 5, gradeRank: 40, classAvgScore: null, gradeAvgScore: null, beatClass: 60.5, beatGrade: 55.2, beatUnion: null },
  { examId: 9001, subjectId: 8101, subjectName: '数学', score: '120.00', fullScore: 150, classRank: 4, gradeRank: 33, classAvgScore: 105.5, gradeAvgScore: 98.2, beatClass: 70.1, beatGrade: 62.3, beatUnion: null },
  { examId: 9001, subjectId: 8102, subjectName: '物理', score: '80.00', fullScore: 100, classRank: 6, gradeRank: 51, classAvgScore: 72.3, gradeAvgScore: 70.8, beatClass: 55.0, beatGrade: 48.7, beatUnion: null },
];
const subjectDetail = {
  examId: 9001, subjectId: 8101, subjectName: '数学', score: '120.00', fullScore: 150,
  classRank: 4, gradeRank: 33, classAvgScore: 105.5, gradeAvgScore: 98.2,
  beatClass: 70.1, beatGrade: 62.3, beatUnion: null,
  paperBrief: [
    { questionNo: '客观题', tihao: null, score: 60, fullScore: 70, questionType: '1' },
    { questionNo: '主观题', tihao: null, score: 60, fullScore: 80, questionType: '2' },
  ],
};
const smallScores = [
  { tihao: '1.1', questionType: '1', score: 5, fullScore: 5, stuAnswer: 'C', answer: 'C' },
  { tihao: '1.2', questionType: '1', score: 0, fullScore: 5, stuAnswer: 'A', answer: 'B' },
  { tihao: '2.3.1', questionType: '2', score: 6, fullScore: 10, stuAnswer: '', answer: '' },
  { tihao: '2.3.2', questionType: '9', score: 2, fullScore: 4, stuAnswer: '', answer: '' },
];
const answerSheet = { imgs: ['http://ossimage.haitunyuejuan.com/fake-000001.jpg', 'http://ossimage.haitunyuejuan.com/fake-000002.jpg'], sizes: [[100, 100]] };

interface Route { match: string; status?: number; body: unknown }
function setup(routes: Route[]) {
  const transport = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes.find((candidate) => url.includes(candidate.match));
    if (!route) throw new Error(`unexpected url: ${url}`);
    return {
      status: route.status ?? 200,
      headers: { get: () => null },
      json: async () => route.body,
    } as unknown as Response;
  });
  return { provider: createHaitunyuejuanProvider({ transport }), transport };
}

function standardRoutes(extra: Route[] = []): Route[] {
  // 自定义路由在前，允许按 URL 前缀覆盖同端点的默认虚构响应。
  return [
    ...extra,
    { match: '/auth/login', body: okEnvelope(loginData) },
    { match: '/students', body: okEnvelope(bindings) },
    { match: '/exams?', body: okEnvelope(exams) },
    { match: '/subjects?', body: okEnvelope(subjectRows) },
  ];
}

const freshSession = (accessToken = 'a'.repeat(40)): AuthSession => ({
  providerId: 'haitunyuejuan', accountId: '13800000000', accessToken,
  expiresAt: Date.now() + 600_000,
  providerContext: { refreshToken: 'r'.repeat(40), bindingId: '22', studentId: '311', studentName: '林测测' },
});
const cachedResult = (subjects = subjectRows): ExamResult => ({
  examId: '9001', examName: '虚构月考一',
  subjects: subjects.filter((row) => row.subjectId !== 0).map((row) => ({ id: String(row.subjectId), subject: row.subjectName })),
});

describe('海豚阅卷 Provider（无网络，虚构数据）', () => {
  it('登录成功：携带小程序 UA 与手机号密码，绑定默认学生并写入会话上下文', async () => {
    const { provider, transport } = setup(standardRoutes());
    const session = await provider.authenticate(' 13800000000 ', 'fake-password');
    expect(session.providerId).toBe('haitunyuejuan');
    expect(session.accountId).toBe('13800000000');
    expect(session.accessToken).toBe(loginData.accessToken);
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 800_000);
    expect(session.providerContext).toMatchObject({ refreshToken: loginData.refreshToken, bindingId: '22', studentId: '311', studentName: '林测测' });
    const [loginCall] = transport.mock.calls as unknown as [[string, RequestInit]];
    expect(loginCall[0]).toBe('https://student-api.haitunyuejuan.com/api/student/v1/auth/login');
    expect(JSON.parse(String(loginCall[1].body))).toEqual({ phone: '13800000000', password: 'fake-password', code: '' });
    expect((loginCall[1].headers as Record<string, string>)['User-Agent']).toContain('MiniProgramEnv/Windows');
  });

  it('登录失败（errno 401）映射为凭据错误，不透出平台原始文案以外的内容', async () => {
    const { provider } = setup([{ match: '/auth/login', body: { errno: 401, errmsg: '手机号或密码错误', data: null } }]);
    await expect(provider.authenticate('13800000000', 'bad-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('登录 errno 400（密码长度/手机号格式）按平台 errmsg 提示为凭据问题', async () => {
    const { provider } = setup([{ match: '/auth/login', body: { errno: 400, errmsg: '密码长度需 6~20 位', data: null } }]);
    await expect(provider.authenticate('13800000000', '123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: '密码长度需 6~20 位' });
  });

  it('业务错误展示平台 errmsg，空白或缺失时回退通用文案并限长', async () => {
    const withMessage = setup([{ match: '/students', body: { errno: 500, errmsg: '  虚构业务提示，请稍后再试  ', data: null } }]);
    await expect(withMessage.provider.getProfile(freshSession())).rejects.toMatchObject({ code: 'UNKNOWN', message: '虚构业务提示，请稍后再试' });
    for (const errmsg of [undefined, '   ']) {
      const empty = setup([{ match: '/students', body: { errno: 500, ...(errmsg === undefined ? {} : { errmsg }), data: null } }]);
      await expect(empty.provider.getProfile(freshSession())).rejects.toMatchObject({ code: 'UNKNOWN', message: '海豚阅卷暂时无法完成此请求' });
    }
    const long = setup([{ match: '/students', body: { errno: 500, errmsg: '长'.repeat(200), data: null } }]);
    const error = await long.provider.getProfile(freshSession()).catch((value: unknown) => value);
    expect((error as { message: string }).message).toHaveLength(60);
  });

  it('空账号或空密码直接拒绝，不发请求', async () => {
    const { provider, transport } = setup([]);
    await expect(provider.authenticate('  ', 'x')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(provider.authenticate('13800000000', '')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('refreshSession：使用 refreshToken 换新令牌并写回轮换后的 refreshToken', async () => {
    const nextLogin = { accessToken: 'b'.repeat(40), refreshToken: 'r2'.repeat(20), expiresIn: 900 };
    const { provider, transport } = setup([{ match: '/auth/refresh', body: okEnvelope(nextLogin) }]);
    const before = freshSession();
    const after = await provider.refreshSession!(before);
    expect(after.accessToken).toBe(nextLogin.accessToken);
    expect(after.providerContext?.refreshToken).toBe(nextLogin.refreshToken);
    expect(after.providerContext?.bindingId).toBe('22');
    expect(after.expiresAt).toBeGreaterThan(Date.now() + 800_000);
    const [call] = transport.mock.calls as unknown as [[string, RequestInit]];
    expect(JSON.parse(String(call[1].body))).toEqual({ refreshToken: 'r'.repeat(40) });
    expect((call[1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('refreshSession 在 refreshToken 失效（HTTP 200 + errno 401）时抛会话过期，交由外层回退密码重登', async () => {
    const { provider } = setup([{ match: '/auth/refresh', body: { errno: 401, errmsg: '刷新令牌已失效或被重复使用', data: null } }]);
    await expect(provider.refreshSession!(freshSession())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('getProfile 返回默认绑定学生', async () => {
    const { provider } = setup(standardRoutes());
    const profile = await provider.getProfile(freshSession());
    expect(profile).toEqual({ id: '311', displayName: '林测测', schoolName: '虚构第一中学', grade: '高一' });
  });

  it('列出全部绑定并切换学生后，查询上下文改为目标绑定', async () => {
    const { provider } = setup(standardRoutes());
    const profiles = await provider.getProfiles!(freshSession());
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({ id: '21', displayName: '林测测', providerContext: { bindingId: '21', studentId: '310' } });
    expect(profiles[1]).toMatchObject({ id: '22', selected: true });
    const switched = await provider.selectProfile!(freshSession(), '21');
    expect(switched.providerContext).toMatchObject({ bindingId: '21', studentId: '310', studentName: '林测测' });
  });

  it('getExamList 按每页 5 场内存切片', async () => {
    const { provider } = setup(standardRoutes());
    const page1 = await provider.getExamList(freshSession());
    const page2 = await provider.getExamList(freshSession(), { offset: 5 });
    expect(page1).toHaveLength(5);
    expect(page2).toHaveLength(1);
    expect(page1[0]).toMatchObject({ id: '9001', name: '虚构月考一', date: '2026-10-05' });
    expect(page2[0].id).toBe('9006');
  });

  it('getExamResult：总分汇总行映射总分与名次，科目行映射分数与班级/年级均分', async () => {
    const { provider } = setup(standardRoutes());
    const result = await provider.getExamResult(freshSession(), '9001');
    expect(result.examName).toBe('虚构月考一');
    expect(result.totalScore).toBe(200);
    expect(result.maxTotalScore).toBe(250);
    expect(result.gradePercentile).toBe('超过55.2%');
    expect(result.defeatRates).toEqual([{ scope: 'class', value: 60.5 }, { scope: 'grade', value: 55.2 }]);
    // 平台没有下发参考人数；击败率不能反推出官方精确人数。
    expect(result.ranking).toEqual({ scope: 'grade', rank: 40 });
    expect(result.rankings).toEqual([{ scope: 'class', rank: 5 }, { scope: 'grade', rank: 40 }]);
    expect(result.subjects).toHaveLength(2);
    expect(result.subjects[0]).toMatchObject({ id: '8101', subject: '数学', score: 120, maxScore: 150 });
    expect(result.subjects[0].providerContext).toMatchObject({ classAvgScore: '105.5', gradeAvgScore: '98.2', beatClass: '70.1', beatGrade: '62.3' });
  });

  it('总分满分缺失时按各科满分加和', async () => {
    const rows = subjectRows.map((row) => ({ ...row, fullScore: row.subjectId === 0 ? null : row.fullScore }));
    const { provider } = setup(standardRoutes([{ match: '/subjects?', body: okEnvelope(rows) }]));
    const result = await provider.getExamResult(freshSession(), '9001');
    expect(result.maxTotalScore).toBe(250);
  });

  it('击败率缺失或异常时不推算总人数，名次保持原值', async () => {
    const rows = subjectRows.map((row) => ({ ...row, beatClass: null, beatGrade: 120 }));
    const { provider } = setup(standardRoutes([{ match: '/subjects?', body: okEnvelope(rows) }]));
    const result = await provider.getExamResult(freshSession(), '9001');
    expect(result.rankings).toEqual([{ scope: 'class', rank: 5 }, { scope: 'grade', rank: 40 }]);
  });

  it('getExamResult 在考试列表中找不到该考试时抛 NOT_FOUND', async () => {
    const { provider } = setup(standardRoutes());
    await expect(provider.getExamResult(freshSession(), '9999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getSubjectDetail：小分映射客观/主观题型与作答，paperBrief 映射小结，均分映射统计', async () => {
    const { provider } = setup(standardRoutes([
      { match: '/detail', body: haitunSubjectDetailResponse },
      { match: '/small-scores', body: okEnvelope(smallScores) },
      { match: '/question-analysis', body: haitunQuestionAnalysisResponse },
    ]));
    const detail = await provider.getSubjectDetail!(freshSession(), '9001', '8101', cachedResult());
    expect(detail.subject).toBe('数学');
    expect(detail.score).toBe(120);
    expect(detail.maxScore).toBe(150);
    expect(detail.statistics).toEqual([
      { scope: '班级', averageScore: 105.5, rank: 4 },
      { scope: '年级', averageScore: 98.2, rank: 33 },
    ]);
    expect(detail.defeatRates).toEqual([{ scope: 'class', value: 70.1 }, { scope: 'grade', value: 62.3 }]);
    expect(detail.questionScoreSummaries).toEqual([
      { kind: 'objective', score: 60, maxScore: 70 },
      { kind: 'subjective', score: 60, maxScore: 80 },
    ]);
    expect(detail.reportSections).toEqual([{
      id: 'haitun-question-analysis', title: '逐题分析', items: [
        { label: '1.1 · 单选题', values: { '本人得分': '5 / 5', '年级均分': '4.58', '年级正确率': '91.55%' } },
        { label: '2.3.1 · 主观题', values: { '本人得分': '6 / 10', '年级均分': '7', '年级正确率': '60%' } },
      ],
    }]);
    expect(detail.questions).toHaveLength(4);
    expect(detail.questions?.[0]).toMatchObject({ id: '1.1', kind: 'objective', myAnswer: 'C', answer: 'C' });
    expect(detail.questions?.[1]).toMatchObject({ id: '1.2', kind: 'objective', myAnswer: 'A', answer: 'B' });
    expect(detail.questions?.[2]).toMatchObject({ id: '2.3.1', kind: 'subjective' });
    expect(detail.questions?.[2].myAnswer).toBeUndefined();
    expect(detail.questions?.[2].answer).toBeUndefined();
    expect(detail.questions?.[3]).toMatchObject({ id: '2.3.2' });
    expect(detail.questions?.[3].kind).toBeUndefined();
    expect(detail.questionNotice).toBeUndefined();
  });

  it('逐题分析按官方题号展示，乱序、合并科目和未匹配题目不会按小分下标误配', async () => {
    const row = haitunQuestionAnalysisResponse.data[0];
    const { provider } = setup(standardRoutes([
      { match: '/detail', body: haitunSubjectDetailResponse },
      { match: '/small-scores', body: okEnvelope(smallScores) },
      { match: '/question-analysis', body: okEnvelope([
        { ...row, tihao: '2.3.1', questionNo: '二.3.1' },
        { ...row, tihao: '语文-1.1', questionNo: '语文-一.1' },
        { ...row, tihao: '1.1', questionNo: '一.1' },
        { ...row, tihao: null, questionNo: '四.5' },
        { ...row, tihao: '', questionNo: null },
      ]) },
    ]));
    const detail = await provider.getSubjectDetail!(freshSession(), '9001', '8101', cachedResult());
    expect(detail.reportSections?.[0].items?.map(item => item.label)).toEqual([
      '2.3.1 · 单选题', '语文-1.1 · 单选题', '1.1 · 单选题', '四.5 · 单选题', '题号未提供 · 单选题',
    ]);
    expect(detail.questions?.map(item => item.id)).toEqual(smallScores.map(item => item.tihao));
  });

  it('小分缺失不阻断科目页，仅提示逐题数据不可用', async () => {
    const { provider } = setup(standardRoutes([
      { match: '/detail', body: okEnvelope(subjectDetail) },
      { match: '/small-scores', body: { errno: 500, errmsg: '虚构内部错误', data: null } },
      { match: '/question-analysis', body: { errno: 500, errmsg: '虚构内部错误', data: null } },
    ]));
    const detail = await provider.getSubjectDetail!(freshSession(), '9001', '8101', cachedResult());
    expect(detail.subject).toBe('数学');
    expect(detail.questions).toBeUndefined();
    expect(detail.questionNotice).toContain('逐题小分');
  });

  it('拆分卷（无逐题数据）：分段得分为 null 时不再报结构错误，只保留分数与统计', async () => {
    const splitDetail = {
      ...subjectDetail,
      paperBrief: [
        { questionNo: '客观题', tihao: null, score: null, fullScore: 58, questionType: '1' },
        { questionNo: '主观题', tihao: null, score: null, fullScore: 92, questionType: '2' },
      ],
    };
    const { provider } = setup(standardRoutes([
      { match: '/detail', body: okEnvelope(splitDetail) },
      { match: '/small-scores', body: okEnvelope([]) },
      { match: '/question-analysis', body: okEnvelope([]) },
    ]));
    const detail = await provider.getSubjectDetail!(freshSession(), '9001', '8101', cachedResult());
    expect(detail.subject).toBe('数学');
    expect(detail.score).toBe(120);
    expect(detail.maxScore).toBe(150);
    expect(detail.statistics).toEqual([
      { scope: '班级', averageScore: 105.5, rank: 4 },
      { scope: '年级', averageScore: 98.2, rank: 33 },
    ]);
    // 没有得分的分段小结不生成，避免展示 0 分之类的错误信息。
    expect(detail.questionScoreSummaries).toBeUndefined();
    expect(detail.questions).toEqual([]);
    expect(detail.questionNotice).toBe('本场考试未提供逐题数据。');
    expect(detail.reportSections).toBeUndefined();
  });

  it('小分接口出现会话失效时仍抛统一会话错误，不被兜底吞掉', async () => {
    const { provider } = setup(standardRoutes([
      { match: '/detail', body: okEnvelope(subjectDetail) },
      { match: '/small-scores', body: { errno: 401, errmsg: '登录已失效', data: null } },
    ]));
    await expect(provider.getSubjectDetail!(freshSession(), '9001', '8101', cachedResult())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('getAnswerSheets 返回免鉴权直链的无水印答题卡，平台自有域名升级为 https', async () => {
    const { provider, transport } = setup(standardRoutes([{ match: '/answer-sheet', body: okEnvelope(answerSheet) }]));
    const sheets = await provider.getAnswerSheets!(freshSession(), '9001', '8101', cachedResult());
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatchObject({ subject: '数学', subjectId: '8101', watermarked: false });
    // 平台下发 http，Android 网络策略禁止明文流量，Provider 统一升级为 https。
    expect(sheets.map((sheet) => sheet.url)).toEqual([
      'https://ossimage.haitunyuejuan.com/fake-000001.jpg',
      'https://ossimage.haitunyuejuan.com/fake-000002.jpg',
    ]);
    expect(sheets[0].headers).toBeUndefined();
    const [call] = transport.mock.calls as unknown as [[string, RequestInit]];
    expect(call[0]).toContain('/papers/8101/answer-sheet?studentBindingId=22&studentId=311');
  });

  it('答题卡直链只为平台自有域名升级 https，其他地址保持平台下发的原样', async () => {
    const mixed = {
      imgs: [
        'http://ossimage.haitunyuejuan.com/fake-000003.jpg',
        'https://ossimage.haitunyuejuan.com/fake-000004.jpg',
        'http://cdn.example.com/fake-000005.jpg',
        'data:image/jpeg;base64,ZmFrZQ==',
        'fake-000006.jpg',
      ],
    };
    const { provider } = setup(standardRoutes([{ match: '/answer-sheet', body: okEnvelope(mixed) }]));
    const sheets = await provider.getAnswerSheets!(freshSession(), '9001', '8101', cachedResult());
    expect(sheets.map((sheet) => sheet.url)).toEqual([
      'https://ossimage.haitunyuejuan.com/fake-000003.jpg',
      'https://ossimage.haitunyuejuan.com/fake-000004.jpg',
      'http://cdn.example.com/fake-000005.jpg',
      'data:image/jpeg;base64,ZmFrZQ==',
      'fake-000006.jpg',
    ]);
  });

  it('数据接口 errno 401 与 HTTP 401 都映射为会话过期', async () => {
    const { provider } = setup([{ match: '/students', body: { errno: 401, errmsg: '登录已失效', data: null } }]);
    await expect(provider.getProfile(freshSession())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const http = setup([{ match: '/students', status: 401, body: { errno: 401, errmsg: '登录已失效', data: null } }]);
    await expect(http.provider.getProfile(freshSession())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('非 2xx 的 HTTP 状态映射为可重试网络错误，不泄漏响应内容', async () => {
    const { provider } = setup([{ match: '/students', status: 502, body: 'BAD-GATEWAY-HTML' }]);
    const error = await provider.getProfile(freshSession()).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(JSON.stringify(error)).not.toContain('BAD-GATEWAY-HTML');
  });

  it('注销后的会话立即本地失效', async () => {
    const { provider } = setup(standardRoutes());
    const session = freshSession();
    await provider.logout(session);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('注册表中的海豚阅卷声明与能力真实', () => {
    const provider = providerRegistry.get('haitunyuejuan');
    expect(provider?.metadata.name).toBe('海豚阅卷');
    expect(provider?.metadata.officialDomain).toBe('https://student-api.haitunyuejuan.com');
    expect(provider?.capabilities).toMatchObject({ profile: true, exams: true, results: true, ranking: true, subjectDetails: true, questionScores: true, answerSheets: true });
  });
});
