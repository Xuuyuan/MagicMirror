import { useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton, Text, useTheme } from 'react-native-paper';
import type { DistributionGroup } from './domain/models';

const previewCount = 10;

type Bins = DistributionGroup['questions'][number]['bins'];

function optionColumns(bins: Bins) {
  return bins.filter((bin) => !['-', '—'].includes(bin.value.trim()));
}

/** 得分区间分布里人数比例为 0% 的区间没有信息量（只有标签和空条形），不显示。 */
function scoreRangeRows(bins: Bins) {
  return bins.filter((bin) => bin.percent !== 0);
}

function Group({ group }: { group: DistributionGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const theme = useTheme();
  // 隐藏区间后无行可显示的题目整题略过，题数与「显示全部」都以剩余题目为准。
  const available =
    group.layout === 'bars'
      ? group.questions
          .map((question) => ({ ...question, bins: scoreRangeRows(question.bins) }))
          .filter((question) => question.bins.length)
      : group.questions;
  const questions = showAll ? available : available.slice(0, previewCount);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="titleSmall">
          {group.title}
          {group.unitLabel === '' ? '' : ` · ${available.length}${group.unitLabel ?? '题'}`}
        </Text>
        <IconButton
          style={{ margin: 0 }}
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          accessibilityLabel={`${expanded ? '收起' : '展开'}${group.title}`}
          onPress={() => {
            setExpanded((value) => !value);
            setShowAll(false);
          }}
        />
      </View>
      {expanded && (
        <>
          {questions.map((question, index) => (
            <View
              key={`${question.label}-${index}`}
              style={{
                gap: 6,
                paddingBottom: 8,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.outlineVariant,
              }}
            >
              <Text variant="labelMedium">{question.label}</Text>
              {group.layout === 'options' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
                  {optionColumns(question.bins).map((bin, binIndex) => (
                    <View
                      key={`${bin.label}-${binIndex}`}
                      accessibilityLabel={`${question.label} ${bin.label} ${bin.value}${bin.highlight ? '，本人所在分数段' : ''}`}
                      style={{ width: '20%', alignItems: 'center', paddingHorizontal: 2, gap: 2 }}
                    >
                      <Text variant="labelSmall">{bin.label}</Text>
                      <Text variant="titleSmall" numberOfLines={1} adjustsFontSizeToFit>
                        {bin.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {question.bins.map((bin, binIndex) => (
                    <View
                      key={`${bin.label}-${binIndex}`}
                      accessibilityLabel={`${question.label} ${bin.label} ${bin.value}${bin.highlight ? '，本人所在分数段' : ''}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <Text
                        variant="labelSmall"
                        style={{
                          width: '30%',
                          color: bin.highlight ? theme.colors.primary : theme.colors.onSurface,
                          fontWeight: bin.highlight ? '700' : undefined,
                        }}
                      >
                        {bin.label}
                      </Text>
                      <View
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: theme.colors.surfaceVariant,
                        }}
                      >
                        {bin.percent !== undefined && (
                          <View
                            style={{
                              width: `${bin.percent}%`,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: bin.highlight
                                ? theme.colors.primary
                                : theme.colors.secondary,
                            }}
                          />
                        )}
                      </View>
                      <Text
                        variant="bodySmall"
                        style={{ width: 64, textAlign: 'right', color: theme.colors.onSurface }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {bin.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
          {available.length > previewCount && (
            <Button compact onPress={() => setShowAll((value) => !value)}>
              {showAll ? '仅显示前 10 题' : `显示全部 ${available.length} 题`}
            </Button>
          )}
        </>
      )}
    </View>
  );
}

export function DistributionGroups({ groups }: { groups: DistributionGroup[] }) {
  return (
    <View style={{ gap: 12 }}>
      {groups.map((group) => (
        <Group key={group.id} group={group} />
      ))}
    </View>
  );
}
