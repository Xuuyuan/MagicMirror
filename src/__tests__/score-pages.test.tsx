/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import Result from '../../app/result';
import { ExamMeta } from '../../app/index';
import Subject from '../../app/subject';
import { QuestionImagePreview } from '../question-image-preview';
import type { ExamResult, SubjectDetail } from '../domain/models';
import { distributionSection, essaySection } from '../providers/septnet-report';
import { useAppStore } from '../state/app';
import { ScoreDisplaySettings } from '../score-display-settings';
import type { GradeDisplayMode } from '../services/score-display';

type Root = { render: (element: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => Root }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mockPush = jest.fn();
let mockProviderId = 'septnet';
const mockSubject: SubjectDetail = { subjectId: 'fictional-subject', subject: '化学', score: 65, maxScore: 100, grade: 'B4', providerContext: { originalScore: '20', scaledScore: '65', gradePercentile: '36-43%' } };
const mockResult: ExamResult = {
  examId: 'fictional-exam', examName: '虚构考试', totalScore: 65, originalTotalScore: 20, maxTotalScore: 200,
  subjects: [{ subject: '生物', status: 'absent' }, mockSubject, { subject: '历史', status: 'absent' }, { subject: '数学', score: 0 }],
};
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) }, useLocalSearchParams: () => ({ accountId: 'fictional', examId: 'fictional-exam', subjectId: '化学', subject: '化学' }) }));
jest.mock('../accounts-context', () => ({ useAccounts: () => ({ accounts: [{ id: 'fictional', revision: 'r1', providerId: mockProviderId }] }) }));
jest.mock('../services/accounts', () => ({ withAccount: jest.fn() }));
jest.mock('../providers/registry', () => ({ providerRegistry: { get: jest.fn() } }));
jest.mock('../state/app', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { useAppStore: create<{ showAbsentSubjects: boolean; septnetGradeDisplay: GradeDisplayMode;
    setShowAbsentSubjects: (show: boolean) => void; setSeptnetGradeDisplay: (mode: GradeDisplayMode) => void;
  }>(set => ({ showAbsentSubjects: true, septnetGradeDisplay: 'both',
    setShowAbsentSubjects: showAbsentSubjects => set({ showAbsentSubjects }),
    setSeptnetGradeDisplay: septnetGradeDisplay => set({ septnetGradeDisplay }),
  })) };
});
jest.mock('../services/queries', () => ({
  examResultQueryOptions: () => ({ data: mockResult }),
  subjectQueryOptions: () => ({ data: mockSubject }),
  watermarkedAnswerSheetsQueryOptions: () => ({ data: [] }),
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: object) => ({ ...options, isPending: false }), useQueryClient: () => ({}) }));
jest.mock('react-native', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { absoluteFill: {} },
  View: ({ children, style, accessibilityLabel }: { children: ReactNode; style?: unknown; accessibilityLabel?: string }) => <div data-style={JSON.stringify(style)} aria-label={accessibilityLabel}>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }) => <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>{children}</button>,
}));
jest.mock('react-native-paper', () => {
  const List = { Icon: () => <span data-testid="arrow">→</span> };
  function Menu({ visible, anchor, children }: { visible: boolean; anchor: ReactNode; children: ReactNode }) { return <>{anchor}{visible && <div role="menu">{children}</div>}</>; }
  Menu.Item = function MenuItem({ title, onPress, leadingIcon }: { title: string; onPress: () => void; leadingIcon?: string }) { return <button role="menuitem" data-selected={leadingIcon === 'check'} onClick={onPress}>{title}</button>; };
  return {
    List, useTheme: () => ({ colors: {} }),
    Text: ({ children, variant }: { children: ReactNode; variant?: string }) => <span data-variant={variant}>{children}</span>,
    Button: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
    Checkbox: { Item: () => null },
    Menu,
    IconButton: ({ icon, onPress, accessibilityLabel }: { icon: string; onPress?: () => void; accessibilityLabel?: string }) => <button data-icon={icon} aria-label={accessibilityLabel} onClick={onPress} />,
  };
});
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Badge: ({ label }: { label: string }) => <span data-testid="badge">{label}</span>,
  Header: () => null, ErrorCard: () => null, LoadingState: ({ label }: { label: string }) => <span>{label}</span>,
  useDoubleTap: (callback: unknown) => callback,
}));
jest.mock('../question-score-groups', () => ({ QuestionScoreGroups: () => null }));
jest.mock('../sheet-image', () => ({ AdaptiveSheetImage: () => null, SheetViewerModal: () => null }));
jest.mock('../sheet-actions', () => ({ SheetActionsSheet: () => null }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  jest.clearAllMocks();
  mockProviderId = 'septnet';
  useAppStore.setState({ showAbsentSubjects: true, septnetGradeDisplay: 'both' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each< [GradeDisplayMode, string | undefined] >([
  ['both', 'B4 36-43%'], ['grade', 'B4'], ['percentile', '36-43%'], ['none', undefined],
])('设置切换 %s 即时更新总分、科目卡片与单科等第', async (mode, label) => {
  Object.assign(mockResult, { grade: 'B4', gradePercentile: '36-43%' });
  try {
    await act(async () => root.render(<><ScoreDisplaySettings /><Result /><Subject /></>));
    const labels = { both: '等第及百分比均显示', grade: '只显示等第', percentile: '只显示百分比', none: '不显示' };
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="七天学堂-等第显示方式"]')!.click());
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === labels[mode])!;
    await act(async () => option.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[aria-label="七天学堂-等第显示方式"]')?.textContent).toBe(labels[mode]);
    const grades = Array.from(container.querySelectorAll('[data-testid="badge"]')).filter(badge => badge.textContent !== '缺考');
    expect(grades.map(badge => badge.textContent)).toEqual(label ? [label, label, label] : []);
  } finally { delete mockResult.grade; delete mockResult.gradePercentile; }
});

it('隐藏缺考仅过滤明确缺考，保留零分和无分数的正常科目，且切回显示可恢复', async () => {
  const originalSubjects = mockResult.subjects;
  mockResult.subjects = [...originalSubjects, { subject: '物理' }];
  try {
    await act(async () => root.render(<><ScoreDisplaySettings /><Result /></>));
    const selectAbsent = async (text: string) => {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="显示缺考科目："]')!.click());
      const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === text)!;
      await act(async () => option.click());
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(container.querySelector('[aria-label^="显示缺考科目："]')?.textContent).toBe(text);
    };
    await selectAbsent('隐藏');
    expect(container.querySelector('[aria-label="生物，缺考"]')).toBeNull();
    expect(container.querySelector('[aria-label="历史，缺考"]')).toBeNull();
    expect(container.querySelector('[aria-label="查看数学详情"]')?.textContent).toContain('0');
    expect(container.querySelector('[aria-label="查看物理详情"]')).not.toBeNull();
    expect(mockResult.subjects).toHaveLength(5);
    await selectAbsent('显示');
    expect(container.querySelector('[aria-label="生物，缺考"]')).not.toBeNull();
  } finally { mockResult.subjects = originalSubjects; }
});

it('七天只显示百分比时缺失百分比不回退等第，其他平台不受设置影响', async () => {
  const context = mockSubject.providerContext;
  try {
    mockSubject.providerContext = {};
    useAppStore.setState({ septnetGradeDisplay: 'percentile' });
    await act(async () => root.render(<Subject />));
    expect(container.querySelector('[data-testid="badge"]')).toBeNull();
    mockProviderId = 'ruiya';
    await act(async () => { useAppStore.setState({ septnetGradeDisplay: 'none' }); root.render(<Subject />); });
    expect(container.querySelector('[data-testid="badge"]')?.textContent).toBe('B4');
  } finally { mockSubject.providerContext = context; }
});

it.each([true, false, undefined])('考试列表按已知属性显示联考或校考徽标 %s', async (isUnion) => {
  await act(async () => root.render(<ExamMeta exam={{ id: 'fictional-exam', name: '虚构考试', isUnion }} loading={false} />));
  expect(container.querySelector('[data-testid="badge"]')?.textContent).toBe(isUnion === undefined ? undefined : isUnion ? '联考' : '校考');
});

it('七天科目页面按题型独立展开分布，显示百分比且不标记本人答案', async () => {
  mockSubject.reportSections = [essaySection({ score: '0', full: '60', avg: '35', max: '55', highCount: '20' })!,
    distributionSection([{ th: '1', sort: 1, distri: [{ key: 'A', value: '0.25' }, { key: 'B', value: '99.75' }] },
      { th: '2', sort: 2, distri: [{ key: '零分', value: '0' }, { key: '满分(4)', value: '100' }] }])!];
  try {
    await act(async () => root.render(<Subject />));
    expect(container.textContent).toContain('作文统计个人得分0分满分60分年级均分35分最高分55分更高分人数20人');
    expect(container.textContent).not.toContain('考试小结');
    expect(container.textContent).not.toContain('<span>');
    expect(container.textContent).toContain('选项分布 · 1题');
    expect(container.textContent).toContain('得分区间分布 · 1题');
    expect(container.textContent).not.toContain('第 1 题');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开选项分布"]')!.click());
    expect(container.textContent).toContain('第 1 题A0.25%B99.75%');
    expect(container.textContent).not.toContain('第 2 题');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开得分区间分布"]')!.click());
    expect(container.textContent).toContain('第 2 题零分0%满分(4)100%');
    expect(container.querySelector('[aria-label="第 2 题 零分 0%"] [data-style*="0%"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="第 2 题 满分(4) 100%"] [data-style*="100%"]')).not.toBeNull();
    expect(container.textContent).not.toContain('正确答案：A');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起选项分布"]')!.click());
    expect(container.textContent).not.toContain('第 1 题');
    expect(container.textContent).toContain('第 2 题');
    expect(container.textContent).not.toContain('展示平台原始分布值');
  } finally { delete mockSubject.reportSections; }
});

it('分布先显示十题，显示全部后可恢复；收起再展开也恢复十题', async () => {
  mockSubject.reportSections = [distributionSection(Array.from({ length: 12 }, (_, index) => ({
    th: String(index + 1), distri: [{ key: 'A', value: '25' }, { key: 'B', value: '-' }, { key: 'C', value: '75' }, { key: 'D', value: '—' }, { key: '漏填', value: '0' }],
  })))!];
  try {
    await act(async () => root.render(<Subject />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开选项分布"]')!.click());
    expect(container.textContent).toContain('第 10 题');
    expect(container.textContent).not.toContain('第 11 题');
    expect(container.textContent).toContain('A25%C75%漏填0%');
    expect(container.textContent).not.toContain('B—');
    expect(container.textContent).not.toContain('B-');
    expect(container.textContent).not.toContain('D—');
    const all = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '显示全部 12 题')!;
    await act(async () => all().click());
    expect(container.textContent).toContain('第 12 题');
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '仅显示前 10 题')!.click());
    expect(container.textContent).not.toContain('第 11 题');
    await act(async () => all().click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起选项分布"]')!.click());
    expect(container.textContent).not.toContain('第 1 题');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开选项分布"]')!.click());
    expect(container.textContent).not.toContain('第 11 题');
  } finally { delete mockSubject.reportSections; }
});

it.each([true, false])('总分头部展示等级、发布时间，人数旁展示联考属性 %s', async (isUnion) => {
  Object.assign(mockResult, { grade: 'B4', gradePercentile: '36-43%', publishedAt: '2026-05-27 10:00:00', participantCount: 512, isUnion });
  try {
    await act(async () => root.render(<Result />));
    expect(container.textContent).toContain('总分B4 36-43%');
    expect(container.textContent).toContain('发布时间 2026-05-27 10:00:00');
    expect(container.textContent).toContain(`考生人数 512 人${isUnion ? '联考' : '校考'}`);
    expect(container.textContent).not.toContain('考试信息');
    expect(container.textContent).not.toContain('考试小结');
  } finally {
    delete mockResult.grade; delete mockResult.gradePercentile; delete mockResult.publishedAt;
    delete mockResult.participantCount; delete mockResult.isUnion;
  }
});

it('dismisses the image loading modal through its backdrop without a visible close button', async () => {
  const dismiss = jest.fn();
  await act(async () => root.render(<QuestionImagePreview selection={{ question: { id: 'q1', label: '虚构题目' }, kind: 'student' }} accountId="fictional" revision="r1" examId="fictional-exam" subjectId="fictional-subject" onDismiss={dismiss} onLongPress={jest.fn()} />));
  const message = Array.from(container.querySelectorAll('span')).find(x => x.textContent === '正在获取作答图片…');
  expect(message).toBeDefined();
  expect(container.textContent).not.toContain('关闭');
  await act(async () => message!.click());
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭图片预览"]')!.click());
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('考试详情显示总分和单科赋分/原始分，缺考置底不可点击，正常科目仍可跳转', async () => {
  const originalOrder = mockResult.subjects.map((item) => item.subject);
  await act(async () => root.render(<Result />));
  expect(container.textContent).toContain('总分65 / 200原始 20');
  const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['查看化学详情', '查看数学详情', '生物，缺考', '历史，缺考']);
  expect(cards[0].textContent).toContain('65 / 100原始 20');
  expect(cards[0].querySelector('[data-testid="badge"]')?.textContent).toBe('B4 36-43%');
  expect(cards[0].textContent).not.toContain('赋分');
  expect(cards[1].textContent).toContain('0');
  for (const card of cards.slice(2)) {
    expect(card.disabled).toBe(true);
    expect(card.querySelector('[data-testid="badge"]')?.textContent).toBe('缺考');
    expect(card.querySelector('[data-testid="arrow"]')).toBeNull();
    await act(async () => card.click());
  }
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => cards[0].click());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/subject', params: { accountId: 'fictional', examId: 'fictional-exam', subjectId: '化学', subject: '化学' } });
  expect(mockResult.subjects.map((item) => item.subject)).toEqual(originalOrder);
});

it('排名格子在名次后显示班级和学校击败率', async () => {
  mockResult.rankings = [{ scope: 'class', rank: 5 }, { scope: 'grade', rank: 40 }];
  mockResult.ranking = { scope: 'grade', rank: 40 };
  mockResult.defeatRates = [{ scope: 'class', value: 60.5 }, { scope: 'grade', value: 55.2 }];
  try {
    await act(async () => root.render(<Result />));
    expect(container.textContent).toContain('班级5击败率 60.5%');
    expect(container.textContent).toContain('学校40击败率 55.2%');
  } finally {
    delete mockResult.rankings; delete mockResult.ranking; delete mockResult.defeatRates;
  }
});

it('考试和科目详情只在主分数后显示满分，原始分不重复显示满分', async () => {
  const previous = mockSubject.providerContext;
  mockSubject.providerContext = { ...previous, originalMaxScore: '50' };
  mockResult.originalMaxTotalScore = 150;
  try {
    await act(async () => root.render(<Result />));
    expect(container.textContent).toContain('总分65 / 200原始 20');
    expect(container.textContent).not.toContain('原始 20 /');
    expect(container.querySelector('[aria-label="查看化学详情"]')?.textContent).toContain('65 / 100原始 20');
    await act(async () => root.render(<Subject />));
    expect(container.textContent).toContain('65 / 100B4 36-43%原始 20');
    expect(container.textContent).not.toContain('原始 20 /');
  } finally {
    mockSubject.providerContext = previous;
    delete mockResult.originalMaxTotalScore;
  }
});

it('科目详情同时显示赋分和原始分', async () => {
  await act(async () => root.render(<Subject />));
  expect(container.textContent).toContain('65 / 100B4 36-43%原始 20');
  expect(container.querySelector('[data-testid="badge"]')?.textContent).toBe('B4 36-43%');
  expect(container.textContent).not.toContain('等第 B4');
  expect(container.textContent).not.toContain('赋分');
});

it('知识章节默认收起，展开显示得分等级与基准，缺少满分时保留文字', async () => {
  mockSubject.chapterAnalysis = [
    { label: '虚构章节', values: {}, scoreBreakdown: { score: 0, maxScore: 6, grade: 'C', benchmarks: [{ label: '特控线基准', score: 5 }, { label: '本科线基准', score: 3 }] } },
    { label: '缺失满分章节', values: { 个人得分: '2', 达标分A: '3' }, scoreBreakdown: { score: 2, benchmarks: [] } },
  ];
  try {
    await act(async () => root.render(<Subject />));
    expect(container.textContent).toContain('知识章节');
    expect(container.textContent).not.toContain('· 2项');
    expect(container.textContent).not.toContain('虚构章节');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开知识章节"]')!.click());
    expect(container.textContent).toContain('虚构章节0 / 6C');
    expect(container.textContent).toContain('特控线基准5');
    expect(container.textContent).toContain('本科线基准3');
    expect(container.textContent).toContain('个人得分 2 · 达标分A 3');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起知识章节"]')!.click());
    expect(container.textContent).not.toContain('虚构章节');
  } finally { delete mockSubject.chapterAnalysis; }
});

it('答题详情默认展开，收起隐藏内容，再展开恢复内容', async () => {
  mockSubject.questionNotice = '虚构答题说明';
  try {
    await act(async () => root.render(<Subject />));
    expect(container.textContent).toContain('虚构答题说明');
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起答题详情"]')!;
    expect(toggle.dataset.icon).toBe('chevron-up');
    await act(async () => toggle.click());
    expect(container.textContent).not.toContain('虚构答题说明');
    expect(container.textContent).toContain('答题详情');
    expect(toggle.getAttribute('aria-label')).toBe('展开答题详情');
    await act(async () => toggle.click());
    expect(container.textContent).toContain('虚构答题说明');
  } finally { delete mockSubject.questionNotice; }
});

it('科目各范围排名以大字号显示名次，小字号显示总人数', async () => {
  mockSubject.statistics = [{ scope: '班级', rank: 2, participantCount: 30 }, { scope: '年级', rank: 4, participantCount: 100 }, { scope: '总排名', rank: 15, participantCount: 200 }];
  mockSubject.defeatRates = [{ scope: 'class', value: 70.1 }, { scope: 'grade', value: 62.3 }];
  try {
    await act(async () => root.render(<Subject />));
    expect(container.textContent).toContain('联考排名');
    expect(container.textContent).toContain('学校排名');
    expect(container.textContent).not.toContain('年级');
    expect(Array.from(container.querySelectorAll('[data-variant="bodySmall"]')).map(node => node.textContent)).toEqual(expect.arrayContaining(['/ 30', '/ 100', '/ 200']));
    expect(Array.from(container.querySelectorAll('[data-variant="headlineSmall"]')).map(node => node.textContent)).toEqual(['2', '4', '15']);
    expect(container.textContent).toContain('击败率 70.1%');
    expect(container.textContent).toContain('击败率 62.3%');
  } finally { delete mockSubject.statistics; delete mockSubject.defeatRates; }
});

it('总分分数线直接显示各线分数及单位，无需展开', async () => {
  mockResult.reportSections = [{ id: 'score-lines', title: '总分分数线', highlights: [{ label: '特控线', value: '500.5', unit: '分' }, { label: '本科线', value: '400', unit: '分' }] }];
  try {
    await act(async () => root.render(<Result />));
    expect(container.textContent).toContain('总分分数线特控线500.5分本科线400分');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '展开')).toBe(false);
  } finally { delete mockResult.reportSections; }
});

it('章节建议随概览展开收起，仅有说明时也可以展开', async () => {
  mockSubject.reportSections = [{ id: 'chapter-summary', title: '章节概览', notes: ['虚构学习建议'], collapseNotes: true }];
  try {
    await act(async () => root.render(<Subject />));
    expect(container.textContent).not.toContain('虚构学习建议');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开章节概览"]')!.click());
    expect(container.textContent).toContain('虚构学习建议');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起章节概览"]')!.click());
    expect(container.textContent).not.toContain('虚构学习建议');
  } finally { delete mockSubject.reportSections; }
});

it('综合分析默认折叠，展开显示数值与对比，收起后保留说明', async () => {
  mockResult.reportSections = [{ id: 'fictional-comparison', title: '学科表现', comparisonMetric: '超过比例', notes: ['虚构说明'], items: [{ label: '化学', values: { 超过比例: '50%' } }], comparisons: [{ label: '化学', series: [{ label: '本人', percent: 50 }] }] }];
  try {
    await act(async () => root.render(<Result />));
    expect(container.textContent).toContain('学科表现虚构说明');
    expect(container.textContent).not.toContain('50%');
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="展开学科表现"]')!;
    expect(toggle.dataset.icon).toBe('chevron-down');
    expect(toggle.textContent).toBe('');
    await act(async () => toggle.click());
    expect(container.textContent).toContain('超过比例50%');
    expect(container.textContent).toContain('化学 · 超过比例本人50%');
    expect(container.textContent).not.toContain('得分率');
    expect(toggle.getAttribute('aria-label')).toBe('收起学科表现');
    expect(toggle.dataset.icon).toBe('chevron-up');
    await act(async () => toggle.click());
    expect(container.textContent).not.toContain('50%');
    expect(container.textContent).toContain('虚构说明');
    expect(toggle.dataset.icon).toBe('chevron-down');
  } finally { delete mockResult.reportSections; }
});
