import type { Ranking } from '@/src/domain/models';

/** 将精确排名和预估区间转换为用户可读文本。 */
export function formatRanking(ranking: Pick<Ranking, 'rank' | 'rankMax'>): string {
  return ranking.rankMax !== undefined && ranking.rankMax !== ranking.rank
    ? `${ranking.rank}~${ranking.rankMax}`
    : String(ranking.rank);
}

/** 兼容 Provider 上下文中的官方排名字符串，折叠相等的区间端点。 */
export function formatRankText(value: string): string {
  const text = value.trim().replace(/～/g, '~');
  const range = /^(\d+)~(\d+)(.*)$/.exec(text);
  if (!range || range[1] !== range[2]) return text;
  return `${range[1]}${range[3]}`;
}
