import { createZhuxuebangProvider } from '@/src/providers/zhuxuebang';
import { providerRegistry } from '@/src/providers/registry';
import { bytesToBase64, utf8ToBytes } from '@/src/providers/codec';
import type { AuthSession, ExamResult, SubjectScore } from '@/src/domain/models';

const session: AuthSession = { providerId: 'zhuxuebang', accountId: 'fictional-login', accessToken: 'fictional-token', providerContext: { studentId: '11' } };
const student = { id: 11, stuName: '虚构学生', schName: '虚构学校', gradeName: '高二', gradeNo: 'G2', schNo: 'S1' };
const exam = { examNo: 1001, examPno: 0, examName: '虚构考试', stuNo: 'fictional-student-no', examTime: '2026-09-01', examType: '月考', isAllowQuery: true, isGetAnswerSheet: 1 };
const scores = { showScore: 1, scaleScore: 1, score: '210', rawScore: '200', stuSubScoreDtos: [
  { esubNo: 'SUB1', esubName: '数学', scaleScore: 0, score: '120', scale: '-' },
  { esubNo: 'SUB2', esubName: '化学赋分', scaleScore: 1, score: '80', giveScore: '90', scale: 'A', statType: 5, mergeSubInfo: { esubNo: 'ORIGINAL-SUB2' } },
] };
const ok = (datas: unknown) => ({ code: 200, datas });
function setup(bodies: unknown[], status = 200) {
  const transport = jest.fn(async () => ({ status, json: async () => bodies.shift() }) as Response);
  return { provider: createZhuxuebangProvider({ transport }), transport };
}
function requestAt(transport: ReturnType<typeof setup>['transport'], index: number) {
  const [url, init] = transport.mock.calls[index] as unknown as [string, RequestInit];
  return { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown>, init };
}

describe('助学帮基础查询（虚构数据，无网络）', () => {
  it('注册名称和选择界面备注，排名能力保持关闭', () => {
    const provider = providerRegistry.get('zhuxuebang');
    expect(provider?.metadata).toMatchObject({ name: '助学帮', remark: '五岳阅卷', officialDomain: 'https://stuquery.wylkyj.com' });
    expect(provider?.capabilities.ranking).toBe(false);
  });
  it('完成密码登录、选取学生和详情校验，无需转换查询 token', async () => {
    const { provider, transport } = setup([ok({ token: 'fictional-token' }), ok([{ ...student, stuNo: null }]), ok(student)]);
    await expect(provider.authenticate(' fictional-login ', 'fictional-password')).resolves.toEqual(session);
    expect(requestAt(transport, 0).body).toEqual({ mobile: 'fictional-login', password: 'fictional-password' });
    expect(requestAt(transport, 2).headers.get('stuId')).toBe('11');
    expect(requestAt(transport, 0).init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });
  it('无绑定学生或多学生无明确当前项时，不创建绑定或静默选取', async () => {
    for (const rows of [[], [student, { ...student, id: 12 }]]) {
      const { provider, transport } = setup([ok({ token: 'fictional-token' }), ok(rows)]);
      await expect(provider.authenticate('fictional-login', 'fictional-password')).rejects.toMatchObject({ code: 'RESTRICTED' });
      expect(transport).toHaveBeenCalledTimes(2);
    }
  });
  it('学生详情不匹配时拒绝使用另一学生的上下文', async () => {
    const { provider } = setup([ok({ ...student, id: 12 })]);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'RESTRICTED' });
  });
  it('将 offset 转为页码，不根据列表占位值误禁用考试，不虚构科目数', async () => {
    const { provider, transport } = setup([ok({ list: [{ ...exam, isAllowQuery: false }], pageIndex: 2, pageSize: 20, count: 21 })]);
    await expect(provider.getExamList(session, { offset: 20 })).resolves.toEqual([{ id: '1001', name: '虚构考试', date: '2026-09-01', category: '月考' }]);
    expect(requestAt(transport, 0).body).toEqual({ pageIndex: 2, pageSize: 20, stuId: 11 });
  });
  it('拒绝错误分页返回和负 offset', async () => {
    const { provider, transport } = setup([ok({ list: [], pageIndex: 1, pageSize: 20, count: 0 })]);
    await expect(provider.getExamList(session, { offset: -1 })).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(transport).not.toHaveBeenCalled();
    await expect(provider.getExamList(session, { offset: 20 })).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('兼容官方返回的零分页占位字段，到总数后结束加载', async () => {
    const page = ok({ list: [exam], pageIndex: 0, pageSize: 0, count: 1 });
    const { provider } = setup([page, page]);
    await expect(provider.getExamList(session)).resolves.toHaveLength(1);
    await expect(provider.getExamList(session, { offset: 1 })).resolves.toEqual([]);
  });
  it('考试日期不展示官方返回的零点时间', async () => {
    const { provider } = setup([ok({ list: [{ ...exam, examTime: '2026-09-01 00:00:00' }], pageIndex: 0, pageSize: 0, count: 1 })]);
    expect((await provider.getExamList(session))[0].date).toBe('2026-09-01');
  });
  it('合并分开的原分和赋分行，原科目作为入口并映射官方满分', async () => {
    const rows = [
      { esubNo: 'CHEMv', esubName: '化学(赋分)', scaleScore: 1, statType: 1, score: '90', giveScore: '90', subScore: '100', scale: 'A' },
      { esubNo: 'CHEM', esubName: '化学', scaleScore: 0, statType: 0, score: '80', subScore: '100' },
      { esubNo: 'BIOv', esubName: '生物（赋分）', scaleScore: 1, statType: 1, score: '85', giveScore: '85', subScore: '100' },
      { esubNo: 'BIO', esubName: '生物', scaleScore: 0, statType: 0, score: '75', subScore: '100' },
    ];
    const { provider, transport } = setup([ok(exam), ok({ ...scores, stuSubScoreDtos: rows }), ok(exam), ok(['https://data.wylkyj.com/AnswerSheet/fictional/a.png']), ok(exam), ok(student), ok(examToken()), ok({ isPassWord: false }), ok(questions)]);
    const merged = await provider.getExamResult(session, '1001');
    expect(merged.subjects).toEqual([
      { id: 'CHEM', subject: '化学', score: 90, maxScore: 100, grade: 'A', providerContext: { originalScore: '80', scaledScore: '90', scoreBasis: 'scaled' } },
      { id: 'BIO', subject: '生物', score: 85, maxScore: 100, grade: undefined, providerContext: { originalScore: '75', scaledScore: '85', scoreBasis: 'scaled' } },
    ]);
    await provider.getAnswerSheets!(session, '1001', 'CHEM', merged);
    expect(requestAt(transport, 3).body.esubNo).toBe('CHEM');
    const detail = await provider.getSubjectDetail!(session, '1001', 'CHEM', merged);
    expect(detail).toMatchObject({ subjectId: 'CHEM', subject: '化学', maxScore: 100 });
    expect(requestAt(transport, 8).body.esubNo).toBe('CHEM');
  });
  it('不合并缺少原分行或名称不匹配的赋分科目，缺失满分不转成零', async () => {
    const { provider } = setup([ok(exam), ok({ ...scores, stuSubScoreDtos: [
      { esubNo: 'CHEMv', esubName: '化学(赋分)', scaleScore: 1, statType: 1, score: '90', giveScore: '90' },
      { esubNo: 'CHEM', esubName: '其它科目', scaleScore: 0, subScore: '-1' },
    ] })]);
    const value = await provider.getExamResult(session, '1001');
    expect(value.subjects).toHaveLength(2);
    expect(value.subjects.every((item) => item.maxScore === undefined)).toBe(true);
    expect(value.subjects[0].providerContext?.originalScore).toBeUndefined();
    expect(value.subjects[0].providerContext?.scoreBasis).toBe('scaled');
  });
  it('先检查查询权限，并正确处理零项目号、原始分和赋分', async () => {
    const { provider, transport } = setup([ok(exam), ok(scores)]);
    const result = await provider.getExamResult(session, '1001');
    expect(result).toMatchObject({ examId: '1001', totalScore: 210, originalTotalScore: 200, subjects: [{ subject: '数学', score: 120 }, { subject: '化学赋分', score: 90, grade: 'A', providerContext: { originalScore: '80', scaledScore: '90', answerSheetSubjectId: 'ORIGINAL-SUB2' } }] });
    expect(result.maxTotalScore).toBeUndefined();
    expect(result.ranking).toBeUndefined();
    expect(requestAt(transport, 0).url).toContain('/exam/CheckExamState');
    expect(requestAt(transport, 1).headers.get('exam_pno')).toBe('');
    expect(requestAt(transport, 1).headers.get('exam_no')).toBe('1001');
    expect(requestAt(transport, 1).body).toEqual({ stuNo: exam.stuNo, source: 1 });
  });
  it('项目号非零时保留，关闭查询后不继续请求成绩', async () => {
    const { provider, transport } = setup([ok({ ...exam, examPno: 20 }), ok(scores)]);
    await provider.getExamResult(session, '1001');
    expect(requestAt(transport, 1).headers.get('exam_pno')).toBe('20');
    const blocked = setup([ok({ ...exam, isAllowQuery: false })]);
    await expect(blocked.provider.getExamResult(session, '1001')).rejects.toMatchObject({ code: 'RESTRICTED' });
    expect(blocked.transport).toHaveBeenCalledTimes(1);
  });
  it('隐藏分数和哨兵值不转成零分', async () => {
    const hidden = setup([ok(exam), ok({ ...scores, showScore: 0 })]);
    const result = await hidden.provider.getExamResult(session, '1001');
    expect(result.totalScore).toBeUndefined();
    expect(result.originalTotalScore).toBeUndefined();
    expect(result.subjects.every((s) => s.score === undefined)).toBe(true);
    const missing = setup([ok(exam), ok({ ...scores, score: '-', rawScore: '-1', stuSubScoreDtos: [{ ...scores.stuSubScoreDtos[0], score: '-1' }] })]);
    const missingResult = await missing.provider.getExamResult(session, '1001');
    expect(missingResult.totalScore).toBeUndefined();
    expect(missingResult.subjects[0].score).toBeUndefined();
  });
  it('按官方业务码分类失效，-1000 结合提示区分权益和参数错误', async () => {
    for (const code of [401, 101, 701, 702, 705]) {
      const { provider } = setup([{ code }]);
      await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    }
    for (const [message, code] of [['您当前套餐暂不支持解锁此功能', 'RESTRICTED'], ['项目信息获取失败', 'UNKNOWN']]) {
      const { provider } = setup([{ code: -1000, message }]);
      await expect(provider.getProfile(session)).rejects.toMatchObject({ code });
    }
  });
  it('错误密码和网络故障分别处理，不透出原始响应', async () => {
    const login = setup([{ code: -1000, message: '密码错误' }]);
    await expect(login.provider.authenticate('fictional-login', 'fictional-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const network = setup([], 503);
    await expect(network.provider.getProfile(session)).rejects.toMatchObject({ code: 'NETWORK' });
    const invalid = setup([ok({ secret: 'fictional-secret' })]);
    await expect(invalid.provider.getProfile(session)).rejects.toThrow('助学帮学生信息结构不符合预期');
  });
  it('拒绝跨 Provider 会话，不发送请求', async () => {
    const { provider, transport } = setup([]);
    await expect(provider.getProfile({ ...session, providerId: 'other' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('取消的请求保持取消语义', async () => {
    const { provider, transport } = setup([]);
    const controller = new AbortController(); controller.abort();
    await expect(provider.getProfile(session, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).not.toHaveBeenCalled();
  });
});

const result: ExamResult = { examId: '1001', examName: exam.examName, subjects: [{ id: 'SUB1', subject: '数学', score: 120 }] };
const questions = { onlineQues: [{ queName: '虚构题组', queScore: 15, queList: [
  { queNo: '1', queName: '单选1', queScore: 5, stuScore: 0, isObject: 1, stuAnswer: ['B'], queAnswer: ['A'] },
  { queNo: '2', queName: '多选2', queScore: 3, stuScore: 2, isObject: 1, stuAnswer: ['B', 'A'], queAnswer: ['A', 'B'] },
  { queNo: '3', queName: '解答3', queScore: 7, stuScore: -1, isObject: 0, stuAnswer: [], queAnswer: [] },
] }] };
function examToken(overrides: Record<string, unknown> = {}) {
  const claims = { ExamNo: '1001', SchNo: 'S1', GradeNo: 'G2', StuNo: exam.stuNo, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
  const payload = bytesToBase64(utf8ToBytes(JSON.stringify(claims))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `Bearer eyJhbGciOiJIUzUxMiJ9.${payload}.fictionalSignature`;
}

describe('助学帮答题卡和逐题明细（虚构数据，无网络）', () => {
  async function summaryDetail(subject: Partial<SubjectScore> = {}, content = questions) {
    const cached = { ...result, subjects: [{ ...result.subjects[0], score: 6, maxScore: 15, ...subject }] };
    const { provider } = setup([ok(exam), ok(student), ok(examToken()), ok({ isPassWord: false }), ok(content)]);
    return provider.getSubjectDetail!(session, '1001', 'SUB1', cached);
  }
  it('汇总小题而非题组，用原始分推算主观题得分，不填充主观题逐题得分', async () => {
    for (const subject of [{}, { score: 12, providerContext: { originalScore: '6', scaledScore: '12', scoreBasis: 'scaled' } }]) {
      const detail = await summaryDetail(subject);
      expect(detail.questionScoreSummaries).toEqual([
        { kind: 'objective', score: 2, maxScore: 8 },
        { kind: 'subjective', score: 4, maxScore: 7, inferred: true },
      ]);
      expect(detail.questions![0].children![2].score).toBeUndefined();
    }
  });
  it('保留主观题零分，不出现小数运算尾差', async () => {
    expect((await summaryDetail({ score: 2 })).questionScoreSummaries![1].score).toBe(0);
    const decimal = { onlineQues: [{ queName: '虚构小数题组', queScore: 1, queList: [
      { queNo: '1', queName: '客观1', queScore: 0.1, stuScore: 0.1, isObject: 1, stuAnswer: [], queAnswer: [] },
      { queNo: '2', queName: '客观2', queScore: 0.2, stuScore: 0.2, isObject: 1, stuAnswer: [], queAnswer: [] },
      { queNo: '3', queName: '主观3', queScore: 0.7, stuScore: -1, isObject: 0, stuAnswer: [], queAnswer: [] },
    ] }] };
    expect((await summaryDetail({ score: 0.6, maxScore: 1 }, decimal)).questionScoreSummaries).toEqual([
      { kind: 'objective', score: 0.3, maxScore: 0.3 },
      { kind: 'subjective', score: 0.3, maxScore: 0.7, inferred: true },
    ]);
  });
  it.each<Partial<SubjectScore>>([
    { score: undefined }, { maxScore: undefined }, { maxScore: 16 }, { score: 1 }, { score: 10 },
    { score: 20 }, { score: 12, providerContext: { scoreBasis: 'scaled' } },
    { score: 12, providerContext: { originalScore: '-1', scoreBasis: 'scaled' } },
  ])('原始分缺失、题目不完整或差值超出范围时不推算 %j', async (subject) => {
    expect((await summaryDetail(subject)).questionScoreSummaries).toBeUndefined();
  });
  it.each([-1, 6])('客观题得分缺失或超过满分时不推算 %s', async (stuScore) => {
    const content = { onlineQues: [{ ...questions.onlineQues[0], queList: questions.onlineQues[0].queList.map((item, i) => i === 0 ? { ...item, stuScore } : item) }] };
    expect((await summaryDetail({}, content)).questionScoreSummaries).toBeUndefined();
  });
  it('小题满分缺失时不推算', async () => {
    const content = { onlineQues: [{ ...questions.onlineQues[0], queList: questions.onlineQues[0].queList.map((item, i) => i === 0 ? { ...item, queScore: -1 } : item) }] };
    expect((await summaryDetail({}, content)).questionScoreSummaries).toBeUndefined();
  });
  it('答题卡发送当前考试上下文，只返回官方 HTTPS 无水印扫描图', async () => {
    const urls = ['https://data.wylkyj.com/AnswerSheet/fictional/a.png?signature=fake', 'https://data.wylkyj.com/AnswerSheet/fictional/b.png?signature=fake'];
    const { provider, transport } = setup([ok(exam), ok(urls)]);
    await expect(provider.getAnswerSheets!(session, '1001', 'SUB1', result)).resolves.toEqual(urls.map((url) => ({ subject: '数学', subjectId: 'SUB1', url, watermarked: false })));
    expect(requestAt(transport, 1).body).toEqual({ stuNo: exam.stuNo, esubNo: 'SUB1' });
    expect(requestAt(transport, 1).headers.get('exam_pno')).toBe('');
    expect(provider.getWatermarkedAnswerSheets).toBeUndefined();
  });
  it('赋分科目使用官方合并科目的答题卡标识', async () => {
    const merged: ExamResult = { ...result, subjects: [
      { id: 'ORIGINAL', subject: '化学' },
      { id: 'SCALED', subject: '化学赋分', providerContext: { answerSheetSubjectId: 'ORIGINAL' } },
    ] };
    const { provider, transport } = setup([ok(exam), ok(['https://data.wylkyj.com/AnswerSheet/fictional/a.png'])]);
    await provider.getAnswerSheets!(session, '1001', 'SCALED', merged);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(requestAt(transport, 1).body.esubNo).toBe('ORIGINAL');
  });
  it('未开放答题卡、不匹配的缓存或不存在的科目不能继续下载', async () => {
    const blocked = setup([ok({ ...exam, isGetAnswerSheet: 0 })]);
    await expect(blocked.provider.getAnswerSheets!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
    expect(blocked.transport).toHaveBeenCalledTimes(1);
    const mismatch = setup([ok(exam)]);
    await expect(mismatch.provider.getAnswerSheets!(session, '1001', 'SUB1', { ...result, examId: 'other' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const absent = setup([ok(exam)]);
    await expect(absent.provider.getAnswerSheets!(session, '1001', 'unknown', result)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each(['https://untrusted.invalid/AnswerSheet/a.png', 'http://data.wylkyj.com/AnswerSheet/a.png', 'https://data.wylkyj.com/not-a-sheet', 'https://data.wylkyj.com:444/AnswerSheet/a.png', 'https://user:password@data.wylkyj.com/AnswerSheet/a.png'])('拒绝非官方或异常图片地址 %s', async (url) => {
    const { provider } = setup([ok(exam), ok([url])]);
    await expect(provider.getAnswerSheets!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('换取考试 Token，保留零分、部分得分、作答，主观题 -1 不伪造成零', async () => {
    const token = examToken();
    const { provider, transport } = setup([ok(exam), ok(student), ok(token), ok({ isPassWord: false }), ok(questions)]);
    const detail = await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
    expect(detail).toMatchObject({ subjectId: 'SUB1', subject: '数学', score: 120, questions: [{ label: '虚构题组', maxScore: 15, children: [
      { label: '单选1', maxScore: 5, score: 0, kind: 'objective', myAnswer: 'B', answer: 'A' },
      { label: '多选2', maxScore: 3, score: 2, kind: 'objective', myAnswer: 'AB', answer: 'AB' },
      { label: '解答3', maxScore: 7, kind: 'subjective' },
    ] }] });
    expect(detail.questions![0].children![2].score).toBeUndefined();
    expect(requestAt(transport, 2).body).toEqual({ examNo: '1001', stuNo: exam.stuNo, gradeNo: 'G2', schNo: 'S1', platform: 0, deviceId: 'MagicMirror' });
    expect(requestAt(transport, 2).headers.get('token')).toBeNull();
    expect(requestAt(transport, 4).headers.get('token')).toBe(token);
    expect(requestAt(transport, 4).headers.get('Authorization')).toBeNull();
    expect(requestAt(transport, 4).url).toBe('https://onlinexam.wylkyj.com/api/v1/subject/GetSubQueList');
  });
  it('同一会话同一考试复用 Token，切换查询会话时重新换取', async () => {
    const token = examToken();
    const { provider, transport } = setup([ok(exam), ok(student), ok(token), ok({ isPassWord: false }), ok(questions), ok(exam), ok(questions), ok(exam), ok(student), ok(token), ok({ isPassWord: false }), ok(questions)]);
    await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
    await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
    await provider.getSubjectDetail!({ ...session, accessToken: 'another-fictional-token' }, '1001', 'SUB1', result);
    const paths = transport.mock.calls.map((_, index) => requestAt(transport, index).url);
    expect(paths.filter((path) => path.endsWith('/StuLogin'))).toHaveLength(2);
    expect(paths.filter((path) => path.endsWith('/GetSubQueList'))).toHaveLength(3);
  });
  it('JWT 的学生、学校、年级、考试归属不匹配时拒绝访问', async () => {
    for (const field of ['ExamNo', 'StuNo', 'SchNo', 'GradeNo']) {
      const { provider, transport } = setup([ok(exam), ok(student), ok(examToken({ [field]: 'other' }))]);
      await expect(provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
      expect(transport).toHaveBeenCalledTimes(3);
    }
  });
  it('切换考试或学生时不复用另一上下文的考试 Token', async () => {
    const secondExam = { ...exam, examNo: 1002 };
    const secondResult = { ...result, examId: '1002' };
    const { provider, transport } = setup([
      ok(exam), ok(student), ok(examToken()), ok({ isPassWord: false }), ok(questions),
      ok(secondExam), ok(student), ok(examToken({ ExamNo: '1002' })), ok({ isPassWord: false }), ok(questions),
      ok(exam), ok({ ...student, id: 12 }), ok(examToken()), ok({ isPassWord: false }), ok(questions),
    ]);
    await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
    await provider.getSubjectDetail!(session, '1002', 'SUB1', secondResult);
    await provider.getSubjectDetail!({ ...session, providerContext: { studentId: '12' } }, '1001', 'SUB1', result);
    expect(transport.mock.calls.map((_, i) => requestAt(transport, i).url).filter((url) => url.endsWith('/StuLogin'))).toHaveLength(3);
  });
  it('内存 JWT 过期后重新换取，过期 Token 不进入题目请求', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const firstToken = examToken({ exp: Math.floor(now / 1000) + 60 });
      const nextToken = examToken({ exp: Math.floor(now / 1000) + 3600 });
      const { provider, transport } = setup([ok(exam), ok(student), ok(firstToken), ok({ isPassWord: false }), ok(questions), ok(exam), ok(student), ok(nextToken), ok({ isPassWord: false }), ok(questions)]);
      await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
      clock.mockReturnValue(now + 90_000);
      await provider.getSubjectDetail!(session, '1001', 'SUB1', result);
      expect(requestAt(transport, 9).headers.get('token')).toBe(nextToken);
      expect(transport).toHaveBeenCalledTimes(10);
    } finally { clock.mockRestore(); }
  });
  it('新考试会话登录或校验被拒绝时，不重登成绩查询账号', async () => {
    for (const bodies of [
      [ok(exam), ok(student), { code: 401 }],
      [ok(exam), ok(student), ok(examToken()), { code: 401 }],
    ]) {
      const { provider, transport } = setup(bodies);
      await expect(provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
      expect(transport.mock.calls.some((_, i) => requestAt(transport, i).url.endsWith('/LoginByPassword'))).toBe(false);
    }
  });
  it('过期 JWT 或需要考试密码时停止，不调用密码校验或题目接口', async () => {
    const expired = setup([ok(exam), ok(student), ok(examToken({ exp: 1 }))]);
    await expect(expired.provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
    const protectedExam = setup([ok(exam), ok(student), ok(examToken()), ok({ isPassWord: true })]);
    await expect(protectedExam.provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
    expect(protectedExam.transport).toHaveBeenCalledTimes(4);
  });
  it('考试 Token 返回 401 时仅重换一次，不将查询会话标记过期', async () => {
    const { provider, transport } = setup([ok(exam), ok(student), ok(examToken()), ok({ isPassWord: false }), { code: 401 }, ok(student), ok(examToken()), ok({ isPassWord: false }), { code: 401 }]);
    await expect(provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
    expect(transport).toHaveBeenCalledTimes(9);
    expect(session.accessToken).toBe('fictional-token');
  });
  it('付费限制不尝试刷新 Token，也不影响普通成绩查询', async () => {
    const { provider, transport } = setup([ok(exam), ok(student), ok(examToken()), ok({ isPassWord: false }), { code: -1000, message: '您当前套餐暂不支持解锁此功能' }, ok(exam), ok(scores)]);
    await expect(provider.getSubjectDetail!(session, '1001', 'SUB1', result)).rejects.toMatchObject({ code: 'RESTRICTED' });
    await expect(provider.getExamResult(session, '1001')).resolves.toMatchObject({ totalScore: 210 });
    expect(transport).toHaveBeenCalledTimes(7);
  });
  it('注销仅撤销本地会话，不发送官方注销或写操作', async () => {
    const { provider, transport } = setup([]);
    await provider.logout(session);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(transport).not.toHaveBeenCalled();
  });
});
