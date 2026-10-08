import { ruiyaProvider } from '../providers/ruiya';

const session = { providerId: 'ruiya', accountId: 'fictional', accessToken: 'fictional', providerContext: { cookie: 'ASP.NET_SessionId=fictional' } };
const page = '<input id="hncSign" value="SIGN"/><h1>《虚构考试测评报告》</h1><select id="ddlClass"><option value="12">虚构班级</option></select><ul><li id="li123"><a>语文</a></li><li id="li124" class="absent"><a>历史</a></li></ul>';

function mockOfficialService(overrides: Record<string, unknown> = {}) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const action = /\/api\/single\/([^/]+)/.exec(url)?.[1];
    const data: Record<string, unknown> = {
      resultsByGroup: { scoreShow: 1, scoreRank: 1, Results: [{ subID: 0, subName: '总分', SumScore: 5 }, { subID: 1, subName: '语文', SumScore: 5 }] },
      sortByGroup: { ErrCount: 0, scoreShow: 1, scoreRank: 1, cNum: 2, cCount: 30, sNum: 4, sCount: 100, tNum: 5, tCount: 200 },
      percentByGroup: { ErrCount: 0, subName: ['语文'], myRatings: [80], sumscore: [5], lineRates: [{ lineName: 'A', rates: [70], lineScore: [4] }, { lineName: 'B', rates: [50], lineScore: [3] }] },
      compareByGroup: { ErrCount: 0, scoreRank: 1, cNum: 2, cCount: 30, oneCount: 5, twoCount: 10, offCount: 15 },
      getscorelines: url.endsWith('/0') ? { groupLines: [{ lineName: 'A', lineScore: 4 }, { lineName: 'B', lineScore: 3 }] } : { testsPaper: { TotalScore: 6, QuestionCount: 2 } },
      getByAbilityTotalScore: { scoreShow: 0, scoreRank: 1, papers: [] },
      getByAbilityScore: { scoreShow: 0, scoreRank: 1 },
      papersgroup: { papers: [{ watermark_url: '/fictional-paper.jpg' }] },
      tsubsByGroup: { ErrCount: 0, TotalSize: 2, tSubList: [{ id: 1, no: '1', type: 0, mScore: 2, tScore: 2, mAnswer: 'A', tAnswer: 'A' }, { id: 2, no: '2', type: 1, mScore: 3, tScore: 4, mAnswer: 'fictional-cut' }] },
      chartByGroup: { ErrCount: 0, aName: '基准甲', chtList: [{ title: '阅读', mScore: 5, tScore: 6, aStandard: 4 }], chtSum: { total: 6, mine: 5 } },
      ablityByGroup: { ErrCount: 0, title: ['理解'], mAblity: [50] },
      getScoreByPaperInfoTitle: { ErrCount: 0, dataTable: [{ InfoTitle: '阅读', score: 5, sumscore: 6 }], tsubcla: [{ InfoTitle: '阅读', scorerate: 70 }] },
      getOSS_CutPaper: { errCode: 0, url: 'data:image/jpg;base64,/9j/2Q==' },
      ...overrides,
    };
    const body = action ? data[action] ?? { ErrCount: 9 } : page;
    return { status: 200, headers: new Headers(), text: async () => typeof body === 'string' ? body : JSON.stringify(body), json: async () => body } as Response;
  });
}

afterEach(() => jest.restoreAllMocks());

it('enables extended reports on the registered Ruiya provider without changing its session transport', async () => {
  const fetchMock = mockOfficialService();
  const result = await ruiyaProvider.getExamResult(session, 'REPORT');
  expect(result.maxTotalScore).toBe(6);
  expect(result.subjects[0].maxScore).toBe(6);
  expect(result.subjects).toContainEqual({ id: '124', subject: '历史', status: 'absent' });
  expect(result.reportSections?.map(section => section.id)).toEqual(['subject-comparison', 'class-comparison', 'score-lines']);
  expect(result.reportSections?.[0].comparisonMetric).toBe('超过比例');
  expect(result.reportSections?.find(section => section.id === 'score-lines')?.highlights).toHaveLength(2);
  const detail = await ruiyaProvider.getSubjectDetail!(session, 'REPORT', '1', result);
  expect(detail).toMatchObject({ subjectId: '123', maxScore: 6, questions: [{ myAnswer: 'A', answer: 'A' }, { providerContext: { answerImageAvailable: 'true' } }] });
  expect(detail.statistics).toEqual(expect.arrayContaining([{ scope: '班级', rank: 2, participantCount: 30, averageScore: undefined }, { scope: '总排名', rank: 5, participantCount: 200, averageScore: undefined }]));
  expect(detail.reportSections?.some(section => section.id === 'question-rates')).toBe(true);
  expect(detail.chapterAnalysis?.[0].values['基准甲基准']).toBe('4');
  expect(detail.abilityScoreAnalysis).toBeUndefined();
  expect(detail.reportSections?.some(section => ['learning-status', 'ability-notes', 'paper-info'].includes(section.id))).toBe(false);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/getByAbilityScore/SIGN/123'))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/getAbilityScore/'))).toBe(false);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/getOSS_CutPaper/'))).toBe(false);
  await expect(ruiyaProvider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).resolves.toMatchObject({ url: 'data:image/jpg;base64,/9j/2Q==', watermarked: false });
  for (const [url, init] of fetchMock.mock.calls) {
    expect(new URL(String(url)).origin).toBe('https://ruiya.onlyets.com');
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toMatchObject({ Cookie: 'ASP.NET_SessionId=fictional' });
  }
});

it('keeps Ruiya scores available when an optional analysis response is malformed', async () => {
  mockOfficialService({ percentByGroup: { subName: 123 }, getScoreByPaperInfoTitle: { dataTable: 'invalid' } });
  const result = await ruiyaProvider.getExamResult(session, 'REPORT');
  expect(result.totalScore).toBe(5);
  expect(result.reportSections?.find(section => section.id === 'comparison-unavailable')).toBeDefined();
  const detail = await ruiyaProvider.getSubjectDetail!(session, 'REPORT', '1', result);
  expect(detail.questions).toHaveLength(2);
  expect(detail.reportSections?.some(section => section.id === 'question-rates')).toBe(false);
});

it('shows the official paper maximum after both scaled and original scores', async () => {
  mockOfficialService({ resultsByGroup: { scoreShow: 1, scoreRank: 1, Results: [{ subID: 0, subName: '总分', SumScore: 5, comdSumScore: 8 }, { subID: 1, subName: '语文', SumScore: 5, comdSumScore: 8 }] } });
  const result = await ruiyaProvider.getExamResult(session, 'REPORT');
  expect(result).toMatchObject({ totalScore: 8, originalTotalScore: 5, originalMaxTotalScore: 6 });
  expect(result.maxTotalScore).toBe(6);
  expect(result.subjects[0]).toMatchObject({ score: 8, providerContext: { originalScore: '5', originalMaxScore: '6' } });
  expect(result.subjects[0].maxScore).toBe(6);
});

it.each([
  ['missing metadata', { getscorelines: { groupLines: [] } }],
  ['incompatible total', { resultsByGroup: { Results: [{ subID: 0, subName: '总分', SumScore: 99 }, { subID: 1, subName: '语文', SumScore: 5 }] } }],
  ['duplicate paper', { resultsByGroup: { Results: [{ subID: 0, subName: '总分', SumScore: 10 }, { subID: 1, subName: '语文', SumScore: 5 }, { subID: 1, subName: '语文', SumScore: 5 }] } }],
])('does not invent a total maximum for %s', async (_label, overrides) => {
  mockOfficialService(overrides);
  const result = await ruiyaProvider.getExamResult(session, 'REPORT');
  expect(result.maxTotalScore).toBeUndefined();
  expect(result.originalMaxTotalScore).toBeUndefined();
});
