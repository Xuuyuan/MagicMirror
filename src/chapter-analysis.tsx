import { useState } from 'react';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import type { SubjectAnalysisItem } from './domain/models';
import { Badge, Card } from './ui';

function ChapterRow({ item }: { item: SubjectAnalysisItem }) {
  const theme = useTheme();
  const data = item.scoreBreakdown;
  const max = data?.maxScore;
  const validScale = max !== undefined && Number.isFinite(max) && max > 0;
  const position = (score: number) => Math.max(0, Math.min(100, score / max! * 100));
  const benchmarks = data?.benchmarks.filter(entry => Number.isFinite(entry.score) && entry.score >= 0 && validScale && entry.score <= max!) ?? [];
  return <View style={{ paddingVertical: 10, gap: 6, borderTopWidth: 0.5, borderTopColor: theme.colors.outlineVariant }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant="titleSmall" style={{ flex: 1 }}>{item.label}</Text>
      {data?.score !== undefined && <Text variant="bodyMedium">{data.score}{max !== undefined ? ` / ${max}` : ''}</Text>}
      {data?.grade && <Badge label={data.grade} />}
    </View>
    {validScale && data?.score !== undefined ? <View style={{ gap: 8 }}>
      {[{ label: '本人', score: data.score }, ...benchmarks].map((entry, index) => <View key={`${entry.label}-${index}`} accessibilityLabel={`${item.label} ${entry.label} ${entry.score}，满分 ${max}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="labelSmall" style={{ width: 80, color: theme.colors.onSurfaceVariant }}>{entry.label}</Text>
        <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors.surface }}>
          <View style={{ width: entry.score === 0 ? 8 : `${position(entry.score)}%`, height: 8, borderRadius: 4, backgroundColor: index === 0 ? theme.colors.primary : index === 1 ? theme.colors.secondary : theme.colors.tertiary }} />
        </View>
        <Text variant="labelSmall" style={{ width: 40, textAlign: 'right', color: theme.colors.onSurfaceVariant }}>{entry.score}</Text>
      </View>)}
    </View> : <Text variant="bodySmall">{Object.entries(item.values).map(([label, value]) => `${label} ${value}`).join(' · ')}</Text>}
  </View>;
}

export function ChapterAnalysis({ items }: { items?: SubjectAnalysisItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items?.length) return null;
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="titleMedium">知识章节</Text>
      <IconButton style={{ marginVertical: 0 }} icon={expanded ? 'chevron-up' : 'chevron-down'} accessibilityLabel={`${expanded ? '收起' : '展开'}知识章节`} onPress={() => setExpanded(value => !value)} />
    </View>
    {expanded && items.map((item, index) => <ChapterRow key={`${item.label}-${index}`} item={item} />)}
  </Card>;
}
