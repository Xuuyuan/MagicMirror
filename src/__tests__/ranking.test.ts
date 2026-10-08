import { formatRankText, formatRanking } from '@/src/services/ranking';

describe('formatRanking', () => {
  it('shows an exact rank once when the estimated bounds are equal', () => {
    expect(formatRanking({ rank: 40, rankMax: 40 })).toBe('40');
  });

  it('shows a range when the estimated bounds differ', () => {
    expect(formatRanking({ rank: 40, rankMax: 50 })).toBe('40~50');
  });

  it('shows an exact rank when no upper bound exists', () => {
    expect(formatRanking({ rank: 40 })).toBe('40');
  });
});

describe('formatRankText', () => {
  it('collapses equal endpoints in provider context text', () => {
    expect(formatRankText('40~40')).toBe('40');
    expect(formatRankText('40～40/40人')).toBe('40/40人');
  });

  it('preserves distinct ranges and other official labels', () => {
    expect(formatRankText('1~20')).toBe('1~20');
    expect(formatRankText('A')).toBe('A');
  });
});
