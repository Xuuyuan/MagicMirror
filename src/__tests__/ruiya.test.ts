import { createRuiyaProvider } from '@/src/providers/ruiya';
import { bfzksProvider } from '@/src/providers/bfzks';

const loginPage = '<input name="__VIEWSTATE" value="VIEW"/><input name="__VIEWSTATEGENERATOR" value="GEN"/><input name="__EVENTVALIDATION" value="EVENT"/>';
const reportList = '<a href="/report/singleGroup/REPORT123">虚构报告</a>';
const report = '<input id="hncSign" value="SIGN"/><h1>《虚构考试测评报告》</h1><table id="tab_score"><tr><th>学科</th><th>分数</th><th>均分</th><th>班排名</th><th>校排名</th><th>总排名</th><th>标准分</th><th>贡献等级</th></tr><tr><td>总分</td><td>300\\450</td><td>200</td><td>1(1%)</td><td>1(1%)</td><td>2(2%)</td><td>1</td><td>A</td></tr><tr><td>语文</td><td>100</td><td>80</td><td>1(1%)</td><td>1(1%)</td><td>1(1%)</td><td>1</td><td>A</td></tr></table>';
const results = JSON.stringify({ scoreRank: 1, scoreShow: 1, Results: [{ subID: 0, subName: '总分', SumScore: 300, comdSumScore: 450, cAvgScore: 420, sAvgScore: 400, tAvgScore: 380, cNum: '1 / 29', sNum: '1 / 29', tNum: '16 / 592' }, { subID: 4440, subName: '语文', SumScore: 100, comdSumScore: -1, cAvgScore: 80, sAvgScore: 82, tAvgScore: 85, cNum: '1 / 29', sNum: '1 / 29', tNum: '1 / 609', StdScore: 1.2, lineLevel: 'A' }] });
const sort = JSON.stringify({ scoreShow: 1, sSort: { cNum: 2, cCount: 29, sNum: 8, sCount: 120, tNum: 16, tCount: 592 }, oSort: { cNum: 3, cCount: 29, sNum: 9, sCount: 120, tNum: 12, tCount: 592 } });
const session = { providerId: 'ruiya', accountId: 'fictional', accessToken: 'ASP.NET_SessionId=fictional', providerContext: { cookie: 'ASP.NET_SessionId=fictional' } };

function response(body: string, headers?: Record<string, string>, url?: string): Response { return { status: 200, headers: new Headers(headers), text: async () => body, json: async () => JSON.parse(body), url } as Response; }

describe('题型汇总（虚构数据）', () => {
  const rows = [{ id: 1, no: '1', mScore: 0, tScore: 4, type: '0' }, { id: 2, no: '2', mScore: 5, tScore: 6, type: 1 }];
  const cached = { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文', score: 8, providerContext: { originalScore: '5', scaledScore: '8' } }] };
  it.each(['ruiya', 'bfzks'])('classifies and sums %s using original scores and TotalSize', async (providerId) => {
    const transport = jest.fn(async (input: RequestInfo | URL) => String(input).includes('tsubsByGroup')
      ? response(JSON.stringify({ ErrCount: 0, TotalSize: 2, tSubList: rows })) : response(report));
    const provider = createRuiyaProvider(transport, { providerId });
    const detail = await provider.getSubjectDetail!({ ...session, providerId }, 'REPORT123', '4440', cached);
    expect(detail.questions?.map((question) => question.kind)).toEqual(['objective', 'subjective']);
    expect(detail.questionScoreSummaries).toEqual([{ kind: 'objective', score: 0, maxScore: 4 }, { kind: 'subjective', score: 5, maxScore: 6 }]);
    expect(detail.score).toBe(8);
    expect(transport.mock.calls.filter(([url]) => String(url).includes('tsubsByGroup'))).toHaveLength(1);
  });
  it.each([
    ['部分数据', { TotalSize: 3, tSubList: rows }],
    ['缺失总题数', { tSubList: rows }],
    ['接口业务错误', { ErrCount: 9, TotalSize: 2, tSubList: rows }],
    ['未知分类', { TotalSize: 2, tSubList: [rows[0], { ...rows[1], type: -1 }] }],
    ['得分缺失', { TotalSize: 2, tSubList: [rows[0], { ...rows[1], mScore: null }] }],
    ['得分不一致', { TotalSize: 2, tSubList: [rows[0], { ...rows[1], mScore: 4 }] }],
    ['超出满分', { TotalSize: 2, tSubList: [rows[0], { ...rows[1], tScore: 4 }] }],
    ['重复题目', { TotalSize: 2, tSubList: [rows[0], { ...rows[1], id: 1 }] }],
  ])('omits unverified summaries for %s', async (_label, data) => {
    const provider = createRuiyaProvider(async (input) => String(input).includes('tsubsByGroup') ? response(JSON.stringify(data)) : response(report));
    const detail = await provider.getSubjectDetail!(session, 'REPORT123', '4440', cached);
    expect(detail.questionScoreSummaries).toBeUndefined();
    expect(detail.questions).toHaveLength(2);
  });
});

describe('Ruiya Provider', () => {
  it('logs in with the official form and parses report links', async () => {
    let call = 0;
    const transport = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => { call += 1; if (call === 1) return response(loginPage, { 'set-cookie': 'ASP.NET_SessionId=fictional; path=/' }); if (String(url).includes('/report/singleGroup/')) return response(report); if (call === 2) return response('<a href="/report/test/">报告列表</a>'); return response(reportList); });
    const provider = createRuiyaProvider(transport);
    const auth = await provider.authenticate('fictional', 'fictional-password');
    expect(auth).toMatchObject({ providerId: 'ruiya', accountId: 'fictional', providerContext: { cookie: 'ASP.NET_SessionId=fictional' } });
    expect(String((transport.mock.calls[1][1] as RequestInit).body)).toContain('hndSystem=1');
    expect((transport.mock.calls[1][1] as RequestInit).credentials).toBe('omit');
    expect(String((transport.mock.calls[1][1] as RequestInit).body)).not.toContain('fictional-password');
    await expect(provider.getExamList(auth)).resolves.toEqual([{ id: 'REPORT123', name: '虚构考试', hasResult: true }]);
  });

  it('allows binding when reports are visible but not open yet', async () => {
    let call = 0;
    const unopenedReportList = '<div id="day_2026 04 07"><div>04月07日</div><div>高三4月7-8日学情调研测评报告 年级：高三</div><a href="javascript:alert(\'%E6%8A%A5%E5%91%8A%E6%9C%AA%E5%BC%80%E6%94%BE\')">报告未开放</a></div>';
    const transport = jest.fn(async (url: RequestInfo | URL) => {
      call += 1;
      if (call === 1) return response(loginPage, { 'set-cookie': 'ASP.NET_SessionId=fictional-unopened; path=/' });
      if (call === 2) return response('<a href="/report/test/">报告列表</a>');
      return response(unopenedReportList);
    });
    const provider = createRuiyaProvider(transport);
    const auth = await provider.authenticate('fictional', 'fictional-password');
    await expect(provider.getExamList(auth)).resolves.toEqual([{ id: 'unopened-day_2026%2004%2007', name: '高三4月7-8日学情调研', availability: 'unavailable' }]);
  });

  it('keeps an open report only once when another entry in its block is unavailable', async () => {
    const html = '<div id="day_open"><div>虚构考试测评报告</div><a href="/report/singleGroup/REPORT123">查看报告</a><a href="javascript:alert(\'报告未开放\')">报告未开放</a></div><div id="day_closed"><div>另一场考试测评报告</div><a href="javascript:alert(\'报告未开放\')">报告未开放</a></div>';
    const transport = jest.fn(async (url: RequestInfo | URL) => response(String(url).includes('/report/singleGroup/REPORT123') ? report : html));
    const provider = createRuiyaProvider(transport);
    await expect(provider.getExamList(session)).resolves.toEqual([
      { id: 'REPORT123', name: '虚构考试', hasResult: true },
      { id: 'unopened-day_closed', name: '另一场考试', availability: 'unavailable' },
    ]);
  });

  it('does not treat other encoded report alerts as an unopened exam', async () => {
    const html = '<div id="day_open"><div>虚构考试测评报告</div><a href="javascript:alert(\'%E6%8A%A5%E5%91%8A\')">报告说明</a></div>';
    const provider = createRuiyaProvider(async () => response(html));
    await expect(provider.getExamList(session)).resolves.toEqual([]);
  });

  it('uses the report-query login type for 百分智', async () => {
    let call = 0;
    const transport = jest.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      call += 1;
      if (call === 1) return response(loginPage, { 'set-cookie': 'ASP.NET_SessionId=fictional-bfz' });
      if (String(url).includes('/report/singleGroup/')) return response(report);
      return response(reportList);
    });
    // The shared factory uses the same options; inspect the configured login request with a test transport.
    const configured = createRuiyaProvider(transport, { host: 'https://www.bfzks.com', providerId: 'bfzks', platformLabel: '百分智', system: '1' });
    await configured.authenticate('fictional', 'fictional-password');
    expect(String((transport.mock.calls[1][1] as RequestInit).body)).toContain('hndSystem=1');
    expect(bfzksProvider.metadata.id).toBe('bfzks');
  });

  it('takes the 百分智 session host from the runtime-followed login redirect', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === 'POST') return response(reportList, undefined, 'http://bfzks.xueqingroom.cn/report/test/');
      if (String(url).includes('/report/singleGroup/')) return response(report);
      if (String(url).includes('xueqingroom')) return response(reportList);
      return response(loginPage, { 'set-cookie': 'ASP.NET_SessionId=fictional-bfz' });
    });
    const provider = createRuiyaProvider(transport, { host: 'https://www.bfzks.com', providerId: 'bfzks', platformLabel: '百分智', system: '1', allowedHosts: ['xueqingroom.cn'], platformCookieJar: true });
    const auth = await provider.authenticate('fictional', 'fictional-password');
    // React Native 忽略 redirect:'manual'，只能从 response.url 取回登录后的主机；Cookie 交由平台容器携带。
    expect(auth.providerContext).toMatchObject({ host: 'http://bfzks.xueqingroom.cn' });
    expect(calls[1].init.credentials).toBe('include');
    expect((calls[1].init.headers as Record<string, string>).Cookie).toBeUndefined();
    await expect(provider.getExamList(auth)).resolves.toEqual([{ id: 'REPORT123', name: '虚构考试', hasResult: true }]);
    expect(calls[calls.length - 1].url.startsWith('http://bfzks.xueqingroom.cn/')).toBe(true);
  });

  it('clears the platform cookie container when a 百分智 session is revoked', async () => {
    const provider = createRuiyaProvider(async () => response(report), { host: 'https://www.bfzks.com', providerId: 'bfzks', platformLabel: '百分智', allowedHosts: ['xueqingroom.cn'], platformCookieJar: true });
    const bfzksSession = { providerId: 'bfzks', accountId: 'fictional', accessToken: 'ASP.NET_SessionId=fictional', providerContext: { cookie: 'ASP.NET_SessionId=fictional', host: 'http://bfzks.xueqingroom.cn' } };
    await provider.logout(bfzksSession);
    await expect(provider.getExamResult(bfzksSession, 'REPORT123')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('maps raw and scaled scores without inventing a maximum score', async () => {
    const transport = jest.fn(async (url: RequestInfo | URL) => String(url).includes('resultsByGroup') ? response(results) : String(url).includes('sortByGroup') ? response(sort) : response(report));
    const provider = createRuiyaProvider(transport);
    const result = await provider.getExamResult(session, 'REPORT123');
    expect(result).toMatchObject({ examName: '虚构考试', totalScore: 450, originalTotalScore: 300, maxTotalScore: undefined });
    expect(result.ranking).toEqual({ rank: 16, total: 592, scope: 'group' });
    expect(result.rankings).toEqual([{ label: '赋分班级', rank: 2, total: 29, scope: 'class' }, { label: '赋分年级', rank: 8, total: 120, scope: 'grade' }, { label: '赋分总排名', rank: 16, total: 592, scope: 'group' }, { label: '原始分班级', rank: 3, total: 29, scope: 'class' }, { label: '原始分年级', rank: 9, total: 120, scope: 'grade' }, { label: '原始分总排名', rank: 12, total: 592, scope: 'group' }]);
    expect(result.statistics).toEqual([{ scope: '班级', averageScore: 420, participantCount: 29, rank: 1 }, { scope: '年级', averageScore: 400, participantCount: 29, rank: 1 }, { scope: '总排名', averageScore: 380, participantCount: 592, rank: 16 }]);
    expect(result.subjects[0]).toMatchObject({ subject: '语文', score: 100 });
    expect(result.subjects[0].providerContext).toMatchObject({ classAverage: '80', gradeAverage: '82', groupAverage: '85', standardScore: '1.2' });
  });

  it('omits malformed ranking strings instead of exposing them as ranks', async () => {
    const malformed = JSON.stringify({ scoreRank: 1, scoreShow: 1, Results: [
      { subID: 0, subName: '总分', SumScore: 300, comdSumScore: 450, cNum: '未知', sNum: '0 / 29', tNum: '未知' },
      { subID: 4440, subName: '语文', SumScore: 100, cNum: '未知', sNum: 'bad', tNum: '0 / 609' },
    ] });
    const transport = jest.fn(async (url: RequestInfo | URL) => String(url).includes('resultsByGroup') ? response(malformed) : response(report));
    const provider = createRuiyaProvider(transport);
    const result = await provider.getExamResult(session, 'REPORT123');
    expect(result.ranking).toBeUndefined();
    expect(result.subjects[0].providerContext).not.toHaveProperty('classRank');
    expect(result.subjects[0].providerContext).not.toHaveProperty('gradeRank');
    expect(result.subjects[0].providerContext).not.toHaveProperty('groupRank');
  });

  it('uses subject rank totals embedded in the result when the optional sort endpoint is unavailable', async () => {
    const transport = jest.fn(async (url: RequestInfo | URL) => { const value = String(url); if (value.includes('resultsByGroup')) return response(results); if (value.includes('/report/singleGroup/')) return response(report); return response(JSON.stringify({ ErrCount: 9, ErrMsg: '未提供' })); });
    const provider = createRuiyaProvider(transport);
    const result = await provider.getExamResult(session, 'REPORT123');
    const detail = await provider.getSubjectDetail!(session, 'REPORT123', '4440', result);
    expect(detail.statistics).toEqual(expect.arrayContaining([{ scope: '班级', averageScore: 80, participantCount: 29, rank: 1 }, { scope: '年级', averageScore: 82, participantCount: 29, rank: 1 }, { scope: '总排名', averageScore: 85, participantCount: 609, rank: 1 }]));
  });

  it('revokes the browser session locally', async () => {
    const provider = createRuiyaProvider(async () => response(report));
    await provider.logout(session);
    await expect(provider.getExamResult(session, 'REPORT123')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('loads subject questions and answer-sheet URLs on demand', async () => {
    const transport = jest.fn(async (url: RequestInfo | URL) => String(url).includes('papersgroup')
      ? response(JSON.stringify({ papers: [{ watermark_url: 'https://ruiya.invalid/paper.png' }] }))
      : String(url).includes('tsubsByGroup')
        ? response(JSON.stringify({ tSubList: [{ id: 1, no: '一.1', mScore: 3, tScore: 5 }] }))
        : response(report));
    const provider = createRuiyaProvider(transport);
    const detail = await provider.getSubjectDetail!(session, 'REPORT123', '4440', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文' }] });
    expect(detail).toMatchObject({ subject: '语文', questions: [{ label: '一.1', score: 3, maxScore: 5 }], answerSheets: [{ url: 'https://ruiya.invalid/paper.png' }] });
    expect(detail.answerSheets?.[0].headers).toMatchObject({ Cookie: 'ASP.NET_SessionId=fictional', Referer: 'https://ruiya.onlyets.com/report/singleGroup/REPORT123' });
  });

  it('resolves ordinal subject routes to the official paper id', async () => {
    const page = report.replace('</h1>', '<ul class="sr_theme"><li id="li0"><a>总分</a></li><li id="li10349"><a>语文</a></li></ul></h1>');
    const transport = jest.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('tsubsByGroup') && value.endsWith('/10349')) return response(JSON.stringify({ tSubList: [{ id: 1, no: '1', mScore: 3, tScore: 3 }] }));
      if (value.includes('tsubsByGroup')) return response(JSON.stringify({ tSubList: [] }));
      return response(page);
    });
    const provider = createRuiyaProvider(transport);
    await expect(provider.getSubjectDetail!(session, 'REPORT123', '1', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '1', subject: '语文' }] })).resolves.toMatchObject({ subjectId: '10349', questions: [{ label: '1', score: 3 }] });
  });
  it('keeps answer sheets from one subject id candidate when questions resolve through another', async () => {
    const page = report.replace('</h1>', '<ul><li id="li10349"><a data-paper="PAPER123">语文</a></li></ul></h1>');
    const transport = jest.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('papersgroup') && value.endsWith('/PAPER123')) return response(JSON.stringify({ papers: [{ pic_url: 'https://ruiya.invalid/paper.png' }] }));
      if (value.includes('tsubsByGroup') && value.endsWith('/10349')) return response(JSON.stringify({ tSubList: [{ id: 1, no: '1', mScore: 3, tScore: 3 }] }));
      if (value.includes('tsubsByGroup')) return response(JSON.stringify({ tSubList: [] }));
      return response(page);
    });
    const provider = createRuiyaProvider(transport);
    await expect(provider.getSubjectDetail!(session, 'REPORT123', '4440', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文' }] })).resolves.toMatchObject({ questions: [{ label: '1' }], answerSheets: [{ url: 'https://ruiya.invalid/paper.png' }] });
  });

  it('keeps subject questions available when the optional paper request fails', async () => {
    const transport = jest.fn(async (url: RequestInfo | URL) => String(url).includes('papersgroup')
      ? response(JSON.stringify({ error: 'fictional failure' }), undefined)
      : String(url).includes('tsubsByGroup')
        ? response(JSON.stringify({ tSubList: [{ id: 1, no: '一.1', mScore: 3, tScore: 5 }] }))
        : response(report));
    const provider = createRuiyaProvider(async (url) => String(url).includes('papersgroup') ? ({ ...await transport(url), status: 500 } as Response) : transport(url));
    await expect(provider.getSubjectDetail!(session, 'REPORT123', '4440', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文' }] })).resolves.toMatchObject({ subject: '语文', questions: [{ label: '一.1' }], answerSheets: [] });
  });

  it('falls back to official answer-sheet links embedded in the report page', async () => {
    const page = report.replace('</h1>', '<a href="/api/single/StudentNoImageSheet/SIGN/PAPER/0.png"></a></h1>');
    const transport = jest.fn(async (url: RequestInfo | URL) => String(url).includes('papersgroup') ? ({ ...response('{}'), status: 500 } as Response) : String(url).includes('tsubsByGroup') ? response(JSON.stringify({ tSubList: [] })) : response(page));
    const provider = createRuiyaProvider(transport);
    await expect(provider.getSubjectDetail!(session, 'REPORT123', '4440', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文' }] })).resolves.toMatchObject({ answerSheets: [{ url: 'https://ruiya.onlyets.com/api/single/StudentNoImageSheet/SIGN/PAPER/0.png' }] });
  });

  it('maps official chapter and ability analysis when available', async () => {
    const transport = jest.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('tsubsByGroup')) return response(JSON.stringify({ ErrCount: 9, ErrMsg: '小题分不存在' }));
      if (value.includes('chartByGroup')) return response(JSON.stringify({ chtList: [{ title: '阅读', tScore: 20, aStandard: 15, bStandard: 12, mScore: 18, sLevel: 'A' }] }));
      if (value.includes('ablityByGroup')) return response(JSON.stringify({ title: ['理解'], sumscore: [20], aAblity: [15], bAblity: [12], score: [18], mAblity: [90] }));
      if (value.includes('getAbilityScore')) return response(JSON.stringify({ stuSumScore: 100, sumscore: 105, tNum: 20, tnum: 15 }));
      return response(report);
    });
    const provider = createRuiyaProvider(transport);
    await expect(provider.getSubjectDetail!(session, 'REPORT123', '4440', { examId: 'REPORT123', examName: '虚构', subjects: [{ id: '4440', subject: '语文' }] })).resolves.toMatchObject({
      chapterAnalysis: [{ label: '阅读', values: { '章节总分': '20', '个人得分': '18', '达成等级': 'A' } }],
      abilityAnalysis: [{ label: '理解', values: { '能力总分': '20', '个人得分': '18', '得分率': '90' } }],
      abilityScoreAnalysis: [{ label: '原始分', values: { '分数': '100', '排名': '20' } }, { label: '学能分', values: { '分数': '105', '排名': '15' } }],
    });
  });
});
