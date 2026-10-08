import { createHaofenshuProvider, rankFromDisplay } from '@/src/providers/haofenshu';
import type { AuthSession } from '@/src/domain/models';

const session: AuthSession = { providerId: 'haofenshu-parent', accountId: 'fictional', accessToken: 'TEST_TOKEN' };
function setup(bodies: unknown[], status = 200, roleType: 1 | 2 = 2) {
  const transport = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/v2/config/school/hidden-config')) return { status, json: async () => ({ code: 0, data: {} }) } as Response;
    return { status, json: async () => bodies.shift() } as Response;
  });
  return { provider: createHaofenshuProvider(roleType, transport), transport };
}
const result = { examId: 456, name: '虚构考试', scoreS: '300', manfen: 450, classRank: -1,
  classRankS: '1~20/42人', classStuNum: 42, gradeRankS: '250~300/575人', gradeStuNum: 575, groupRankS: '250~300', groupStuNum: 575,
  papers: [{ subject: '语文', scoreS: '100', manfen: 150 }] };

describe('Haofenshu Provider (no network)', () => {
  beforeEach(() => { session.providerContext = undefined; });
  const overviewWithPid = { ...result, papers: [{ paperId: 'p1', pid: 'fictional-pid', subject: '数学', scoreS: '90', manfen: 150 }] };
  const rankedArchives = { list: [{ examId: 456, name: '虚构考试', gradeRank: '260~280' }], papers: [
    { subject: '数学', list: [{ id: 'fictional-pid', classRank: '1~10', classStuNum: 42 }] },
    { subject: '数学', list: [{ id: 'fictional-other-pid', examId: 789, classRank: '20~30' }] },
  ] };
  it('fetches archives with grade= on a cold result cache and matches ranks by pid without examId', async () => {
    const { provider, transport } = setup([{ code: 0, data: overviewWithPid }, { code: 0, data: rankedArchives }]);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.subjects[0].providerContext).toMatchObject({ classRank: '1~10', classCount: '42' });
    expect(mapped.rankings).toContainEqual({ scope: 'grade', rank: 260, rankMax: 280, total: 575 });
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://hfs-be.yunxiao.com/v4/exam/overview?examId=456', 'https://hfs-be.yunxiao.com/v2/config/school/hidden-config', 'https://hfs-be.yunxiao.com/v4/exam/archives?grade=',
    ]);
  });
  it('normalizes the official v4 overview score and rank strings', async () => {
    const { provider } = setup([
      { code: 0, data: { examId: 456, name: '虚构考试', score: '300', manfen: 450, classRank: 'A', gradeRank: 'B', classAvg: 260, gradeAvg: 240, classStuNum: 42, gradeStuNum: 575,
        papers: [{ paperId: 'p1', pid: 'fictional-pid', subject: '数学', score: '100', manfen: 150 }] } },
      { code: 0, data: { list: [{ examId: 456, name: '虚构考试' }], papers: [] } },
    ]);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.totalScore).toBe(300);
    expect(mapped.subjects[0].score).toBe(100);
    expect(mapped.statistics).toEqual(expect.arrayContaining([{ scope: '班级', averageScore: 260, participantCount: 42 }, { scope: '年级', averageScore: 240, participantCount: 575 }]));
    expect(mapped.rankings).toEqual([
      { scope: 'class', rank: 1, rankMax: 6, total: 42 },
      { scope: 'grade', rank: 87, rankMax: 287, total: 575 },
    ]);
  });
  it.each([false, true])('refreshes expired archives and preserves stale ranks if refresh fails: %s', async (fails) => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const { provider, transport } = setup([
        { code: 0, data: rankedArchives }, { code: 0, data: overviewWithPid },
        { code: 0, data: overviewWithPid },
        fails ? { code: 2001, data: null } : { code: 0, data: { ...rankedArchives, papers: [
          { list: [{ id: 'fictional-pid', examId: 456, classRank: '11~20', classStuNum: 42 }] },
        ] } },
      ]);
      await provider.getExamList(session);
      await provider.getExamResult(session, '456');
      expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2);
      clock.mockReturnValue(1_000_000 + 15 * 60_000 + 1);
      const mapped = await provider.getExamResult(session, '456');
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(mapped.subjects[0].providerContext?.classRank).toBe(fails ? '1~10' : '11~20');
    } finally { clock.mockRestore(); }
  });
  it.each(['offline', 'restricted'] as const)('keeps overview usable without cached archives when %s', async (failure) => {
    const transport = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/overview')) return { status: 200, json: async () => ({ code: 0, data: overviewWithPid }) } as Response;
      if (failure === 'offline') throw new Error('fictional network failure');
      return { status: 403 } as Response;
    });
    const provider = createHaofenshuProvider(2, transport);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.totalScore).toBe(300);
    expect(mapped.subjects[0].providerContext).not.toHaveProperty('classRank');
    expect(mapped.rankings).toContainEqual({ scope: 'grade', rank: 250, rankMax: 300, total: 575 });
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('validates token login against the official profile before accepting it', async () => {
    const { provider, transport } = setup([{ code: 0, data: { linkedStudent: { studentId: '123', studentName: '虚构学生' } } }]);
    await expect(provider.authenticateWithToken!(' TEST_TOKEN ')).resolves.toMatchObject({ accountId: '123', accessToken: 'TEST_TOKEN' });
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain('/v2/user-center/user-snapshot');
    // H5 形态会话：Cookie 与 hfs-token 同时携带，不再有原生客户端的 deviceType/appType/versionName 头。
    expect(calls[0][1].headers).toMatchObject({ Cookie: 'hfs-session-id=TEST_TOKEN', 'hfs-token': 'TEST_TOKEN' });
    expect(calls[0][1].headers).not.toHaveProperty('deviceType');
  });
  it.each([3001, 3006])('rejects expired token code %s during login', async (code) => {
    const { provider } = setup([{ code, data: null }]);
    await expect(provider.authenticateWithToken!('TEST_TOKEN')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('rejects malformed tokens without sending a request', async () => {
    const { provider, transport } = setup([]);
    await expect(provider.authenticateWithToken!('bad\r\ntoken')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([1, 2] as const)('runs the login/profile/archives/result/logout chain for role %s', async (roleType) => {
    const { provider, transport } = setup([
      { code: 0, data: { token: 'TEST_TOKEN' } },
      { code: 0, data: { linkedStudent: { studentId: '123', studentName: '虚构学生', schoolName: '虚构学校' } } },
      { code: 0, data: { list: [
        { examId: 456, name: '虚构考试', type: '月考', eventTime: 1782057600000, paperCount: 1, score: '300', manfen: 450, classRank: 'B', gradeRank: 'C', classStuNum: 41, gradeStuNum: 639 },
        { examId: 789, name: '较新考试', eventTime: 1784131200000 },
      ] } },
      { code: 0, data: result },
    ], 200, roleType);
    const auth = await provider.authenticate('fictional', 'fictional-password');
    expect(auth.providerId).toBe(provider.metadata.id);
    expect(auth.expiresAt).toBeUndefined();
    expect(await provider.getProfile(auth)).toEqual({ id: '123', displayName: '虚构学生', schoolName: '虚构学校', grade: undefined });
    // 档案按时间正序返回，列表改为新考试在前。
    expect(await provider.getExamList(auth)).toEqual([
      { id: '789', name: '较新考试', date: '2026-07-16' },
      { id: '456', name: '虚构考试', date: '2026-06-22', category: '月考', subjectCount: 1 },
    ]);
    expect(await provider.getExamResult(auth, '456')).toMatchObject({ totalScore: 300, subjects: [{ score: 100 }] });
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const versionName = roleType === 1 ? '4.31.81' : '3.32.81';
    // 登录与后续请求统一走官方 H5 形态：明文密码、无 deviceType/loginType，浏览器 UA 尾缀 HFS_XS/HFS_JZ。
    expect(calls[0][1].redirect).toBe('error');
    expect(calls[0][1].headers).toMatchObject({ 'Content-Type': 'application/json', 'User-Agent': expect.stringContaining(`${roleType === 1 ? 'HFS_XS' : 'HFS_JZ'}version=${versionName}`) });
    expect(calls[0][1].headers).not.toHaveProperty('deviceType');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ loginName: 'fictional', password: 'fictional-password', roleType, rememberMe: 1 });
    expect(calls[1][1].headers).toMatchObject({ Cookie: 'hfs-session-id=TEST_TOKEN', 'hfs-token': 'TEST_TOKEN', Origin: 'https://mobile.haofenshu.com' });
    // 考试档案同属 H5 形态：hfs-token 与浏览器指纹成套出现，不再单独拼接 sy_token / X-Requested-With。
    expect(calls[2][0]).toBe('https://hfs-be.yunxiao.com/v2/config/school/hidden-config');
    expect(calls[2][1].headers).toMatchObject({
      Cookie: 'hfs-session-id=TEST_TOKEN', 'hfs-token': 'TEST_TOKEN', Accept: '*/*',
      'Cache-Control': 'no-cache', Pragma: 'no-cache',
      Origin: 'https://mobile.haofenshu.com', Referer: 'https://mobile.haofenshu.com/',
      'User-Agent': expect.stringContaining(`${roleType === 1 ? 'HFS_XS' : 'HFS_JZ'}version=${versionName}`),
    });
    expect(calls[2][1].headers).not.toHaveProperty('X-Requested-With');
    expect(calls[3][0]).toBe('https://hfs-be.yunxiao.com/v4/exam/archives?grade=');
    expect(calls[3][1].headers).toMatchObject({ Cookie: 'hfs-session-id=TEST_TOKEN', 'hfs-token': 'TEST_TOKEN' });
    expect(calls[3][1].headers).not.toHaveProperty('X-Requested-With');
    // 翻页命中内存缓存，不再发请求。
    expect(await provider.getExamList(auth, { offset: 2 })).toEqual([]);
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(4);
    await provider.logout(auth);
    await expect(provider.getProfile(auth)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it.each([3001, 3002, 3006, 4006, 4048, 2001, 10, 11])('sanitizes business code %s', async (code) => {
    const { provider } = setup([{ code, msg: 'TEST_SECRET_MUST_NOT_ESCAPE', data: null }]);
    try { await provider.getProfile(session); throw new Error('expected failure'); }
    catch (error) { expect(String(error)).not.toContain('TEST_SECRET'); expect(error).toHaveProperty('name', 'ProviderError'); }
  });
  it('maps the official invalid-credentials code 4046', async () => {
    const { provider } = setup([{ code: 4046, msg: '账号或密码错误', data: null }]);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it.each([403, 429, 451])('does not retry HTTP %s', async (status) => {
    const { provider, transport } = setup([], status);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'UNSUPPORTED', retryable: false });
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it('only treats risk messages as restricted, not a plain empty archive response', async () => {
    const { provider } = setup([{ code: 1, data: null }, { code: 1, data: null }]);
    expect(await provider.getExamList(session)).toEqual([]);
    await expect(provider.getProfile(session)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('treats the risk-control lock as a non-retryable access restriction', async () => {
    const { provider, transport } = setup([{ code: 1, msg: '账号存在风险，已被锁定', data: null }, { code: 0, data: {} }]);
    await expect(provider.getExamList(session)).rejects.toMatchObject({ code: 'RESTRICTED', retryable: false });
    expect((transport.mock.calls as unknown as [string, RequestInit][]).map(([url]) => url)).toEqual([
      'https://hfs-be.yunxiao.com/v2/config/school/hidden-config',
      'https://hfs-be.yunxiao.com/v4/exam/archives?grade=',
    ]);
  });
  it.each([-1, 1.5, Number.NaN])('rejects invalid exam offsets: %s', async (offset) => {
    const { provider, transport } = setup([]);
    await expect(provider.getExamList(session, { offset })).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves unknown scores and derives rankings only from official display strings', async () => {
    const { provider } = setup([{ code: 0, data: { ...result, scoreS: '**', papers: [{ subject: '英语', scoreS: '缺考', score: 0, manfen: 150 }] } }]);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.totalScore).toBeUndefined();
    expect(mapped.subjects[0].score).toBeUndefined();
    // gradeStuNum == groupStuNum：视为校内考试，联考维度整体隐藏。
    expect(mapped.statistics).toEqual([
      { scope: '班级', participantCount: 42 },
      { scope: '年级', participantCount: 575 },
    ]);
    expect(mapped.rankings).toEqual([
      { scope: 'class', rank: 1, rankMax: 20, total: 42 },
      { scope: 'grade', rank: 250, rankMax: 300, total: 575 },
    ]);
    expect(provider.capabilities.ranking).toBe(true);
  });
  it('keeps the group scope when the group count differs from the grade count', async () => {
    const { provider } = setup([{ code: 0, data: { ...result, gradeStuNum: 575, groupStuNum: 980, groupRankS: '800~900/980人' } }]);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.statistics).toEqual([
      { scope: '班级', participantCount: 42 },
      { scope: '年级', participantCount: 575 },
      { scope: '总排名', participantCount: 980 },
    ]);
    expect(mapped.rankings).toEqual([
      { scope: 'class', rank: 1, rankMax: 20, total: 42 },
      { scope: 'grade', rank: 250, rankMax: 300, total: 575 },
      { scope: 'group', rank: 800, rankMax: 900, total: 980 },
    ]);
  });
  it('omits masked rank scopes and converts letter bands with the participant count', async () => {
    const { provider } = setup([{ code: 0, data: { examId: 456, name: '虚构月考', scoreS: '300', manfen: 450,
      classRankS: 'B', gradeRankS: '**', groupRankS: '**', classStuNum: 41, gradeStuNum: 639, groupStuNum: 639,
      papers: [{ subject: '语文', scoreS: '100', manfen: 150 }] } }]);
    const mapped = await provider.getExamResult(session, '456');
    expect(mapped.rankings).toEqual([{ scope: 'class', rank: 7, rankMax: 20, total: 41 }]);
  });
  it('prefers the finer archives rank strings and falls back to overview rankS without them', async () => {
    const { provider } = setup([
      { code: 0, data: { list: [
        { examId: 456, name: '虚构期末', classRank: '1~20', gradeRank: '260~280', classStuNum: 42, gradeStuNum: 575 },
        { examId: 789, name: '虚构月考', classRank: 'B', gradeRank: '**', classStuNum: 41, gradeStuNum: 639 },
      ] } },
      { code: 0, data: { examId: 456, name: '虚构期末', scoreS: '300', manfen: 450, gradeStuNum: 575, groupStuNum: 575, papers: [] } },
      { code: 0, data: { examId: 789, name: '虚构月考', scoreS: '300', manfen: 450, classRankS: 'A', gradeRankS: '**', classStuNum: 41, gradeStuNum: 639, papers: [] } },
    ]);
    await provider.getExamList(session);
    const finale = await provider.getExamResult(session, '456');
    // 档案展示串比 overview 更精细（260~280 而非 250~300）；年级=联考人数视为校内考试。
    expect(finale.rankings).toEqual([
      { scope: 'class', rank: 1, rankMax: 20, total: 42 },
      { scope: 'grade', rank: 260, rankMax: 280, total: 575 },
    ]);
    const monthly = await provider.getExamResult(session, '789');
    // 档案优先级高于 overview：classRank 用档案的 B（7~20），gradeRank 档案与 overview 均为 ** → 隐藏。
    expect(monthly.rankings).toEqual([{ scope: 'class', rank: 7, rankMax: 20, total: 41 }]);
  });
  it('keeps masked scopes hidden when no archives entry exists', async () => {
    const { provider } = setup([{ code: 0, data: { examId: 789, name: '虚构月考', scoreS: '300', manfen: 450, gradeRankS: '**', gradeStuNum: 639, papers: [] } }]);
    const mapped = await provider.getExamResult(session, '789');
    expect(mapped.rankings).toBeUndefined();
  });
  it('attaches per-subject rank ranges from the archives to subject contexts', async () => {
    const { provider } = setup([
      { code: 0, data: { list: [{ examId: 456, name: '虚构期末', gradeStuNum: 575 }], papers: [
        { subject: '数学', list: [{ id: '10370933-29321', examId: 456, classRank: '1~20', gradeRank: '150~200', classStuNum: 42, gradeStuNum: 572 }] },
        { subject: '英语', list: [{ id: '10370934-29321', examId: 456, classRank: '**', gradeRank: '500~550', gradeStuNum: 514 }] },
      ] } },
      { code: 0, data: { examId: 456, name: '虚构期末', scoreS: '300', manfen: 750, gradeStuNum: 575, groupStuNum: 575, papers: [
        { paperId: 'p1', pid: '10370933-29321', subject: '数学', scoreS: '94', manfen: 150 },
        { paperId: 'p2', pid: '10370934-29321', subject: '英语', scoreS: '28', manfen: 150 },
        { paperId: 'p3', subject: '政治', scoreS: '70', manfen: 100 },
      ] } },
    ]);
    await provider.getExamList(session);
    const mapped = await provider.getExamResult(session, '456');
    // 单科排名与人数同源（档案按科人数 572，而非考试总人数 575）。
    expect(mapped.subjects[0].providerContext).toEqual({ pid: '10370933-29321', classStuNum: '42', gradeStuNum: '572', classRank: '1~20', classCount: '42', gradeRank: '150~200', gradeCount: '572' });
    // 屏蔽（**）的单科班级排名不进入上下文。
    // 屏蔽（**）的单科班级排名不进入上下文；按科人数（514）优先于考试总人数（575）。
    expect(mapped.subjects[1].providerContext).toEqual({ pid: '10370934-29321', gradeStuNum: '514', gradeRank: '500~550', gradeCount: '514' });
    expect(mapped.subjects[2].providerContext).toBeUndefined();
  });
  it('isolates the archives cache per session so two accounts never swap data', async () => {
    const sessionB: AuthSession = { providerId: 'haofenshu-parent', accountId: 'another', accessToken: 'TEST_TOKEN_B' };
    const { provider, transport } = setup([
      { code: 0, data: { list: [{ examId: 1, name: '甲的考试' }] } },
      { code: 0, data: { list: [{ examId: 2, name: '乙的考试' }] } },
    ]);
    expect(await provider.getExamList(session)).toEqual([{ id: '1', name: '甲的考试' }]);
    expect(await provider.getExamList(sessionB)).toEqual([{ id: '2', name: '乙的考试' }]);
    expect(await provider.getExamList(session)).toEqual([{ id: '1', name: '甲的考试' }]);
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('classifies questions by type and keeps objective answers', async () => {
    const { provider } = setup([
      { code: 0, data: { name: '虚构考试', papers: [{ paperId: 'paper-1', subject: '语文', score: 1, manfen: 1 }] } },
      { code: 0, data: { examId: 456, name: '虚构考试', score: 1, manfen: 1, papers: [{ paperId: 'paper-1', pid: 'parent-1', subject: '语文', score: 1, manfen: 1 }] } },
      { code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional.png'], questions: [
        { id: 'question-1', name: '一.1', score: 0, manfen: 4, type: 2, myAnswer: 'A', answer: 'B' },
        { id: 'question-2', name: '一.5', score: 3, manfen: 6, type: 2, myAnswer: 'B', answer: 'BC' },
        { id: 'question-3', name: '总分一', score: 7.5, manfen: 9, type: 1 },
      ] } },
    ]);
    const detail = await provider.getSubjectDetail!(session, '456', 'paper-1');
    expect(detail.questions).toEqual([
      { id: 'question-1', label: '一.1', score: 0, maxScore: 4, kind: 'objective', myAnswer: 'A', answer: 'B' },
      { id: 'question-2', label: '一.5', score: 3, maxScore: 6, kind: 'objective', myAnswer: 'B', answer: 'BC' },
      { id: 'question-3', label: '总分一', score: 7.5, maxScore: 9, kind: 'subjective' },
    ]);
  });
  it.each([1, 2] as const)('summarizes complete question scores for role %s without extra requests', async (roleType) => {
    const { provider, transport } = setup([{ code: 0, data: { questions: [
      { id: 'q1', score: '0', manfen: '4', type: 2 },
      { id: 'q2', score: '3', manfen: '6', type: 2 },
      { id: 'q3', score: '7.5', manfen: '9', type: 1 },
    ] } }], 200, roleType);
    const detail = await provider.getSubjectDetail!({ ...session, providerId: roleType === 1 ? 'haofenshu-student' : 'haofenshu-parent' }, '456', 'p1', {
      examId: '456', examName: '虚构考试', subjects: [{ id: 'p1', subject: '数学', score: 10.5, maxScore: 19, providerContext: { pid: 'fictional-pid' } }],
    });
    expect(detail.questionScoreSummaries).toEqual([
      { kind: 'objective', score: 3, maxScore: 10 }, { kind: 'subjective', score: 7.5, maxScore: 9 },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('keeps zero scores and removes floating point tails', async () => {
    const { provider } = setup([{ code: 0, data: { questions: [
      { id: 'q1', score: 0.1, manfen: 0.1, type: 2 },
      { id: 'q2', score: 0.2, manfen: 0.2, type: 2 },
      { id: 'q3', score: 0, manfen: 0.7, type: 1 },
    ] } }]);
    const detail = await provider.getSubjectDetail!(session, '456', 'p1', {
      examId: '456', examName: '虚构考试', subjects: [{ id: 'p1', subject: '数学', score: 0.3, maxScore: 1, providerContext: { pid: 'fictional-pid' } }],
    });
    expect(detail.questionScoreSummaries).toEqual([
      { kind: 'objective', score: 0.3, maxScore: 0.3 }, { kind: 'subjective', score: 0, maxScore: 0.7 },
    ]);
  });
  it.each([
    ['缺失得分', [{ id: 'q1', manfen: 10, type: 2 }]],
    ['缺失满分', [{ id: 'q1', score: 5, type: 2 }]],
    ['未知分类', [{ id: 'q1', score: 5, manfen: 10, type: 9 }]],
    ['缺失分类', [{ id: 'q1', score: 5, manfen: 10 }]],
    ['负分哨兵', [{ id: 'q1', score: -1, manfen: 10, type: 1 }]],
    ['超出满分', [{ id: 'q1', score: 11, manfen: 10, type: 1 }]],
    ['部分题目', [{ id: 'q1', score: 5, manfen: 6, type: 2 }]],
    ['分数口径不同', [{ id: 'q1', score: 4, manfen: 10, type: 1 }]],
    ['重复题号', [{ id: 'q1', score: 2, manfen: 4, type: 2 }, { id: 'q1', score: 3, manfen: 6, type: 1 }]],
    ['空题目', []],
  ])('omits summaries for %s while retaining question details', async (_label, questions) => {
    const { provider } = setup([{ code: 0, data: { questions } }]);
    const detail = await provider.getSubjectDetail!(session, '456', 'p1', {
      examId: '456', examName: '虚构考试', subjects: [{ id: 'p1', subject: '数学', score: 5, maxScore: 10, providerContext: { pid: 'fictional-pid' } }],
    });
    expect(detail.questionScoreSummaries).toBeUndefined();
    expect(detail.questions).toHaveLength(questions.length);
  });
  it('does not invent an absent question kind', async () => {
    const { provider } = setup([{ code: 0, data: { questions: [{ id: 'q1', score: 5, manfen: 10, type: 1 }] } }]);
    const detail = await provider.getSubjectDetail!(session, '456', 'p1', {
      examId: '456', examName: '虚构考试', subjects: [{ id: 'p1', subject: '数学', score: 5, maxScore: 10, providerContext: { pid: 'fictional-pid' } }],
    });
    expect(detail.questionScoreSummaries).toEqual([{ kind: 'subjective', score: 5, maxScore: 10 }]);
  });
  it('parses official rank display strings', () => {
    expect(rankFromDisplay('1~20/42人', undefined)).toEqual({ rank: 1, rankMax: 20, total: 42 });
    expect(rankFromDisplay('250～300', 575)).toEqual({ rank: 250, rankMax: 300, total: 575 });
    expect(rankFromDisplay('A', 42)).toEqual({ rank: 1, rankMax: 6, total: 42 });
    expect(rankFromDisplay('B', 41)).toEqual({ rank: 7, rankMax: 20, total: 41 });
    expect(rankFromDisplay('C', 575)).toEqual({ rank: 288, rankMax: 483, total: 575 });
    expect(rankFromDisplay('D', 42)).toEqual({ rank: 36, rankMax: 41, total: 42 });
    expect(rankFromDisplay('E', 42)).toEqual({ rank: 42, rankMax: 42, total: 42 });
    expect(rankFromDisplay('3/40人', undefined)).toEqual({ rank: 3, total: 40 });
    expect(rankFromDisplay('3', 40)).toEqual({ rank: 3, total: 40 });
    expect(rankFromDisplay('**', 41)).toBeUndefined();
    expect(rankFromDisplay('A', undefined)).toBeUndefined();
    expect(rankFromDisplay('5~2', 40)).toBeUndefined();
    expect(rankFromDisplay('1~20/x人', 40)).toBeUndefined();
    expect(rankFromDisplay(undefined, 40)).toBeUndefined();
  });
  it('rejects mismatched exam IDs and unsafe numeric IDs', async () => {
    const { provider } = setup([{ code: 0, data: result }, { code: 0, data: { list: [{ examId: Number.MAX_SAFE_INTEGER + 1, name: '虚构' }] } }]);
    await expect(provider.getExamResult(session, '789')).rejects.toMatchObject({ code: 'UNKNOWN' });
    await expect(provider.getExamList(session)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('rejects wrong-provider sessions before sending credentials', async () => {
    const { provider, transport } = setup([]);
    await expect(provider.getProfile({ ...session, providerId: 'bfzks' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('stops on required password changes', async () => {
    const { provider, transport } = setup([{ code: 0, data: { token: 'TEST', needUpdatePassword: true } }]);
    await expect(provider.authenticate('fictional', 'fictional')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it('maps the verified answer-picture response to answer sheets and questions', async () => {
    const { provider, transport } = setup([
      { code: 0, data: { examId: 456, name: '虚构考试', score: 1, manfen: 1, papers: [{ paperId: 'paper-1', pid: 'parent-1', subject: '语文', score: 1, manfen: 1 }] } },
      { code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional.png'], questions: [{ id: 'question-1', name: '一.1', score: 3, manfen: 3 }] } },
    ]);
    expect(provider.getAnswerSheets).toBeDefined();
    expect(await provider.getAnswerSheets!(session, '456', 'paper-1')).toEqual([{ subject: '语文', subjectId: 'paper-1', url: 'https://yj-oss.yunxiao.com/fictional.png', watermarked: false }]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1][0]).toContain('/papers/paper-1/answer-picture?pid=parent-1');
  });
  it('requests a fresh URL again after an answer-card URL expires', async () => {
    const { provider, transport } = setup([
      { code: 0, data: { examId: 456, name: '虚构考试', score: 1, manfen: 1, papers: [{ paperId: 'paper-1', pid: 'parent-1', subject: '语文', score: 1, manfen: 1 }] } },
      { code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional-old.png'] } },
      { code: 0, data: { examId: 456, name: '虚构考试', score: 1, manfen: 1, papers: [{ paperId: 'paper-1', pid: 'parent-1', subject: '语文', score: 1, manfen: 1 }] } },
      { code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional-new.png'] } },
    ]);
    await expect(provider.getAnswerSheets!(session, '456', 'paper-1')).resolves.toEqual([{ subject: '语文', subjectId: 'paper-1', url: 'https://yj-oss.yunxiao.com/fictional-old.png', watermarked: false }]);
    await expect(provider.getAnswerSheets!(session, '456', 'paper-1')).resolves.toEqual([{ subject: '语文', subjectId: 'paper-1', url: 'https://yj-oss.yunxiao.com/fictional-new.png', watermarked: false }]);
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  it('uses the cached exam result context without reloading overview', async () => {
    const { provider, transport } = setup([{ code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional.png'], questions: [] } }, { code: 0, data: { url: ['https://yj-oss.yunxiao.com/fictional.png'], questions: [] } }]);
    const cached = { examId: '456', examName: '虚构考试', maxTotalScore: 1, subjects: [{ id: 'paper-1', subject: '语文', score: 1, maxScore: 1, providerContext: { pid: 'parent-1' } }] };
    await provider.getSubjectDetail!(session, '456', 'paper-1', cached);
    await provider.getAnswerSheets!(session, '456', 'paper-1', cached);
    expect(transport.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((transport.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.includes('/answer-picture')).length).toBe(2);
  });
});
