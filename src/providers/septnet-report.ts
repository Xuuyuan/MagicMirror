import type { DistributionGroup, ReportSection } from '../domain/models';
import { numericScore } from './codec';

export interface EssayInfo {
  th?: string; score?: string; full?: string; avg?: string; max?: string; diff?: string; highCount?: string;
}
export interface QuestionDistribution {
  th: string; sort?: number; distri: { key: string; value: string }[];
}

export function essaySection(essay: EssayInfo): ReportSection | undefined {
  const values = Object.fromEntries([
    ['个人得分', essay.score], ['满分', essay.full], ['年级均分', essay.avg], ['最高分', essay.max],
    ['更高分人数', essay.highCount],
  ].flatMap(([label, raw]) => {
    const value = numericScore(raw);
    return value !== undefined && value >= 0 && (label !== '更高分人数' || Number.isInteger(value)) ? [[label!, String(value)]] : [];
  }));
  if (!Object.keys(values).length) return undefined;
  const score = numericScore(essay.score), max = numericScore(essay.max), diff = numericScore(essay.diff);
  // 只有返回值与最高分减个人分一致时，才将 diff 解释为这个差距。
  if (score !== undefined && max !== undefined && diff !== undefined && diff >= 0 && Math.abs(max - score - diff) < 1e-6) values['距最高分'] = String(diff);
  return { id: 'septnet-essay', title: '作文统计', highlightColumns: 3,
    highlights: Object.entries(values).map(([label, value]) => ({ label, value, unit: label === '更高分人数' ? '人' : '分' })),
  };
}

export function distributionSection(rows: QuestionDistribution[]): ReportSection | undefined {
  const groups: DistributionGroup[] = [
    { id: 'options', title: '选项分布', layout: 'options', questions: [] },
    { id: 'scores', title: '得分区间分布', layout: 'bars', questions: [] },
  ];
  const ordered = rows.map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.sort ?? a.index) - (b.row.sort ?? b.index) || a.index - b.index)
    .map(({ row }) => row);
  for (const row of ordered) {
    const bins = row.distri.filter(bin => bin.key.trim() && bin.value.trim()).map(bin => {
      const raw = bin.value.trim();
      // 实测每题各分桶合计约 100：裸数已是百分比，禁止按单值大小猜测或再次乘 100。
      const numeric = /^\d+(?:\.\d+)?%?$/.test(raw) ? Number(raw.replace('%', '')) : undefined;
      const percent = numeric !== undefined && numeric <= 100 ? numeric : undefined;
      return { label: bin.key.trim(), value: percent !== undefined ? `${String(percent)}%` : raw, percent };
    });
    if (!bins.length) continue;
    // 选择题还可能带“漏填”等非字母分桶，不能因此归入得分区间。
    const options = bins.some(bin => /^[A-H]+$/.test(bin.label));
    groups[options ? 0 : 1].questions.push({ label: `第 ${row.th} 题`, bins });
  }
  const distributions = groups.filter(group => group.questions.length);
  return distributions.length ? { id: 'septnet-distribution', title: '选项与得分区间分布', distributions } : undefined;
}
