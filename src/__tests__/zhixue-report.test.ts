import { ProviderError } from '../domain/models';
import { zhixueDiagnosisSection, zhixueKnowledgeSection, zhixueReportSections, zhixueTrendSections } from '../providers/zhixue-report';

// Fictional report data; real responses remain outside the repository.
const context = { examId: 'fictional-exam', start: '1596240000000', end: '1627775999000' };
const numberRule = { ruleObtainType: 2, leveType: 'NUMBER', levelList: [
  { name: 'A等', lowBound: 0, upperBound: 15 }, { name: 'B等', lowBound: 15, upperBound: 30 },
] };
const currentTrend = { scoreLevelType: 'number', list: ['clazz', 'grade'].map((code) => ({ tag: { code }, dataList: [
  { id: context.examId, level: 'B等', statTotalNum: 700 },
] })) };
const trend = {
  chartName: '近五次成绩变化', levelList: [{ name: '虚构等级', lowBound: 0, upperBound: 100 }],
  list: [{ tag: { code: 'clazz', name: '班级' }, title: '虚构官方评价',
    reference: { content: '虚构等级说明' }, dataList: [
      { name: '虚构后一次考试', dateTime: 1600100000000, level: 'B等', statTotalNum: 0, totalNum: 2, improveBar: { tag: { name: '相对稳定' } } },
      { name: '虚构前一次考试', dateTime: 1600000000000, level: 'C等', statTotalNum: 2, totalNum: 3 },
    ] }, { tag: { code: 'grade' }, dataList: [{ name: '虚构年级考试', level: 'A等', statTotalNum: 30, totalNum: 31 }] }],
};
const diagnosis = { chartName: '发挥水平学科诊断', tips: '虚构学科建议', tScoreTitle: '虚构官方T分说明', list: [
  { subjectName: '虚构化学', myRank: 20, rationalRank: 40, avgRank: 50, showGradeSecondary: false, tag: { name: '虚构优势' } },
  { subjectName: '虚构物理', myRank: 0, rationalRank: 100, avgRank: 50, showGradeSecondary: true },
] };

it('keeps official scopes, chronological levels, zero counts and qualitative change without inventing ranks', () => {
  const sections = zhixueTrendSections(trend);
  expect(sections).toHaveLength(1);
  expect(sections[0].title).toBe('近五次成绩变化');
  expect(sections[0].items!.filter((item) => item.values['班级等级']).map((item) => item.values['班级等级'])).toEqual(['C等', 'B等']);
  expect(sections[0].items!.find((item) => item.values['班级等级'] === 'B等')!.values).toEqual({ 班级等级: 'B等', 班级变化: '相对稳定', 班级统计人数: '0' });
  expect(sections[0].highlights).toContainEqual({ label: '班级人数', value: '0' });
  expect(sections[0].notes).toEqual(['【班级】虚构官方评价\n虚构等第说明']);
  expect(sections[0].items![0].values['年级等级']).toBe('A等');
  expect(sections[0].highlights).toContainEqual({ label: '学校等第', value: 'A等' });
  expect(zhixueTrendSections({ list: [{ tag: { code: 'unknown' }, dataList: [{}] }] })).toEqual([]);
  expect(zhixueTrendSections({ list: [] })).toEqual([]);
});

it('uses the official inverted radar scale and honors grade-secondary visibility without calling it a percentage', () => {
  const section = zhixueDiagnosisSection(diagnosis);
  expect(section.items).toBeUndefined();
  expect(section.collapseNotes).toBe(true);
  expect(section.notesPosition).toBe('bottom');
  expect(section.radar).toEqual({ axes: ['虚构化学', '虚构物理'], series: [
    { label: '本次水平', values: [80, 100] }, { label: '平时水平', values: [60, null] },
    { label: '班级中等水平', values: [50, null] }, { label: '年级中等水平', values: [null, 50] },
  ] });
  expect(section.notes).toContain('虚构学科建议');
  expect(section.notes?.join('')).toContain('不等同于分数、实际名次或击败率');
  expect(() => zhixueDiagnosisSection({ list: [{ subjectName: '虚构', myRank: 101 }] })).toThrow();
});

it.each(['score', 'unknown', 1, null])('hides ranks and skips rule requests when scoreLevelType is %s', async (scoreLevelType) => {
  const data = { ...currentTrend, scoreLevelType };
  const direct = zhixueTrendSections(data, { clazz: numberRule, grade: numberRule }, context.examId);
  expect(direct[0].highlights?.some((item) => item.label.includes('排名'))).toBe(false);
  const request = jest.fn(async (path: string) => path.endsWith('/getLevelTrend') ? data : diagnosis);
  const sections = await zhixueReportSections(request, context);
  expect(sections[0].highlights?.some((item) => item.label.includes('排名'))).toBe(false);
  expect(request.mock.calls.some(([path]) => path.endsWith('/rulesAndCopywriter'))).toBe(false);
});

it.each([undefined, {}, { ...numberRule, leveType: 'SCORE' }, { ...numberRule, ruleObtainType: 3 }])('requires explicit number rules even if the trend says number %#', (rule) => {
  const section = zhixueTrendSections(currentTrend, { clazz: rule, grade: rule }, context.examId)[0];
  expect(section.highlights?.some((item) => item.label.includes('排名'))).toBe(false);
  expect(section.highlightRows).toEqual([2, 2]);
});

it('uses the rule bounds directly, isolates scope failures and binds requests to the exam and subject', async () => {
  const request = jest.fn(async (path: string, params: Record<string, string | number>) => {
    if (path.endsWith('/getLevelTrend')) return currentTrend;
    if (path.endsWith('/rulesAndCopywriter')) {
      if (params.code === 'clazz') throw new ProviderError('NETWORK', 'fictional private error');
      return numberRule;
    }
    return diagnosis;
  });
  const sections = await zhixueReportSections(request, context);
  expect(sections[0].highlights?.filter((item) => item.label.includes('排名'))).toEqual([{ label: '学校排名（预估）', value: '106~210' }]);
  expect(sections[0].highlightRows).toEqual([2, 3]);
  for (const code of ['clazz', 'grade']) expect(request).toHaveBeenCalledWith('/zhixuebao/report/common/rulesAndCopywriter', { examId: context.examId, code, subjectCode: '00' });
  request.mockClear();
  await zhixueReportSections(request, { ...context, paperId: context.examId, subjectCode: '01' });
  expect(request).toHaveBeenCalledWith('/zhixuebao/report/common/rulesAndCopywriter', { examId: context.examId, code: 'grade', subjectCode: '01' });
  request.mockClear();
  await zhixueReportSections(request, { ...context, paperId: 'fictional-paper' });
  expect(request.mock.calls.some(([path]) => path.endsWith('/rulesAndCopywriter'))).toBe(false);
});

it('does not apply the current rules to another exam or paper in the history', () => {
  expect(zhixueTrendSections(currentTrend, { clazz: numberRule, grade: numberRule }, 'different-paper')[0].highlights?.some((item) => item.label.includes('排名'))).toBe(false);
});

it('merges class, school and union data while keeping current-exam metrics and rules separate', () => {
  const point = { id: context.examId, name: '虚构联考', dateTime: 1600000000000, level: 'B等' };
  const rule = { ...numberRule, levelList: [{ name: 'B等', lowBound: 5, upperBound: 10 }] };
  const section = zhixueTrendSections({ scoreLevelType: 'number', list: [
    { tag: { code: 'clazz' }, dataList: [{ ...point, statTotalNum: 20 }, { ...point, id: 'fictional-later', dateTime: 1600100000000, level: 'A等', statTotalNum: 99 }] },
    { tag: { code: 'grade' }, dataList: [{ ...point, statTotalNum: 300, totalNum: 350 }] },
    { tag: { code: 'union' }, totalNum: 4000, title: '虚构联考建议', dataList: [{ ...point, totalNum: 4000 }] },
  ] }, { clazz: rule, grade: rule, union: rule }, context.examId)[0];
  expect(section.highlights).toContainEqual({ label: '班级等第', value: 'B等' });
  expect(section.highlights).toContainEqual({ label: '班级人数', value: '20' });
  expect(section.highlights).toContainEqual({ label: '学校人数', value: '300' });
  expect(section.highlights).toContainEqual({ label: '联考人数', value: '4000' });
  expect(section.highlights).toContainEqual({ label: '联考排名（预估）', value: '201~400' });
  expect(section.highlightRows).toEqual([3, 3, 3]);
  expect(section.notes).toContain('【联考】虚构联考建议');
  expect(section.items![0].values).toMatchObject({ 班级等级: 'B等', 年级等级: 'B等', 联考等级: 'B等', 联考统计人数: '4000' });
  expect(section.itemGroups?.map((group) => group.label)).toEqual(['班级', '学校', '联考']);
});

it.each([
  { statTotalNum: 20, totalNum: 20 }, { totalNum: 3999 }, { statTotalNum: 3999, totalNum: 4000 },
])('does not replace ambiguous union counts with class, school or group totals %#', (counts) => {
  const section = zhixueTrendSections({ scoreLevelType: 'number', list: [
    { tag: { code: 'union' }, totalNum: 4000, dataList: [{ id: context.examId, level: 'B等', ...counts }] },
  ] }, { union: numberRule }, context.examId)[0];
  expect(section.highlights).toContainEqual({ label: '联考人数', value: '—' });
  expect(section.highlights?.some((item) => item.label.includes('排名'))).toBe(false);
  expect(section.items![0].values['联考统计人数']).toBeUndefined();
  expect(section.notes?.join('')).toContain('口径缺失或不一致');
});

it('requests union rules for the same exam and subject without borrowing school rules', async () => {
  const data = { ...currentTrend, list: [...currentTrend.list, { tag: { code: 'union' }, totalNum: 4000,
    dataList: [{ id: context.examId, level: 'B等', totalNum: 4000 }],
  }] };
  const request = jest.fn(async (path: string, params: Record<string, string | number>) => {
    if (path.endsWith('/getLevelTrend')) return data;
    if (path.endsWith('/rulesAndCopywriter')) {
      if (params.code === 'union') throw new ProviderError('NOT_FOUND', 'fictional unavailable union rule');
      return numberRule;
    }
    return diagnosis;
  });
  const sections = await zhixueReportSections(request, context);
  expect(request).toHaveBeenCalledWith('/zhixuebao/report/common/rulesAndCopywriter', { examId: context.examId, code: 'union', subjectCode: '00' });
  expect(sections[0].highlights).toContainEqual({ label: '联考等第', value: 'B等' });
  expect(sections[0].highlights).toContainEqual({ label: '联考人数', value: '4000' });
  expect(sections[0].highlights?.some((item) => item.label === '联考排名（预估）')).toBe(false);
  expect(sections[0].highlights?.some((item) => item.label === '学校排名（预估）')).toBe(true);
});

it('propagates rule-request session expiry instead of showing a stale estimate', async () => {
  const request = async (path: string) => {
    if (path.endsWith('/getLevelTrend')) return currentTrend;
    if (path.endsWith('/rulesAndCopywriter')) throw new ProviderError('SESSION_EXPIRED', 'fictional expiry');
    return diagnosis;
  };
  await expect(zhixueReportSections(request, context)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
});

it.each([
  ['A等', 100, '1~15'], ['B等', 100, '16~30'], ['E等', 100, '61~100'],
  ['B等', 15, '3~4'], ['B等', 1, undefined], ['B等', 0, undefined], ['未知等第', 100, undefined], ['B等', undefined, undefined],
])('estimates the %s band for %s participants while keeping official scope and raw values', (grade, participants, expected) => {
  const rule = { ruleObtainType: 2, leveType: 'NUMBER', levelList: [
    { name: 'A等', lowBound: 0, upperBound: 15 }, { name: 'B等', lowBound: 15, upperBound: 30 },
    { name: 'E等', lowBound: 60, upperBound: 100 },
  ] };
  const sections = zhixueTrendSections({ scoreLevelType: 'number', list: ['clazz', 'grade'].map((code) => ({ tag: { code }, dataList: [{ id: 'fictional-current', level: grade, statTotalNum: participants, totalNum: 999 }] })) }, { clazz: rule, grade: rule }, 'fictional-current');
  const ranks = sections[0].highlights!.filter((item) => item.label.includes('排名'));
  expect(ranks).toEqual(expected ? [{ label: '班级排名（预估）', value: expected }, { label: '学校排名（预估）', value: expected }] : []);
  expect(sections[0].highlights).toContainEqual({ label: '学校等第', value: grade });
  expect(sections[0].highlights).toContainEqual({ label: '学校人数', value: participants === undefined ? '—' : String(participants) });
});

it.each([
  undefined, [], [{ name: 'B等', lowBound: -1, upperBound: 85 }],
  [{ name: 'B等', lowBound: 70, upperBound: 101 }], [{ name: 'B等', lowBound: 85, upperBound: 70 }],
  [{ name: 'B等', lowBound: 70, upperBound: 85 }, { name: 'B等', lowBound: 60, upperBound: 70 }],
])('does not invent a rank for missing, invalid or ambiguous grade bands %#', (levelList) => {
  const section = zhixueTrendSections({ list: [{ tag: { code: 'clazz' }, dataList: [{ id: 'fictional-current', level: 'B等', statTotalNum: 100 }] }] }, { clazz: { ruleObtainType: 2, leveType: 'NUMBER', levelList } }, 'fictional-current')[0];
  expect(section.highlights?.some((item) => item.label.includes('排名'))).toBe(false);
});

it('combines both scopes of an exam and labels each summary without merging different exams', () => {
  const sections = zhixueTrendSections({ list: [
    { tag: { code: 'clazz' }, title: '班级建议', dataList: [
      { name: '虚构月考', dateTime: 1600000000000, level: 'B', statTotalNum: 0 },
      { name: '虚构月考', dateTime: 1600100000000, level: 'A' },
    ] },
    { tag: { code: 'grade' }, title: '年级建议', dataList: [
      { name: '虚构月考', dateTime: 1600000000000, level: 'C', statTotalNum: 100 },
    ] },
  ] });
  expect(sections[0].notes).toEqual(['【班级】班级建议', '【学校】学校建议']);
  expect(sections[0].highlightColumns).toBe(2);
  expect(sections[0].collapseNotes).toBe(true);
  expect(sections[0].notesPosition).toBe('before-items');
  expect(sections[0].items).toHaveLength(2);
  expect(sections[0].items![0].values).toEqual({ 班级等级: 'B', 班级统计人数: '0', 年级等级: 'C', 年级统计人数: '100' });
  expect(sections[0].items![1].values).toEqual({ 班级等级: 'A' });
});

it('keeps zero radar levels and omits missing values instead of inventing levels', () => {
  const section = zhixueDiagnosisSection({ list: [
    { subjectName: '虚构甲', myRank: 100, rationalRank: 0, avgRank: 50, showGradeSecondary: false },
    { subjectName: '虚构乙', myRank: 50, showGradeSecondary: false },
    { subjectName: '虚构丙', avgRank: 0, showGradeSecondary: false },
    { subjectName: '虚构空' },
  ] });
  expect(section.radar).toEqual({ axes: ['虚构甲', '虚构乙', '虚构丙'], series: [
    { label: '本次水平', values: [0, 50, null] }, { label: '平时水平', values: [100, null, null] },
    { label: '班级中等水平', values: [50, null, 100] },
  ] });
});

it('hides the baseline only when all original levels and missing-value positions match', () => {
  const matching = [
    { subjectName: '虚构甲', myRank: 20, rationalRank: 20, showGradeSecondary: false },
    { subjectName: '虚构乙', myRank: 100, rationalRank: 100, showGradeSecondary: false },
    { subjectName: '虚构丙', avgRank: 50, showGradeSecondary: false },
  ];
  expect(zhixueDiagnosisSection({ list: matching }).radar?.series.map((series) => series.label)).toEqual(['本次水平', '班级中等水平']);
  for (const changed of [20.01, null, 0]) {
    const section = zhixueDiagnosisSection({ list: [{ ...matching[0], rationalRank: changed }, ...matching.slice(1)] });
    expect(section.radar?.series.some((series) => series.label === '平时水平')).toBe(true);
  }
});

it('preserves a knowledge summary when its table is empty and only formats explicitly provided mastery values', () => {
  const section = zhixueKnowledgeSection({ title: '虚构知识诊断', subtitle: '虚构复习建议', tip: '虚构掌握情况说明', dataList: [] });
  expect(section.notes).toEqual(['虚构复习建议', '虚构掌握情况说明']);
  expect(section.items).toEqual([]);
  const table = zhixueKnowledgeSection({ columnNames: { secondColumnName: '虚构权重', thirdColumnName: '虚构掌握程度' }, dataList: [
    { name: '虚构考点一', score: '高', myScoreAbility: 0 }, { name: '虚构考点二', myScoreAbility: '' },
  ] });
  expect(table.items![0].values).toEqual({ 虚构权重: '高', 虚构掌握程度: '0%' });
  expect(table.items![1].values).toEqual({});
});

it('requests actual data directly without consulting module configuration', async () => {
  const request = jest.fn(async (path: string) => path.endsWith('/getLevelTrend') ? trend : diagnosis);
  expect(await zhixueReportSections(request, context)).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.some(([path]) => path.includes('/getModules'))).toBe(false);
});

it('keeps diagnosis available if a trend is restricted, without trying another endpoint family', async () => {
  const request = jest.fn(async (path: string) => {
    if (path.endsWith('/getLevelTrend')) throw new ProviderError('RESTRICTED', 'fictional private error');
    return diagnosis;
  });
  const sections = await zhixueReportSections(request, context);
  expect(sections).toHaveLength(1);
  expect(sections[0].radar?.axes).toHaveLength(2);
  expect(JSON.stringify(sections)).not.toContain('fictional private error');
  expect(request.mock.calls.every(([path]) => path.startsWith('/zxbReport/report/'))).toBe(true);
});

it('passes historical boundaries and subject identity and does not load exam diagnosis from a subject', async () => {
  const request = jest.fn(async (path: string) => {
    return path.endsWith('/getLevelTrend') ? trend : { tip: '虚构说明', dataList: [] };
  });
  const sections = await zhixueReportSections(request, { ...context, paperId: 'fictional-paper', subjectCode: 'fictional-code' });
  expect(sections).toHaveLength(2);
  expect(request).toHaveBeenCalledWith('/zxbReport/report/paper/getLevelTrend', {
    examId: context.examId, paperId: 'fictional-paper', subjectCode: 'fictional-code',
    pageIndex: 1, pageSize: 5, startSchoolYear: context.start, endSchoolYear: context.end,
  });
  expect(request.mock.calls.some(([path]) => path.endsWith('/getSubjectDiagnosis'))).toBe(false);
});

it('isolates malformed optional data and never includes response values in an error section', async () => {
  const request = async (path: string) => path.endsWith('/getLevelTrend') ? { list: 'fictional-secret-value' } : diagnosis;
  const sections = await zhixueReportSections(request, context);
  expect(sections[0].notes![0]).toContain('加载失败');
  expect(JSON.stringify(sections)).not.toContain('fictional-secret-value');
});

it('does not turn session expiry into an optional-report notice', async () => {
  const request = async () => {
    throw new ProviderError('SESSION_EXPIRED', 'fictional expiry');
  };
  await expect(zhixueReportSections(request, context)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
});

it.each(['network', 'malformed'])('hides unavailable diagnosis on %s failure while preserving the trend', async (failure) => {
  const request = async (path: string) => {
    if (path.endsWith('/getLevelTrend')) return trend;
    if (failure === 'network') throw new Error('fictional network failure');
    return { list: 'invalid' };
  };
  const sections = await zhixueReportSections(request, context);
  expect(sections.map((section) => section.id)).toEqual(['zhixue-trend']);
  expect(JSON.stringify(sections)).not.toContain('附加报告暂时加载失败');
});

it('omits the grading-rule notice from trend notes', () => {
  const sections = zhixueTrendSections({ list: [{ tag: { code: 'clazz' },
    title: '*参考教育部门等级划分规则呈现成绩（查看说明）',
    reference: { content: '参考教育部门等级划分规则呈现成绩（查看说明）' },
    dataList: [{ level: 'A等' }],
  }] });
  expect(sections[0].notes).toEqual([]);
});

it('hides empty successes and unavailable reports, but preserves knowledge summary text', async () => {
  expect(await zhixueReportSections(async (path) => path.endsWith('/getLevelTrend') ? { list: [] } : { list: [] }, context)).toEqual([]);
  expect(await zhixueReportSections(async () => '', context)).toEqual([]);
  const request = async (path: string) => {
    if (path.endsWith('/getLevelTrend')) throw new ProviderError('NOT_FOUND', 'fictional absence');
    return { dataList: [] };
  };
  expect(await zhixueReportSections(request, { ...context, paperId: 'fictional-paper' })).toEqual([]);
});

it('preserves cancellation rather than publishing partial report content', async () => {
  const controller = new AbortController();
  const request = async () => { controller.abort(); throw new Error('fictional cancellation'); };
  await expect(zhixueReportSections(request, context, controller.signal)).rejects.toBeDefined();
});
