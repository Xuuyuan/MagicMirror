import { distributionSection, essaySection } from '@/src/providers/septnet-report';

it('空作文不生成卡片，不由不一致的 diff 计算差距或虚构人数', () => {
  expect(essaySection({})).toBeUndefined();
  expect(essaySection({ score: '-', highCount: '-1' })).toBeUndefined();
  const section = essaySection({ score: '30', max: '55', diff: '100', highCount: '1.5' });
  expect(section?.highlightColumns).toBe(3);
  expect(section?.highlights?.map(h => h.label)).toEqual(['个人得分', '最高分']);
});

it('空分布不生成卡片，零值及重复分桶不丢失', () => {
  expect(distributionSection([])).toBeUndefined();
  const section = distributionSection([{ th: '1', distri: [{ key: 'A', value: '0' }, { key: 'A', value: '0.1' }] }]);
  expect(section?.distributions?.[0].questions[0].bins).toEqual([
    { label: 'A', value: '0%', percent: 0 }, { label: 'A', value: '0.1%', percent: 0.1 },
  ]);
  expect(section?.notes).toBeUndefined();
  expect(section?.comparisons).toBeUndefined();
});

it('按题型分组并保持题目顺序，百分比不乘 100、不重新归一化', () => {
  const section = distributionSection([
    { th: '3', sort: 3, distri: [{ key: 'A', value: '25.5' }, { key: 'B', value: '74.5%' }] },
    { th: '2', sort: 2, distri: [{ key: '满分(4)', value: '0.25' }, { key: '零分', value: '0' }] },
    { th: '1', sort: 1, distri: [{ key: 'A', value: '100' }] },
  ]);
  expect(section?.distributions?.map(group => [group.layout, group.questions.map(q => q.label)])).toEqual([
    ['options', ['第 1 题', '第 3 题']], ['bars', ['第 2 题']],
  ]);
  expect(section?.distributions?.[0].questions[1].bins.map(bin => bin.value)).toEqual(['25.5%', '74.5%']);
  expect(section?.distributions?.[1].questions[0].bins[0]).toEqual({ label: '满分(4)', value: '0.25%', percent: 0.25 });
});

it('异常分布值保留原文，不绘制超出百分比范围的条形', () => {
  const section = distributionSection([{ th: '1', distri: [
    { key: '零分', value: '-1' }, { key: '(0~1]', value: '101' }, { key: '满分', value: '暂无' },
    { key: '', value: '50' }, { key: '空值', value: '' },
  ] }]);
  expect(section?.distributions?.[0].questions[0].bins.map(bin => [bin.value, bin.percent])).toEqual([
    ['-1', undefined], ['101', undefined], ['暂无', undefined],
  ]);
});

it('选项题含漏填分桶时仍归入选项分布，保留额外分桶', () => {
  const section = distributionSection([{ th: '1', distri: [
    { key: 'A', value: '25' }, { key: 'B', value: '25' }, { key: 'C', value: '25' },
    { key: 'D', value: '24' }, { key: '漏填', value: '1' },
  ] }]);
  expect(section?.distributions).toHaveLength(1);
  expect(section?.distributions?.[0].layout).toBe('options');
  expect(section?.distributions?.[0].questions[0].bins.at(-1)).toEqual({ label: '漏填', value: '1%', percent: 1 });
});
