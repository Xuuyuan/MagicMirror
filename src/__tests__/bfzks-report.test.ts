import { createRuiyaProvider } from '../providers/ruiya';
import { examReportSections, learningTotalSection, questionRateSection } from '../providers/ruiya-report-analysis';

const page = '<input id="hncSign" value="SIGN"/><h1>《虚构考试测评报告》</h1><select id="ddlClass"><option value="12">虚构班级</option></select><ul><li id="li123"><a>语文</a></li><li id="li124" class="absent"><a>历史</a></li></ul>';
const session = { providerId: 'bfzks', accountId: 'fictional', accessToken: 'fictional', providerContext: { cookie: 'fictional', host: 'https://www.bfzks.com' } };
const results = { scoreRank: 1, scoreShow: 1, Results: [{ subID: 0, subName: '总分', SumScore: 5, comdSumScore: -1 }, { subID: 1, subName: '语文', SumScore: 5, comdSumScore: -1, cNum: '2 / 30' }] };
function response(data: unknown, status = 200): Response { return { status, headers: new Headers(), text: async () => typeof data === 'string' ? data : JSON.stringify(data), json: async () => data } as Response; }
function configured(overrides: Record<string, unknown> = {}) {
  const transport = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const action = /\/api\/single\/([^/]+)/.exec(url)?.[1];
    const data: Record<string, unknown> = {
      resultsByGroup: results, sortByGroup: { scoreRank: 1, scoreShow: 1, cNum: 2, cCount: 30, sNum: 4, sCount: 100 },
      papersgroup: { papers: [] },
      tsubsByGroup: { ErrCount: 0, TotalSize: 2, tSubList: [{ id: 1, no: '1', type: 0, mScore: 2, tScore: 2, mAnswer: 'A', tAnswer: 'A', zhiShiDian: '虚构知识点', mDiff: 0.6 }, { id: 2, no: '2', type: 1, mScore: 3, tScore: 4, mAnswer: 'https://www.bfzks.com/placeholder.png' }] },
      chartByGroup: { ErrCount: 0, aName: '基准甲', bName: '基准乙', chtList: [{ title: '阅读', tScore: 6, mScore: 5, aStandard: 4, bStandard: 3, sLevel: 'A' }], chtSum: { total: 6, mine: 5, level: 'A' } },
      ablityByGroup: { ErrCount: 0, title: ['理解'], mAblity: [50], content: '虚构评语' },
      getByAbilityScore: { scoreShow: 0, stuSumScore: 5, sumscore: 999 },
      getByAbilityTotalScore: { scoreShow: 0, tScore: 999 },
      getscorelines: url.endsWith('/0') ? { groupLines: [{ lineName: 'A', lineScore: 4 }] } : { testsPaper: { TotalScore: 6, QuestionCount: 2 } },
      getScoreByPaperInfoTitle: { ErrCount: 0, dataTable: [{ InfoTitle: '阅读题组', score: 5, sumscore: 6 }], tsubcla: [{ InfoTitle: '阅读题组', scorerate: 50 }] },
      percentByGroup: { ErrCount: 0, subName: ['语文'], myRatings: [80], sumscore: [5], lineRates: [{ lineName: 'A', rates: [70], lineScore: [4] }], advSub: '语文' },
      compareByGroup: { ErrCount: 0, scoreRank: 1, cNum: 2, cCount: 30, oneCount: 4, twoCount: 10, offCount: 16 },
      getOSS_CutPaper: { errCode: 0, url: 'https://www.bfzks.com/fictional-cut.png' },
      ...overrides,
    };
    return action ? response(data[action] ?? {}) : response(page);
  });
  return { transport, provider: createRuiyaProvider(transport, { providerId: 'bfzks', host: 'https://www.bfzks.com', extendedReports: true, abilityScoreAction: 'getByAbilityScore' }) };
}

it('maps total analysis, explicit absence and the -1 scaled-score sentinel', async () => {
  const { provider } = configured();
  const result = await provider.getExamResult(session, 'REPORT');
  expect(result.totalScore).toBe(5);
  expect(result.subjects).toContainEqual({ id: '124', subject: '历史', status: 'absent' });
  expect(result.reportSections?.map(x => x.id)).toEqual(['subject-comparison', 'class-comparison', 'score-lines']);
  expect(result.reportSections?.[0].comparisonMetric).toBe('超过比例');
  expect(result.reportSections?.[0].items?.[0].values['超过比例']).toBe('80%');
  expect(result.reportSections?.[0].comparisons?.[0].series[0].percent).toBe(80);
  expect(JSON.stringify(result.reportSections?.[0])).not.toContain('得分率');
  expect(result.reportSections?.find(x => x.id === 'score-lines')?.highlights).toEqual([{ label: 'A线', value: '4', unit: '分' }]);
  expect(JSON.stringify(result.reportSections)).not.toContain('999');
});

it('uses the verified paper route, maps answers, metadata and flat rankings, and hides unopened learning scores', async () => {
  const { provider, transport } = configured();
  const result = await provider.getExamResult(session, 'REPORT');
  const detail = await provider.getSubjectDetail!(session, 'REPORT', '1', result);
  expect(detail).toMatchObject({ subjectId: '123', maxScore: 6, questions: [{ myAnswer: 'A', answer: 'A', kind: 'objective' }, { kind: 'subjective', providerContext: { answerImageAvailable: 'true' } }] });
  expect(detail.statistics).toEqual(expect.arrayContaining([{ scope: '班级', rank: 2, participantCount: 30, averageScore: undefined }]));
  expect(detail.abilityAnalysis?.[0].values['得分率']).toBe('50%');
  expect(detail.chapterAnalysis?.[0].values['基准甲基准']).toBe('4');
  expect(detail.abilityScoreAnalysis).toBeUndefined();
  expect(transport.mock.calls.some(([url]) => String(url).includes('/getAbilityScore/'))).toBe(false);
  expect(transport.mock.calls.some(([url]) => String(url).includes('/getByAbilityScore/SIGN/123'))).toBe(true);
});

it('only loads a cut image on demand and rejects an unsuccessful or non-http image response', async () => {
  const { provider, transport } = configured();
  await provider.getExamResult(session, 'REPORT');
  expect(transport.mock.calls.some(([url]) => String(url).includes('/getOSS_CutPaper/'))).toBe(false);
  await expect(provider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).resolves.toMatchObject({ url: 'https://www.bfzks.com/fictional-cut.png' });
  await expect(configured({ getOSS_CutPaper: { errCode: 1 } }).provider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(configured({ getOSS_CutPaper: { errCode: 0, url: 'file:///private' } }).provider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).rejects.toMatchObject({ code: 'UNKNOWN' });
  await expect(configured({ getOSS_CutPaper: { errCode: 0, url: 'data:image/jpg;base64,/9j/2Q==' } }).provider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).resolves.toMatchObject({ url: 'data:image/jpg;base64,/9j/2Q==' });
  await expect(configured({ getOSS_CutPaper: { errCode: 0, url: 'data:image/svg+xml;base64,AAAA' } }).provider.getQuestionAnswerSheet!(session, 'REPORT', '123', '2')).rejects.toMatchObject({ code: 'UNKNOWN' });
});

it('keeps unavailable question data separate from a wrong-only empty result', async () => {
  const { provider } = configured({ tsubsByGroup: { ErrCount: 1 }, getscorelines: { testsPaper: { TotalScore: 6, QuestionCount: 0, Papers: 0, TestsModel: { TestDate: '0001-01-01T00:00:00' } } } });
  const detail = await provider.getSubjectDetail!(session, 'REPORT', '1', await provider.getExamResult(session, 'REPORT'));
  expect(detail.questions).toEqual([]);
  expect(detail.questionNotice).toContain('未提供');
  expect(detail.maxScore).toBe(6);
});

it('honors grade-only and hidden-ranking flags even when numeric data is returned', async () => {
  const { provider } = configured({ sortByGroup: { scoreShow: 2, scoreRank: 0, cNum: 999, cCount: 1000 } });
  const result = await provider.getExamResult(session, 'REPORT');
  expect(result.totalScore).toBeUndefined();
  expect(result.ranking).toBeUndefined();
  expect(result.rankings).toBeUndefined();
  expect(result.subjects[0].score).toBeUndefined();
  expect(result.subjects[0].providerContext?.classRank).toBeUndefined();
  expect(result.reportSections?.map(x => x.id)).not.toContain('class-comparison');
  const detail = await provider.getSubjectDetail!(session, 'REPORT', '1', result);
  expect(detail.score).toBeUndefined();
  expect(detail.questions?.[0].score).toBeUndefined();
  expect(detail.questionScoreSummaries).toBeUndefined();
  expect(detail.statistics).toEqual([]);
});

it('shows the official paper maximum after the scaled score', async () => {
  const { provider } = configured({ resultsByGroup: { ...results, Results: results.Results.map(row => ({ ...row, comdSumScore: 80 })) } });
  const detail = await provider.getSubjectDetail!(session, 'REPORT', '1', await provider.getExamResult(session, 'REPORT'));
  expect(detail.score).toBe(80);
  expect(detail.maxScore).toBe(6);
});

it('matches rate groups by identity rather than response order and keeps zero values', () => {
  const section = questionRateSection({ dataTable: [{ InfoTitle: '甲', score: 0, sumscore: 4 }, { InfoTitle: '乙', score: 4, sumscore: 4 }], tsubcla: [{ InfoTitle: '乙', scorerate: 70 }, { InfoTitle: '甲', scorerate: 50 }] });
  expect(section?.comparisons?.[0].series).toEqual([{ label: '本人', percent: 0 }, { label: '班级', percent: 50 }]);
  expect(questionRateSection({ ErrCount: 1, dataTable: [{ InfoTitle: '甲', score: 3, sumscore: 4 }] })).toBeUndefined();
  expect(examReportSections({ ErrCount: 9, subName: ['甲'] }, { scoreRank: 0 }, undefined)).toEqual([]);
  expect(learningTotalSection({ scoreShow: 0, tScore: 999 })).toBeUndefined();
});
