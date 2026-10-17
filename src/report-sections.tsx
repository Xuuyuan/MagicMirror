import { useState } from 'react';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import type { ReportSection } from './domain/models';
import { Card } from './ui';
import { DistributionGroups } from './distribution-groups';
import { RadarChart } from './radar-chart';

/** 单个报告卡片的内容区（不含标题与折叠开关）；供 `placement` 指定的功能卡片复用。 */
export function ReportSectionBody({ section, expanded = false }: { section: ReportSection; expanded?: boolean }) {
  const theme = useTheme();
  const colors = [theme.colors.primary, theme.colors.secondary, theme.colors.tertiary, theme.colors.outline];
  const metric = section.comparisonMetric ?? '得分率';
  let highlightOffset = 0;
  const highlightRows = section.highlightRows?.map((count) => {
    const row = section.highlights?.slice(highlightOffset, highlightOffset + count) ?? [];
    highlightOffset += count;
    return row;
  }) ?? [section.highlights ?? []];
  const noteContent = (expanded || !section.collapseNotes) && section.notes?.map((note, i) => <Text key={i} variant="bodyMedium" numberOfLines={!expanded && note.length > 120 ? 3 : undefined}>{note}</Text>);
  return <>
    {section.notesPosition !== 'bottom' && noteContent}
    {section.distributions?.length ? <DistributionGroups groups={section.distributions} /> : null}
    {section.radar && <RadarChart data={section.radar} />}
    {!!section.highlights?.length && <View style={{ gap: 12 }}>{highlightRows.map((row, rowIndex) => {
      const columns = section.highlightRows ? row.length : section.highlightColumns;
      return <View key={rowIndex} style={columns ? { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 } : { gap: 12 }}>
    {row.map((item, i) => <View key={`${item.label}-${i}`} style={[{ borderRadius: 12, backgroundColor: theme.colors.surface }, columns
      ? { width: columns === 3 ? '31%' : '48%', padding: 8, gap: 6 }
      : { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }]}>
      <Text variant="titleSmall" style={columns ? undefined : { flex: 1 }} numberOfLines={columns === 3 ? 1 : 2} adjustsFontSizeToFit={columns === 3}>{item.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text variant={columns ? 'titleLarge' : 'headlineSmall'} style={{ color: theme.colors.primary, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
        {item.unit && <Text variant="bodySmall">{item.unit}</Text>}
      </View>
    </View>)}
    </View>;
    })}</View>}
    {expanded && section.items?.map((item, i) => <View key={`${item.label}-${i}`} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: theme.colors.outlineVariant }}>
      <Text variant="titleSmall">{item.label}</Text>
      {section.itemGroups ? section.itemGroups.filter((group) => group.columns.some((column) => item.values[column.key] !== undefined)).map((group) => <View key={group.label} accessibilityLabel={`${item.label} ${group.label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="labelMedium" style={{ width: 32 }}>{group.label}</Text>
        {group.columns.map((column) => <View key={column.key} style={{ flex: 1, minWidth: 0, gap: 4 }}><Text variant="labelSmall">{column.label}</Text><Text variant="bodyMedium">{item.values[column.key] ?? '—'}</Text></View>)}
      </View>) : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{Object.entries(item.values).map(([label, value]) => <View key={label} style={{ minWidth: 120, flexGrow: 1, flexBasis: '45%' }}><Text variant="labelSmall">{label}</Text><Text variant="bodyMedium">{value}</Text></View>)}</View>}
    </View>)}
    {expanded && section.comparisons?.map((item, i) => <View key={`${item.label}-${i}`} style={{ gap: 6, paddingVertical: 8 }}>
      <Text variant="titleSmall">{item.label} · {metric}</Text>
      {item.series.map((series, index) => <View key={series.label} accessibilityLabel={`${item.label} ${series.label}${metric} ${series.percent}%`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="labelSmall" style={{ width: 64 }}>{series.label}</Text>
        <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceVariant }}><View style={{ width: series.percent === 0 ? 8 : `${series.percent}%`, height: 8, borderRadius: 4, backgroundColor: colors[index % colors.length] }} /></View>
        <Text variant="bodySmall" style={{ width: 56, textAlign: 'right' }}>{series.percent}%</Text>
      </View>)}
    </View>)}
    {section.notesPosition === 'bottom' && noteContent}
  </>;
}

function Section({ section }: { section: ReportSection }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!section.items?.length || !!section.comparisons?.length || !!section.notes?.some(note => section.collapseNotes || note.length > 120);
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text variant="titleMedium" style={{ flex: 1 }}>{section.title}</Text>
      {hasDetails && <IconButton style={{ marginVertical: 0 }} icon={expanded ? 'chevron-up' : 'chevron-down'} onPress={() => setExpanded(v => !v)} accessibilityLabel={`${expanded ? '收起' : '展开'}${section.title}`} />}
    </View>
    <ReportSectionBody section={section} expanded={expanded} />
  </Card>;
}

export function ReportSections({ sections }: { sections?: ReportSection[] }) {
  return <>{sections?.map(section => <Section key={section.id} section={section} />)}</>;
}
