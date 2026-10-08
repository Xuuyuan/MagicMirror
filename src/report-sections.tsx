import { useState } from 'react';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import type { ReportSection } from './domain/models';
import { Card } from './ui';
import { DistributionGroups } from './distribution-groups';

function Section({ section }: { section: ReportSection }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();
  const colors = [theme.colors.primary, theme.colors.secondary, theme.colors.tertiary, theme.colors.outline];
  const metric = section.comparisonMetric ?? '得分率';
  const hasDetails = !!section.items?.length || !!section.comparisons?.length || !!section.notes?.some(note => section.collapseNotes || note.length > 120);
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text variant="titleMedium" style={{ flex: 1 }}>{section.title}</Text>
      {hasDetails && <IconButton style={{ marginVertical: 0 }} icon={expanded ? 'chevron-up' : 'chevron-down'} onPress={() => setExpanded(v => !v)} accessibilityLabel={`${expanded ? '收起' : '展开'}${section.title}`} />}
    </View>
    {(expanded || !section.collapseNotes) && section.notes?.map((note, i) => <Text key={i} variant="bodyMedium" numberOfLines={!expanded && note.length > 120 ? 3 : undefined}>{note}</Text>)}
    {section.distributions?.length ? <DistributionGroups groups={section.distributions} /> : null}
    {!!section.highlights?.length && <View style={section.highlightColumns === 3 ? { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 } : { gap: 12 }}>
    {section.highlights?.map((item, i) => <View key={`${item.label}-${i}`} style={[{ borderRadius: 12, backgroundColor: theme.colors.surface }, section.highlightColumns === 3
      ? { width: '31%', padding: 8, gap: 6 }
      : { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }]}>
      <Text variant="titleSmall" style={section.highlightColumns === 3 ? undefined : { flex: 1 }} numberOfLines={2}>{item.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text variant={section.highlightColumns === 3 ? 'titleLarge' : 'headlineSmall'} style={{ color: theme.colors.primary, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
        {item.unit && <Text variant="bodySmall">{item.unit}</Text>}
      </View>
    </View>)}
    </View>}
    {expanded && section.items?.map((item, i) => <View key={`${item.label}-${i}`} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: theme.colors.outlineVariant }}>
      <Text variant="titleSmall">{item.label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{Object.entries(item.values).map(([label, value]) => <View key={label} style={{ minWidth: 120, flexGrow: 1, flexBasis: '45%' }}><Text variant="labelSmall">{label}</Text><Text variant="bodyMedium">{value}</Text></View>)}</View>
    </View>)}
    {expanded && section.comparisons?.map((item, i) => <View key={`${item.label}-${i}`} style={{ gap: 6, paddingVertical: 8 }}>
      <Text variant="titleSmall">{item.label} · {metric}</Text>
      {item.series.map((series, index) => <View key={series.label} accessibilityLabel={`${item.label} ${series.label}${metric} ${series.percent}%`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="labelSmall" style={{ width: 64 }}>{series.label}</Text>
        <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceVariant }}><View style={{ width: series.percent === 0 ? 8 : `${series.percent}%`, height: 8, borderRadius: 4, backgroundColor: colors[index % colors.length] }} /></View>
        <Text variant="bodySmall" style={{ width: 56, textAlign: 'right' }}>{series.percent}%</Text>
      </View>)}
    </View>)}
  </Card>;
}

export function ReportSections({ sections }: { sections?: ReportSection[] }) {
  return <>{sections?.map(section => <Section key={section.id} section={section} />)}</>;
}
