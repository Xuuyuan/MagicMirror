import {
  balanceSection,
  v25Trend,
  v25Questions,
  resolveReportPlan,
  v25Sections,
  normalizeV25Sheet,
  v25MetricTrend,
  v25AverageScore,
} from '../providers/zhixue-v25';
import { ProviderError } from '../domain/models';

const permissions = {
  showScoreFlag: true,
  showLevelFlag: true,
  showScoreRateTrendFlag: false,
  myScoringRate: false,
  classScoreRate: false,
  gradeScoreRate: false,
};
const plan = {
  version: 'v25' as const,
  modules: ['completeReportMain_v2025', 'examLevelTrend_v2025', 'examSubjectBalance_v2025'],
  permissions,
};
it('sums complete top-level school averages without dividing by the question count or summing children', () => {
  const raw = {
    answerInfoDTOList: [
      { topicNumber: 1, dispTitle: '1', gradeAvgScore: 0.104 },
      { topicNumber: 2, dispTitle: '2', gradeAvgScore: 0.104 },
    ],
  };
  expect(v25AverageScore(raw)).toBe(0.21);
  expect(
    v25AverageScore({ answerInfoDTOList: [{ topicNumber: 1, dispTitle: '1', gradeAvgScore: 0 }] }),
  ).toBe(0);
  expect(
    v25AverageScore({
      answerInfoDTOList: [...raw.answerInfoDTOList, { topicNumber: 3, dispTitle: '3' }],
    }),
  ).toBeUndefined();
  expect(
    v25AverageScore({ answerInfoDTOList: [raw.answerInfoDTOList[0], raw.answerInfoDTOList[0]] }),
  ).toBeUndefined();
  expect(v25AverageScore({ answerInfoDTOList: [] })).toBeUndefined();
});
it('does not load the removed subject-level knowledge and level-trend cards', async () => {
  const request = jest.fn();
  const sections = await v25Sections(
    request,
    { ...plan, modules: ['paperLevelTrend_v2025', 'knowledgeHoldSituation_v2025'] },
    {
      examId: 'fictional',
      paperId: 'paper',
      subjectCode: '05',
      setLevel: true,
      grade: 'C',
      start: '1',
      end: '2',
      subjectCount: 0,
    },
  );
  expect(sections).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});
it('uses explicit modules and permissions and never downgrades on network or access errors', async () => {
  const legacy = jest.fn();
  const modern = jest.fn(async (path: string) =>
    path === 'common/getModules' ? [{ code: 'completeReportMain_v2025' }] : permissions,
  );
  expect((await resolveReportPlan(modern, legacy, 'fictional-exam')).version).toBe('v25');
  expect(legacy).not.toHaveBeenCalled();
  for (const code of ['NETWORK', 'RESTRICTED', 'SESSION_EXPIRED'] as const) {
    modern.mockRejectedValueOnce(new ProviderError(code, 'fictional'));
    await expect(resolveReportPlan(modern, legacy, 'fictional-exam')).rejects.toMatchObject({
      code,
    });
    expect(legacy).not.toHaveBeenCalled();
  }
});
it('supports a verified legacy module response and unsupported metadata endpoints', async () => {
  const modern = jest.fn().mockRejectedValue(new ProviderError('UNSUPPORTED', 'fictional'));
  const legacy = jest.fn(async () => [
    { code: 'completeReportMain' },
    { code: 'examSubjectDiagnosis' },
  ]);
  expect(await resolveReportPlan(modern, legacy, 'fictional')).toMatchObject({ version: 'legacy' });
  expect(legacy).toHaveBeenCalledTimes(1);
});
it('keeps auxiliary modules usable when the overview module is not enabled', async () => {
  const modern = jest.fn(async (path: string) =>
    path === 'common/getModules' ? [{ code: 'examSubjectBalance_v2025' }] : permissions,
  );
  expect(await resolveReportPlan(modern, jest.fn(), 'fictional')).toMatchObject({
    version: 'v25',
    modules: ['examSubjectBalance_v2025'],
  });
});
it('preserves signed values, nulls and an actual zero reference without duplicate curves', () => {
  const section = balanceSection({
    list: [
      { subjectName: '虚构物理', thisLevel: -3.2, usualLevel: -3.2, mediumLevel: 0 },
      { subjectName: '虚构英语', thisLevel: -4.9, usualLevel: -4.9, mediumLevel: 0 },
      { subjectName: '虚构数学', thisLevel: null, usualLevel: null, mediumLevel: 0 },
    ],
  });
  expect(section.radar?.scale).toEqual({ min: -5, max: 5, reference: 0 });
  expect(section.radar?.series).toEqual([
    { label: '本次水平', values: [-3.2, -4.9, null] },
    { label: '年级中等水平', values: [0, 0, 0] },
  ]);
  expect(
    balanceSection({ list: [{ subjectName: '虚构', thisLevel: 3, mediumLevel: 0 }] }).radar?.scale,
  ).toMatchObject({ min: -4, max: 4 });
  expect(() => balanceSection({ list: [{ subjectName: '虚构', thisLevel: Infinity }] })).toThrow();
});
it('corrects only the matching current trend point without changing history or input', () => {
  const raw = {
    list: [
      {
        dataList: [
          { id: 'current', name: '本次', dateTime: 2, level: 'E' },
          { id: 'old', name: '历史', dateTime: 1, level: 'D' },
        ],
      },
    ],
  };
  const section = v25Trend(raw, 'current', 'C');
  expect(section.items?.map((i) => i.values.等级)).toEqual(['D', 'C']);
  expect(raw.list[0].dataList[0].level).toBe('E');
  expect(v25Trend(raw, 'missing', 'A').items?.map((i) => i.values.等级)).toEqual(['D', 'E']);
});
it('does not request a disabled level trend or invent class ranks', async () => {
  const request = jest.fn(async () => ({
    list: [
      { subjectName: '虚构物理', thisLevel: -1, mediumLevel: 0 },
      { subjectName: '虚构英语', thisLevel: -2, mediumLevel: 0 },
      { subjectName: '虚构数学', thisLevel: 1, mediumLevel: 0 },
    ],
  }));
  const result = await v25Sections(request, plan, {
    examId: 'fictional',
    start: '1',
    end: '2',
    setLevel: false,
    subjectCount: 3,
  });
  expect(request.mock.calls).toHaveLength(1);
  expect(request).toHaveBeenCalledWith('exam/getSubjectBalance', { examId: 'fictional' });
  expect(result[0].radar).toBeDefined();
  expect(result[0].highlights).toBeUndefined();
});
it('preserves zero question scores and matches sheet metadata by topic ID', () => {
  const questions = v25Questions(
    { answerInfoDTOList: [{ topicNumber: 2, dispTitle: '2', score: 0, standardScore: 4 }] },
    [
      { id: '1', label: '1', kind: 'subjective' },
      { id: '2', label: '2', kind: 'objective', myAnswer: 'B' },
    ],
  );
  expect(questions).toEqual([
    { id: '2', label: '2', kind: 'objective', myAnswer: 'B', score: 0, maxScore: 4 },
  ]);
});
it('validates the modern image and flag contract separately', () => {
  expect(
    normalizeV25Sheet({
      sheetImages: ['https://fictional.example/1.png'],
      sheetDatas: JSON.stringify({
        userAnswerRecordDTO: {
          answerRecordDetails: [{ isCandidate: false, isSelected: '', subTopics: '' }],
        },
      }),
      showSingleTopicScore: true,
      showSingleCorrectTag: false,
    }),
  ).toMatchObject({ sheetImages: ['https://fictional.example/1.png'] });
  expect(() =>
    normalizeV25Sheet({ sheetImages: '[]', sheetDatas: '{}', showSingleTopicScore: true }),
  ).toThrow();
});
it('preserves a zero standard score and never exposes a disabled rate series', async () => {
  const ratePermissions = {
    ...permissions,
    showScoreRateTrendFlag: true,
    myScoringRate: true,
    classScoreRate: false,
    gradeScoreRate: false,
  };
  const rate = v25MetricTrend(
    { dataList: [{ name: '虚构', myScoreRate: 0, classScoreRate: 0.5, gradeScoreRate: 0.8 }] },
    'rate',
    ratePermissions,
  );
  expect(rate.items?.[0].values).toEqual({ 本人得分率: '0%' });
  const request = jest.fn(async (path: string) =>
    path.endsWith('getStandardTrend')
      ? { dataList: [{ standardScore: 0 }] }
      : { dataList: [{ myScoreRate: 0.5 }] },
  );
  const sections = await v25Sections(
    request,
    { ...plan, modules: ['examLevelTrend_v2025'], permissions: ratePermissions },
    { examId: 'fictional', start: '1', end: '2', setLevel: false, standard: true, subjectCount: 0 },
  );
  expect(sections.map((s) => s.id)).toEqual(['zhixue-v25-standard-trend', 'zhixue-v25-rate-trend']);
  expect(sections[0].items?.[0].values).toEqual({ 标准分: '0' });
  expect(request).toHaveBeenCalledTimes(2);
});
